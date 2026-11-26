import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "./sql-types";
import type PostalMime from "postal-mime";
import { z } from "zod";
import type { CloudflareRoutingSyncResult, RoutingRule } from "../shared/routing";

type ParsedEmail = Awaited<ReturnType<InstanceType<typeof PostalMime>["parse"]>>;
import { hostName } from "./domains";
import { addressDomain, canRouteAddress, mailConfig, normalizeAddress } from "./lib/domains";
import type { Env } from "./types";

const emailAddress = z.string().trim().toLowerCase().email().max(254);
const localPart = z.string().trim().toLowerCase().min(1).max(64)
	.refine((part) => /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(part) && !part.startsWith(".") && !part.endsWith(".") && !part.includes(".."),
		"Enter a valid alias prefix before @");

export const RoutingInputSchema = z.object({
	domain: hostName,
	matchType: z.enum(["exact", "catch_all"]),
	localPart: z.string().trim().toLowerCase().optional().default(""),
	action: z.enum(["forward", "mailbox", "reject"]),
	forwardTo: z.array(emailAddress).max(10).default([]),
	deliverTo: emailAddress.nullable().optional().default(null),
	rejectReason: z.string().trim().max(200).default("Mailbox unavailable"),
	enabled: z.boolean().default(true),
	note: z.string().trim().max(200).default(""),
}).superRefine((value, ctx) => {
	if (value.matchType === "exact") {
		const check = localPart.safeParse(value.localPart);
		if (!check.success) {
			ctx.addIssue({ code: "custom", path: ["localPart"], message: check.error.issues[0]?.message || "Enter an alias address" });
		}
	}
	const address = value.matchType === "catch_all" ? `*@${value.domain}` : `${(value.localPart || "").trim().toLowerCase()}@${value.domain}`;
	const uniqueTargets = [...new Set(value.forwardTo)];
	if (value.action === "forward" && uniqueTargets.length === 0) {
		ctx.addIssue({ code: "custom", path: ["forwardTo"], message: "Specify at least one destination email address" });
	}
	if (value.action === "mailbox" && !value.deliverTo) {
		ctx.addIssue({ code: "custom", path: ["deliverTo"], message: "Select a local mailbox for this alias" });
	}
	if (value.matchType === "exact" && uniqueTargets.includes(address)) {
		ctx.addIssue({ code: "custom", path: ["forwardTo"], message: "An alias cannot forward directly to itself" });
	}
	if (value.matchType === "exact" && value.deliverTo === address) {
		ctx.addIssue({ code: "custom", path: ["deliverTo"], message: "An alias must deliver to a different address" });
	}
});

interface RuleRow {
	id: string;
	domain: string;
	match_type: "exact" | "catch_all";
	address: string;
	action: "forward" | "mailbox" | "reject";
	forward_to: string;
	deliver_to: string | null;
	reject_reason: string;
	enabled: number;
	note: string;
	created_at: string;
	updated_at: string;
}

const toRule = (row: RuleRow): RoutingRule => ({
	id: row.id,
	domain: row.domain,
	matchType: row.match_type,
	address: row.address,
	action: row.action,
	forwardTo: JSON.parse(row.forward_to) as string[],
	deliverTo: row.deliver_to,
	rejectReason: row.reject_reason,
	enabled: !!row.enabled,
	note: row.note,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
});

