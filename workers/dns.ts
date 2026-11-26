import type { DnsResolver } from "../server/domains";

const types = { MX: 15, TXT: 16, CNAME: 5 } as const;

export function dohResolver(request: typeof fetch = fetch): DnsResolver {
	async function lookup(name: string, type: keyof typeof types) {
		const response = await request(`https://cloudflare-dns.com/dns-query?${new URLSearchParams({ name, type })}`, {
			headers: { Accept: "application/dns-json" }, redirect: "manual", signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) throw new Error("DNS lookup failed");
		const data = await response.json() as { Status: number; Answer?: { type: number; data: string }[] };
		if (data.Status === 3) return [];
		if (data.Status !== 0) throw new Error("DNS lookup did not succeed");
		return (data.Answer ?? []).filter((record) => record.type === types[type]).map((record) => record.data);
	}

	return {
		async resolveMx(name) {
			return (await lookup(name, "MX")).map((value) => {
				const [priority, exchange] = value.split(/\s+/, 2);
				return { priority: Number(priority), exchange };
			});
		},
		resolveCname: (name) => lookup(name, "CNAME"),
		async resolveTxt(name) {
			return (await lookup(name, "TXT")).map((value) => {
				const chunks = [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
				return chunks.length ? chunks.map((chunk) => chunk[1].replace(/\\(\d{3}|.)/g, (_, escaped: string) =>
					/^\d{3}$/.test(escaped) ? String.fromCharCode(Number(escaped)) : escaped)) : [value];
			});
		},
	};
}
