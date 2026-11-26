import { createHmac, randomBytes } from "node:crypto";
import type { MailWebhook, MailWebhookEvent } from "../shared/webhooks";
import type { SqlDatabase } from "./sql-types";
import type { Env } from "./types";

// Known public automation ingress only. Custom HTTPS origins must be approved
// by the deployment operator; owner sessions cannot turn the app into a proxy.
const hostedIngress = /^(?:hooks\.zapier\.com|hook(?:\.[a-z]{2}[0-9])?\.make\.com|[a-z0-9-]+\.(?:m|w)\.pipedream\.net|[a-z0-9-]+\.app\.n8n\.cloud)$/;

function parseDestination(value: string) {
	if (value.length > 2000 || /[\s\\]/.test(value)) return;
	try {
		const url = new URL(value);
		// Require DNS names (public services or operator-approved ingress).
		if (url.protocol === "https:" && !url.port && !url.username && !url.password && !url.hash &&
			/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/.test(url.hostname) && !/\.(?:localhost|local|internal|home\.arpa)$/.test(url.hostname)) return url;
	} catch { /* malformed URLs are rejected */ }
}

export function webhookOrigins(value?: string) {
	return (value ?? "").split(",").flatMap((part) => {
		const url = parseDestination(part.trim());
		return url && url.pathname === "/" && !url.search ? [url.origin] : [];
	});
}

export function webhookDestination(value: string, origins: string[] = []): URL | undefined {
	const url = parseDestination(value);
	if (!url) return;
	if (origins.includes(url.origin)) return url;
	if (!hostedIngress.test(url.hostname)) return;
	if (url.hostname === "hooks.zapier.com" && !url.pathname.startsWith("/hooks/catch/")) return;
	if (url.hostname.endsWith(".app.n8n.cloud") && !/^\/webhook(?:-test)?\//.test(url.pathname)) return;
	return url;
}

type WebhookRow = {
	id: string; recipient: string; endpoint: string; secret: string; enabled: number;
	last_at: string | null; last_status: number | null; last_event: MailWebhookEvent["type"] | null;
};

function summary(row: WebhookRow): MailWebhook {
	return { id: row.id, recipient: row.recipient, origin: new URL(row.endpoint).origin, enabled: !!row.enabled,
		lastAttempt: row.last_at && row.last_event ? { at: row.last_at, status: row.last_status, event: row.last_event } : null };
}

export class WebhookStore {
	constructor(private readonly db: SqlDatabase) {
		db.exec(`CREATE TABLE IF NOT EXISTS mail_webhooks (
			id TEXT PRIMARY KEY, recipient TEXT NOT NULL, endpoint TEXT NOT NULL, secret TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1, last_at TEXT, last_status INTEGER, last_event TEXT,
			window_start INTEGER NOT NULL DEFAULT 0, window_count INTEGER NOT NULL DEFAULT 0,
			UNIQUE(recipient, endpoint)
		); CREATE INDEX IF NOT EXISTS mail_webhooks_recipient ON mail_webhooks(recipient, enabled);`);
	}

	list(): MailWebhook[] {
		return (this.db.prepare("SELECT * FROM mail_webhooks ORDER BY recipient, id").all() as WebhookRow[]).map(summary);
	}

	create(recipient: string, endpoint: string) {
		const id = crypto.randomUUID(), secret = randomBytes(32).toString("base64url");
		const result = this.db.prepare(`INSERT INTO mail_webhooks (id,recipient,endpoint,secret) SELECT ?,?,?,?
			WHERE (SELECT COUNT(*) FROM mail_webhooks) < 50 AND (SELECT COUNT(*) FROM mail_webhooks WHERE recipient = ?) < 5
			ON CONFLICT(recipient,endpoint) DO NOTHING`).run(id, recipient, endpoint, secret, recipient);
		return result.changes ? { webhook: summary(this.get(id)!), secret } : null;
	}

	get(id: string) {
		return this.db.prepare("SELECT * FROM mail_webhooks WHERE id = ?").get(id) as WebhookRow | undefined;
	}

	forRecipient(recipient: string) {
		return this.db.prepare("SELECT * FROM mail_webhooks WHERE recipient = ? AND enabled = 1").all(recipient) as WebhookRow[];
	}

	setEnabled(id: string, enabled: boolean) {
		return !!this.db.prepare("UPDATE mail_webhooks SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id).changes;
	}

	delete(id: string) { return !!this.db.prepare("DELETE FROM mail_webhooks WHERE id = ?").run(id).changes; }

	// A publicly reachable address must not be able to cause unbounded calls.
	claim(id: string, now: number) {
		return !!this.db.prepare(`UPDATE mail_webhooks SET
			window_count = CASE WHEN window_start <= ? THEN 1 ELSE window_count + 1 END,
			window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END
			WHERE id = ? AND enabled = 1 AND (window_start <= ? OR window_count < 30)`)
			.run(now - 60, now - 60, now, id, now - 60).changes;
	}

	record(id: string, at: string, status: number | null, event: MailWebhookEvent["type"]) {
		this.db.prepare("UPDATE mail_webhooks SET last_at = ?, last_status = ?, last_event = ? WHERE id = ? AND (last_at IS NULL OR last_at <= ?)")
			.run(at, status, event, id, at);
	}
}

export async function deliverWebhook(env: Env, hook: WebhookRow, event: MailWebhookEvent) {
	const url = webhookDestination(hook.endpoint, env.WEBHOOK_ALLOWED_ORIGINS);
	let status: number | null = null;
	if (url) {
		try {
			const body = JSON.stringify(event);
			const timestamp = String(Math.floor(Date.now() / 1000));
			const signature = createHmac("sha256", hook.secret).update(`${timestamp}.${body}`).digest("hex");
			const response = await fetch(url.toString(), {
				method: "POST", redirect: "manual", signal: AbortSignal.timeout(5000), body,
				headers: {
					"Content-Type": "application/json", "X-NeoMail-Event": event.type,
					"X-NeoMail-Delivery": event.id, "X-NeoMail-Timestamp": timestamp, "X-NeoMail-Signature": `sha256=${signature}`,
				},
			});
			status = response.status;
			void response.body?.cancel().catch(() => {});
		} catch { /* Never log URLs or server responses; both can contain secrets. */ }
	}
	await env.WEBHOOKS?.record(hook.id, event.occurredAt, status, event.type);
	return status;
}

export function mailWebhookEvent(type: MailWebhookEvent["type"], recipient: string, mailboxId: string | null = null, messageId: string | null = null): MailWebhookEvent {
	return { id: crypto.randomUUID(), type, version: 1, occurredAt: new Date().toISOString(), recipient, mailboxId, messageId };
}

export function notifyWebhooks(env: Env, recipient: string, mailboxId?: string, messageId?: string) {
	const hooks = env.WEBHOOKS;
	if (!hooks) return;
	const event = mailWebhookEvent("mail.received", recipient, mailboxId, messageId);
	const job = (async () => {
		await Promise.all((await hooks.forRecipient(recipient)).map(async (hook) => {
			if (await hooks.claim(hook.id, Math.floor(Date.now() / 1000))) await deliverWebhook(env, hook, event);
		}));
	})().catch(() => console.warn("Could not process mail webhooks"));
	env.waitUntil?.(job);
}
