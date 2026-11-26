import { createHash } from "node:crypto";
import type { SqlDatabase } from "./sql-types";
import { domainToASCII } from "node:url";
import { z } from "zod";
import type { DnsCheck, DnsRecord, DomainConfig, DomainResult } from "../shared/dns";

const cleanHost = (value: string) => domainToASCII(value.trim().toLowerCase().replace(/\.$/, ""));
export const hostName = z.string().max(253).transform(cleanHost).refine((host) => host.length <= 253 &&
	/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host), "Enter a full DNS hostname, e.g. mail.example.com");
const txt = z.string().trim().max(4096).refine((value) => !/[\x00-\x1F\x7F]/.test(value), "DNS values must be a single line");
const versioned = (prefix: string) => txt.refine((value) => !value || value.toLowerCase().startsWith(prefix.toLowerCase()), `Must begin with ${prefix}`);
const selector = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
export const DomainSchema = z.object({
	domain: hostName,
	mxHost: hostName.or(z.literal("")).default(""),
	mxPriority: z.number().int().min(0).max(65535).default(10),
	spf: versioned("v=spf1 ").default(""),
	dmarc: versioned("v=DMARC1;").default("v=DMARC1; p=none"),
	dkim: z.array(z.discriminatedUnion("type", [
		z.object({ selector, type: z.literal("TXT"), value: txt.refine(Boolean, "Enter the DKIM public key from your mail provider") }),
		z.object({ selector, type: z.literal("CNAME"), value: hostName }),
	])).max(10).default([]).refine((records) => new Set(records.map((record) => record.selector)).size === records.length, "DKIM selectors must be unique"),
	sts: z.enum(["off", "testing", "enforce"]).default("off"),
	tlsReports: z.string().trim().toLowerCase().email().max(254).or(z.literal("")).default(""),
}).refine((value) => value.sts === "off" || !!value.mxHost, { path: ["mxHost"], message: "An MX hostname is required for MTA-STS" });

export class Domains {
	constructor(private readonly db: SqlDatabase, seeds = "", mxHost = "") {
		db.exec("CREATE TABLE IF NOT EXISTS domains (domain TEXT PRIMARY KEY, config TEXT NOT NULL)");
		for (const domain of seeds.split(",").map((name) => name.trim()).filter(Boolean)) {
			const config = DomainSchema.parse({ domain, mxHost });
			this.create(config);
		}
	}
	names() { return this.db.prepare("SELECT domain FROM domains ORDER BY domain").all().map((row) => String(row.domain)); }
	list() { return this.db.prepare("SELECT config FROM domains ORDER BY domain").all().map((row) => JSON.parse(String(row.config)) as DomainConfig); }
	get(domain: string) {
		const row = this.db.prepare("SELECT config FROM domains WHERE domain = ?").get(domain);
		return row ? JSON.parse(String(row.config)) as DomainConfig : null;
	}
	create(config: DomainConfig) { return !!this.db.prepare("INSERT INTO domains (domain,config) VALUES (?,?) ON CONFLICT(domain) DO NOTHING").run(config.domain, JSON.stringify(config)).changes; }
	update(config: DomainConfig) { return !!this.db.prepare("UPDATE domains SET config = ? WHERE domain = ?").run(JSON.stringify(config), config.domain).changes; }
	delete(domain: string) { return !!this.db.prepare("DELETE FROM domains WHERE domain = ?").run(domain).changes; }
}

export function dnsPlan(config: DomainConfig): DomainResult {
	const { domain, mxHost, mxPriority, dmarc, spf, dkim, sts, tlsReports } = config;
	const records: DnsRecord[] = [];
	const add = (purpose: string, name: string, type: DnsRecord["type"], value: string, priority?: number) => records.push({ purpose, name, type, value, priority });
	if (mxHost) add("MX", domain, "MX", mxHost, mxPriority);
	if (spf) add("SPF", domain, "TXT", spf);
	for (const record of dkim) add("DKIM", `${record.selector}._domainkey.${domain}`, record.type, record.value);
	if (dmarc) add("DMARC", `_dmarc.${domain}`, "TXT", dmarc);
	let policy: string | null = null;
	if (sts !== "off" && mxHost) {
		policy = `version: STSv1\r\nmode: ${sts}\r\nmx: ${mxHost}\r\nmax_age: ${sts === "testing" ? 86400 : 604800}\r\n`;
		add("MTA-STS", `_mta-sts.${domain}`, "TXT", `v=STSv1; id=${createHash("sha256").update(policy).digest("hex").slice(0, 20)}`);
	}
	if (tlsReports) add("TLS-RPT", `_smtp._tls.${domain}`, "TXT", `v=TLSRPTv1; rua=mailto:${tlsReports}`);
	return { config, records, policy, policyUrl: policy ? `https://mta-sts.${domain}/.well-known/mta-sts.txt` : null };
}