export class RoutingStore {
	constructor(private readonly db: SqlDatabase) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS routing_rules (
				id TEXT PRIMARY KEY,
				domain TEXT NOT NULL,
				match_type TEXT NOT NULL,
				address TEXT NOT NULL UNIQUE,
				action TEXT NOT NULL,
				forward_to TEXT NOT NULL DEFAULT '[]',
				deliver_to TEXT,
				reject_reason TEXT NOT NULL DEFAULT 'Mailbox unavailable',
				enabled INTEGER NOT NULL DEFAULT 1,
				note TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_routing_domain ON routing_rules(domain);
			CREATE INDEX IF NOT EXISTS idx_routing_deliver_to ON routing_rules(deliver_to);
		`);
	}

	list(domain?: string): RoutingRule[] {
		const rows = domain
			? this.db.prepare("SELECT * FROM routing_rules WHERE domain = ? ORDER BY match_type ASC, address ASC").all(domain)
			: this.db.prepare("SELECT * FROM routing_rules ORDER BY domain ASC, match_type ASC, address ASC").all();
		return (rows as unknown as RuleRow[]).map(toRule);
	}

	listForMailbox(mailboxId: string): RoutingRule[] {
		const normalized = normalizeAddress(mailboxId);
		const rows = this.db.prepare("SELECT * FROM routing_rules WHERE deliver_to = ? ORDER BY address ASC").all(normalized);
		return (rows as unknown as RuleRow[]).map(toRule);
	}

	get(id: string): RoutingRule | null {
		const row = this.db.prepare("SELECT * FROM routing_rules WHERE id = ?").get(id) as unknown as RuleRow | undefined;
		return row ? toRule(row) : null;
	}

	findByAddress(address: string): RoutingRule | null {
		const row = this.db.prepare("SELECT * FROM routing_rules WHERE address = ?").get(normalizeAddress(address)) as unknown as RuleRow | undefined;
		return row ? toRule(row) : null;
	}

	create(raw: z.output<typeof RoutingInputSchema>): RoutingRule | null {
		const now = new Date().toISOString();
		const address = raw.matchType === "catch_all" ? `*@${raw.domain}` : `${raw.localPart.trim().toLowerCase()}@${raw.domain}`;
		const id = randomUUID();
		const forwardTo = [...new Set(raw.forwardTo)];
		const deliverTo = raw.action === "reject" ? null : raw.deliverTo;
		const reason = raw.rejectReason || "Mailbox unavailable";
		const res = this.db.prepare(`
			INSERT INTO routing_rules (id, domain, match_type, address, action, forward_to, deliver_to, reject_reason, enabled, note, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(address) DO NOTHING
		`).run(id, raw.domain, raw.matchType, address, raw.action, JSON.stringify(forwardTo), deliverTo, reason, raw.enabled ? 1 : 0, raw.note, now, now);
		return res.changes ? this.get(id) : null;
	}

	update(id: string, raw: z.output<typeof RoutingInputSchema>): RoutingRule | "missing" | "duplicate" {
		const current = this.get(id);
		if (!current) return "missing";
		const address = raw.matchType === "catch_all" ? `*@${raw.domain}` : `${raw.localPart.trim().toLowerCase()}@${raw.domain}`;
		const conflict = this.findByAddress(address);
		if (conflict && conflict.id !== id) return "duplicate";
		const now = new Date().toISOString();
		const forwardTo = [...new Set(raw.forwardTo)];
		const deliverTo = raw.action === "reject" ? null : raw.deliverTo;
		const reason = raw.rejectReason || "Mailbox unavailable";
		this.db.prepare(`
			UPDATE routing_rules
			SET domain = ?, match_type = ?, address = ?, action = ?, forward_to = ?, deliver_to = ?, reject_reason = ?, enabled = ?, note = ?, updated_at = ?
			WHERE id = ?
		`).run(raw.domain, raw.matchType, address, raw.action, JSON.stringify(forwardTo), deliverTo, reason, raw.enabled ? 1 : 0, raw.note, now, id);
		return this.get(id)!;
	}

	delete(id: string): boolean {
		return !!this.db.prepare("DELETE FROM routing_rules WHERE id = ?").run(id).changes;
	}
}

export interface StoredMailboxForwarding {
	enabled?: boolean;
	targets?: string[];
	email?: string;
	keepCopy?: boolean;
}

export interface InboundResolution {
	accept: boolean;
	reason?: string;
	recipient: string;
	deliverTo: string | null;
	forwardTo: string[];
	rule?: RoutingRule;
}

async function readMailboxForwarding(env: Env, mailboxId: string): Promise<{ targets: string[]; keepCopy: boolean } | null> {
	const obj = await env.STORE.get(`mailboxes/${mailboxId}.json`);
	if (!obj) return null;
	const settings = await obj.json<{ forwarding?: StoredMailboxForwarding }>();
	const fwd = settings.forwarding;
	if (!fwd?.enabled) return { targets: [], keepCopy: true };
	const targets = [...new Set([
		...(fwd.targets ?? []),
		...(fwd.email ? [fwd.email] : []),
	].map(normalizeAddress).filter(Boolean))];
	return { targets, keepCopy: fwd.keepCopy ?? true };
}

export async function resolveInboundRecipient(env: Env, rawRecipient: string): Promise<InboundResolution> {
	const recipient = normalizeAddress(rawRecipient);
	const domain = addressDomain(recipient);
	const config = await mailConfig(env);
	if (!domain || !canRouteAddress(recipient, config)) {
		return { accept: false, reason: "Mailbox unavailable", recipient, deliverTo: null, forwardTo: [] };
	}

	const exactRule = await env.ROUTING.findByAddress(recipient);
	if (exactRule) {
		if (!exactRule.enabled) {
			return { accept: false, reason: "Mailbox unavailable", recipient, deliverTo: null, forwardTo: [], rule: exactRule };
		}
		if (exactRule.action === "reject") {
			return { accept: false, reason: exactRule.rejectReason || "Mailbox unavailable", recipient, deliverTo: null, forwardTo: [], rule: exactRule };
		}
		let deliverTo = exactRule.deliverTo;
		const forwardTargets = [...exactRule.forwardTo];
		if (deliverTo) {
			const mailboxFwd = await readMailboxForwarding(env, deliverTo);
			if (!mailboxFwd) {
				deliverTo = null;
			} else {
				if (!mailboxFwd.keepCopy) deliverTo = null;
				forwardTargets.push(...mailboxFwd.targets);
			}
		}
		const uniqueForward = [...new Set(forwardTargets.map(normalizeAddress))].filter((target) => target !== recipient && target !== deliverTo);
		if (!deliverTo && uniqueForward.length === 0) {
			return { accept: false, reason: "Mailbox unavailable", recipient, deliverTo: null, forwardTo: [], rule: exactRule };
		}
		return { accept: true, recipient, deliverTo, forwardTo: uniqueForward, rule: exactRule };
	}

	const mailboxFwd = await readMailboxForwarding(env, recipient);
	if (mailboxFwd) {
		const deliverTo = mailboxFwd.keepCopy ? recipient : null;
		const forwardTo = mailboxFwd.targets.filter((target) => target !== recipient && target !== deliverTo);
		if (!deliverTo && forwardTo.length === 0) {
			return { accept: false, reason: "Mailbox unavailable", recipient, deliverTo: null, forwardTo: [] };
		}
		return { accept: true, recipient, deliverTo, forwardTo };
	}

	const catchAll = await env.ROUTING.findByAddress(`*@${domain}`);
	if (catchAll && catchAll.enabled) {
		if (catchAll.action === "reject") {
			return { accept: false, reason: catchAll.rejectReason || "Mailbox unavailable", recipient, deliverTo: null, forwardTo: [], rule: catchAll };
		}
		let deliverTo = catchAll.deliverTo;
		const forwardTargets = [...catchAll.forwardTo];
		if (deliverTo) {
			const targetFwd = await readMailboxForwarding(env, deliverTo);
			if (!targetFwd) {
				deliverTo = null;
			} else {
				if (!targetFwd.keepCopy) deliverTo = null;
				forwardTargets.push(...targetFwd.targets);
			}
		}
		const uniqueForward = [...new Set(forwardTargets.map(normalizeAddress))].filter((target) => target !== recipient && target !== deliverTo);
		if (deliverTo || uniqueForward.length > 0) {
			return { accept: true, recipient, deliverTo, forwardTo: uniqueForward, rule: catchAll };
		}
	}

	return { accept: false, reason: "Mailbox unavailable", recipient, deliverTo: null, forwardTo: [] };
}

function headerValues(parsed: ParsedEmail, name: string): string[] {
	const target = name.toLowerCase();
	return (parsed.headers || [])
		.filter((header) => header.key.toLowerCase() === target)
		.map((header) => String(header.value || "").trim())
		.filter(Boolean);
}

export async function forwardInboundEmail(
	env: Env,
	recipient: string,
	targets: string[],
	parsed: ParsedEmail,
): Promise<{ skippedLoop?: boolean; forwardedTo: string[] }> {
	if (!targets.length) return { forwardedTo: [] };
	const hopHeader = Number(headerValues(parsed, "x-agentic-hop")[0] || "0");
	if (Number.isFinite(hopHeader) && hopHeader >= 4) {
		return { skippedLoop: true, forwardedTo: [] };
	}
	const priorAddresses = new Set(
		headerValues(parsed, "x-agentic-forwarded-for")
			.flatMap((line) => line.split(","))
			.map(normalizeAddress)
			.filter(Boolean),
	);
	if (priorAddresses.has(recipient)) {
		return { skippedLoop: true, forwardedTo: [] };
	}
	const filteredTargets = targets.filter((target) => !priorAddresses.has(target) && target !== recipient);
	if (!filteredTargets.length) return { skippedLoop: true, forwardedTo: [] };
	if (!env.SEND_EMAIL) {
		throw new Error("SMTP_URL is not configured for forwarding");
	}

	const origFromAddr = parsed.from?.address ? normalizeAddress(parsed.from.address) : "";
	const origFromName = (parsed.from?.name?.trim() || origFromAddr).replace(/[\r\n<>"]/g, "").slice(0, 80);
	const origReplyTo = parsed.replyTo?.[0]?.address ? normalizeAddress(parsed.replyTo[0].address) : origFromAddr;
	const forwardedChain = [...priorAddresses, recipient].join(", ");

	await env.SEND_EMAIL({
		from: origFromName ? { name: `${origFromName} (via ${recipient})`, email: recipient } : recipient,
		to: filteredTargets,
		...(origReplyTo ? { replyTo: origReplyTo } : {}),
		subject: parsed.subject || "(No subject)",
		...(parsed.html ? { html: parsed.html } : {}),
		...(parsed.text ? { text: parsed.text } : (!parsed.html ? { text: "" } : {})),
		headers: {
			"Auto-Submitted": env.platform === "cloudflare" ? "auto-generated" : "auto-forwarded",
			"X-Original-To": recipient,
			"X-Agentic-Forwarded-For": forwardedChain,
			"X-Agentic-Hop": String((Number.isFinite(hopHeader) ? hopHeader : 0) + 1),
			...(env.platform === "cloudflare" ? { "X-Auto-Forwarded": "true" } : {}),
		},
		...(parsed.attachments?.length ? {
			attachments: parsed.attachments.map((att) => ({
				filename: att.filename || "attachment",
				content: (typeof att.content === "string" ? Buffer.from(att.content) : Buffer.from(att.content)).toString("base64"),
				type: att.mimeType,
				disposition: att.disposition === "inline" ? "inline" : "attachment",
				contentId: att.contentId || undefined,
			})),
		} : {}),
	});
	return { forwardedTo: filteredTargets };
}

interface CloudflareRoutingRule {
	id: string;
	name?: string;
	enabled?: boolean;
	matchers?: { type: string; field?: string; value?: string }[];
	actions?: { type: string; value?: string[] }[];
}

export async function syncCloudflareEmailRouting(
	domain: string,
	rules: RoutingRule[],
	token: string,
	request = fetch,
): Promise<CloudflareRoutingSyncResult[]> {
	const cfApi = async <T>(path: string, method = "GET", body?: unknown) => {
		const res = await request(`https://api.cloudflare.com/client/v4${path}`, {
			method,
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(10_000),
			redirect: "manual",
		});
		const data = await res.json() as { success: boolean; result: T; errors?: { message: string }[] };
		if (!res.ok || !data.success) {
			throw new Error(data.errors?.[0]?.message || `Cloudflare API responded with status ${res.status}`);
		}
		return data.result;
	};

	const zones = await cfApi<{ id: string; name: string }[]>(`/zones?${new URLSearchParams({ name: domain, status: "active" })}`);
	const zone = zones.find((z) => z.name === domain);
	if (!zone) throw new Error(`No active Cloudflare zone found for ${domain}`);

	const existing = await cfApi<CloudflareRoutingRule[]>(`/zones/${encodeURIComponent(zone.id)}/email/routing/rules?per_page=100`);
	const results: CloudflareRoutingSyncResult[] = [];

	for (const rule of rules) {
		if (rule.action === "mailbox") {
			results.push({
				ruleId: rule.id,
				address: rule.address,
				state: "skipped",
				detail: "Local mailbox aliases are handled by NeoMail directly",
			});
			continue;
		}
		if (rule.action === "forward" && rule.deliverTo) {
			results.push({
				ruleId: rule.id,
				address: rule.address,
				state: "skipped",
				detail: "Rules that also keep a local copy must be delivered to NeoMail via SMTP or relay",
			});
			continue;
		}

		const actions = rule.action === "reject"
			? [{ type: "drop" }]
			: [{ type: "forward", value: rule.forwardTo }];

		try {
			if (rule.matchType === "catch_all") {
				await cfApi(`/zones/${encodeURIComponent(zone.id)}/email/routing/rules/catch_all`, "PUT", {
					name: rule.note || `NeoMail catch-all (${domain})`,
					enabled: rule.enabled,
					matchers: [{ type: "all" }],
					actions,
				});
				results.push({ ruleId: rule.id, address: rule.address, state: "updated" });
				continue;
			}

			const matched = existing.find((cfRule) =>
				cfRule.matchers?.some((m) => m.type === "literal" && m.field === "to" && m.value?.toLowerCase() === rule.address));
			const payload = {
				name: rule.note || `NeoMail: ${rule.address}`,
				enabled: rule.enabled,
				matchers: [{ type: "literal", field: "to", value: rule.address }],
				actions,
			};
			if (matched) {
				await cfApi(`/zones/${encodeURIComponent(zone.id)}/email/routing/rules/${encodeURIComponent(matched.id)}`, "PUT", payload);
				results.push({ ruleId: rule.id, address: rule.address, state: "updated" });
			} else {
				await cfApi(`/zones/${encodeURIComponent(zone.id)}/email/routing/rules`, "POST", payload);
				results.push({ ruleId: rule.id, address: rule.address, state: "created" });
			}
		} catch (error) {
			results.push({
				ruleId: rule.id,
				address: rule.address,
				state: "error",
				detail: error instanceof Error ? error.message : "Could not sync rule to Cloudflare",
			});
		}
	}

	return results;
}
