import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PushDevice } from "../shared/push";
import { mailboxDisposition } from "./lib/email-helpers";
import type { SqlDatabase } from "./sql-types";
import type { Env } from "./types";

const encoded = (bytes: number) => z.string().length(Math.ceil(bytes * 4 / 3))
	.regex(/^[A-Za-z0-9_-]+$/).refine((value) => Buffer.from(value, "base64url").toString("base64url") === value);
const publicKey = encoded(65).refine((value) => Buffer.from(value, "base64url")[0] === 4);
const keys = z.object({ publicKey, privateKey: encoded(32), subject: z.string().max(256).refine((value) => {
	try {
		const url = new URL(value);
		return (url.protocol === "https:" && !url.username && !url.password) || (url.protocol === "mailto:" && url.pathname.includes("@"));
	} catch { return false; }
}) });

export type PushKeys = z.output<typeof keys>;

export function loadPushKeys(secret?: string): PushKeys | undefined {
	if (!secret) return undefined;
	try {
		const result = keys.safeParse(JSON.parse(secret));
		if (result.success) return result.data;
	} catch { /* This is a server secret; never log the JSON. */ }
	return undefined;
}

// Only browser push services may receive outbound requests. Do not follow redirects.
export const pushEndpoint = z.string().max(2048).refine((value) => {
	try {
		const url = new URL(value);
		const host = url.hostname;
		return url.href === value && url.protocol === "https:" && !url.username && !url.password && !url.port &&
			!url.hash && (!url.search || host.endsWith(".notify.windows.com")) && url.pathname.length > 1 && (
				(host === "fcm.googleapis.com" && /^\/(?:fcm\/send|wp)\/[^/]/.test(url.pathname)) ||
				(host === "updates.push.services.mozilla.com" && url.pathname.startsWith("/wpush/")) ||
				host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com"));
	} catch { return false; }
}, "Unsupported browser notification service");

export const pushSubscription = z.object({
	endpoint: pushEndpoint,
	expirationTime: z.number().int().positive().nullable().default(null),
	keys: z.object({ p256dh: publicKey, auth: encoded(16) }),
});

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const maxDevices = 16;

type StoredDevice = { id: string; label: string; subscription: string; created: string };
const deviceInfo = ({ id, label, created }: StoredDevice): PushDevice => ({ id, label, createdAt: created });

export class PushStore {
	constructor(private readonly db: SqlDatabase) {
		db.exec(`CREATE TABLE IF NOT EXISTS push_devices (
			id TEXT PRIMARY KEY, label TEXT NOT NULL, subscription TEXT NOT NULL, session_digest TEXT NOT NULL,
			key_id TEXT NOT NULL, created TEXT NOT NULL, expires INTEGER
		)`);
	}

	save(subscription: PushSubscription, label: string, key: string, session: string): PushDevice | null {
		const now = Date.now();
		this.db.prepare("DELETE FROM push_devices WHERE expires <= ? OR key_id != ?").run(now, key);
		if (subscription.expirationTime !== null && subscription.expirationTime <= now) return null;
		const id = digest(subscription.endpoint);
		const row = this.db.prepare(`INSERT INTO push_devices (id,label,subscription,session_digest,key_id,created,expires)
			SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM push_devices WHERE id = ?) OR (SELECT COUNT(*) FROM push_devices) < ?
			ON CONFLICT(id) DO UPDATE SET label = excluded.label, subscription = excluded.subscription,
				session_digest = excluded.session_digest, expires = excluded.expires
			RETURNING id,label,created`).get(id, label, JSON.stringify(subscription), digest(session), key,
				new Date(now).toISOString(), subscription.expirationTime, id, maxDevices) as StoredDevice | undefined;
		return row ? deviceInfo(row) : null;
	}

	list(key?: string): PushDevice[] {
		return this.rows(key).map(deviceInfo);
	}

	rows(key?: string): StoredDevice[] {
		return this.db.prepare(`SELECT id,label,subscription,created FROM push_devices
			WHERE (expires IS NULL OR expires > ?) AND (? IS NULL OR key_id = ?) ORDER BY created DESC`)
			.all(Date.now(), key ?? null, key ?? null) as StoredDevice[];
	}

	remove(id: string, expectedSubscription?: string) {
		if (expectedSubscription === undefined) this.db.prepare("DELETE FROM push_devices WHERE id = ?").run(id);
		else this.db.prepare("DELETE FROM push_devices WHERE id = ? AND subscription = ?").run(id, expectedSubscription);
	}

	removeForSession(session: string, deviceId?: string) {
		this.db.prepare("DELETE FROM push_devices WHERE session_digest = ? OR id = ?").run(digest(session), deviceId ?? null);
	}

	clear() { this.db.exec("DELETE FROM push_devices"); }
}

export async function deliverPush(env: Env, device: StoredDevice, kind: "mail" | "test"): Promise<"accepted" | "expired" | "failed"> {
	if (!env.PUSH_KEYS || !env.PUSH_DEVICES) return "failed";
	try {
		const subscription = pushSubscription.parse(JSON.parse(device.subscription));
		const payload = await buildPushPayload({ data: { kind }, options: {
			ttl: kind === "mail" ? 900 : 60, urgency: "normal", topic: kind === "mail" ? "neomail" : "neomail-test",
		} }, subscription, env.PUSH_KEYS);
		const response = await fetch(subscription.endpoint, { ...payload, redirect: "manual", signal: AbortSignal.timeout(5000) });
		await response.body?.cancel().catch(() => {});
		if (response.status === 404 || response.status === 410) {
			await env.PUSH_DEVICES.remove(device.id, device.subscription);
			return "expired";
		}
		return response.ok ? "accepted" : "failed";
	} catch {
		// Never include provider URLs, subscription keys or tokens in error logs.
		return "failed";
	}
}

export function notifyInbox(env: Env, mailboxId: string) {
	if (!env.PUSH_KEYS || !env.PUSH_DEVICES) return;
	const { PUSH_KEYS: keys, PUSH_DEVICES: devices } = env;
	const job = (async () => {
		if (await mailboxDisposition(env.STORE, mailboxId) !== false) return; // quiet or disconnected inbox
		const rows = await devices.rows(keys.publicKey);
		// Keep well below the platform's concurrent outbound connection limit.
		for (let i = 0; i < rows.length; i += 4) {
			await Promise.all(rows.slice(i, i + 4).map((device) => deliverPush(env, device, "mail")));
		}
	})().catch(() => console.warn("Could not deliver Web Push notifications"));
	env.waitUntil?.(job);
}