const canonical = (type: DnsRecord["type"], value: string) => type === "TXT" ? value.trim().replace(/^"(.*)"$/, "$1") : cleanHost(value);
const relevant = (record: DnsRecord, value: string) => record.purpose !== "SPF" || /^v=spf1\b/i.test(canonical("TXT", value));

export interface DnsResolver {
	resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>;
	resolveCname(name: string): Promise<string[]>;
	resolveTxt(name: string): Promise<string[][]>;
}

export async function checkDns(config: DomainConfig, resolver: DnsResolver): Promise<DnsCheck[]> {
	return Promise.all(dnsPlan(config).records.map(async (record): Promise<DnsCheck> => {
		try {
			const values = record.type === "MX" ? (await resolver.resolveMx(record.name)).map(({ exchange, priority }) => ({ value: exchange, priority }))
				: record.type === "CNAME" ? (await resolver.resolveCname(record.name)).map((value) => ({ value, priority: undefined }))
				: (await resolver.resolveTxt(record.name)).map((chunks) => ({ value: chunks.join(""), priority: undefined }));
			const candidates = values.filter(({ value }) => relevant(record, value));
			const matching = candidates.filter(({ value, priority }) => canonical(record.type, value) === canonical(record.type, record.value) && priority === record.priority);
			return { ...record, found: candidates.map(({ value, priority }) => priority == null ? value : `${priority} ${value}`),
				status: !candidates.length ? "missing" : matching.length === 1 && candidates.length === 1 ? "ready" : "conflict" };
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			return { ...record, found: [], status: code === "ENOTFOUND" || code === "ENODATA" ? "missing" : "unavailable" };
		}
	}));
}

interface CloudflareRecord { id: string; type: string; name: string; content: string; priority?: number; proxied?: boolean }

export async function publishMissing(config: DomainConfig, token: string, request = fetch) {
	const api = async <T>(path: string, body?: unknown) => {
		const res = await request(`https://api.cloudflare.com/client/v4${path}`, {
			method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000), redirect: "manual",
		});
		const data = await res.json().catch(() => null) as { success: boolean; result: T; errors?: { message: string }[] } | null;
		if (!res.ok || !data?.success) throw new Error(data?.errors?.[0]?.message || `DNS provider responded with status ${res.status}`);
		return data.result;
	};
	const zones = await api<{ id: string; name: string }[]>(`/zones?${new URLSearchParams({ name: config.domain, status: "active" })}`);
	const zone = zones.find((zone) => zone.name === config.domain);
	if (!zone) throw new Error("No active Cloudflare DNS zone matches this domain. Check token permissions or use manual DNS.");
	return Promise.all(dnsPlan(config).records.map(async (record) => {
		try {
			const base = `/zones/${encodeURIComponent(zone.id)}/dns_records`;
			const existing = await api<CloudflareRecord[]>(`${base}?${new URLSearchParams({ "name.exact": record.name, per_page: "100" })}`);
			const sameName = existing.filter((entry) => entry.name.toLowerCase() === record.name);
			const matches = sameName.filter((entry) => entry.type === record.type && relevant(record, entry.content));
			const exact = matches.filter((entry) => canonical(record.type, entry.content) === canonical(record.type, record.value) && entry.priority === record.priority && !entry.proxied);
			if (matches.length === 1 && exact.length === 1) return { ...record, state: "unchanged" as const };
			// Never remove, rewrite, or replace working MX/TXT/CNAME records.
			if (matches.length || sameName.length >= 100 || sameName.some((entry) => entry.type === "CNAME") || (record.type === "CNAME" && sameName.length)) return { ...record, state: "conflict" as const };
			await api(base, { name: record.name, type: record.type, content: record.value, ttl: 1,
				...(record.type === "MX" ? { priority: record.priority } : record.type === "CNAME" ? { proxied: false } : {}) });
			return { ...record, state: "created" as const };
		} catch (error) { return { ...record, state: "error" as const, error: error instanceof Error ? error.message : "Could not publish record" }; }
	}));
}
