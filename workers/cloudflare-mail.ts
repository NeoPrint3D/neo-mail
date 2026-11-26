import type { CloudflareMailStatus, ForwardingDestination } from "../shared/cloudflare-mail";

type Zone = { id: string; name: string; account: { id: string } };
type RoutingRule = { enabled?: boolean; name?: string; actions?: { type: string; value?: string[] }[]; matchers?: { value?: string }[] };
type Sending = { name: string; enabled: boolean };
type DnsRecord = { content: string; type: string; name: string };
type Envelope<T> = { success: boolean; result: T; errors?: { message: string }[]; result_info?: { total_pages?: number } };

class ProviderError extends Error {
	constructor(message: string, readonly status: number) { super(message); }
}

export function cloudflareMail(token: string, worker: string, account?: string, request: typeof fetch = fetch) {
	async function api<T>(path: string, method = "GET", body?: unknown): Promise<Envelope<T>> {
		const response = await request(`https://api.cloudflare.com/client/v4${path}`, {
			method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(8000),
		});
		const data = await response.json().catch(() => null) as Envelope<T> | null;
		if (!response.ok || !data?.success) throw new ProviderError(data?.errors?.[0]?.message || `Cloudflare API returned ${response.status}`, response.status);
		return data;
	}

	async function pages<T>(path: string) {
		const entries: T[] = [];
		for (let page = 1; page <= 25; page++) {
			const data = await api<T[]>(`${path}${path.includes("?") ? "&" : "?"}page=${page}&per_page=50`);
			entries.push(...data.result);
			if (data.result_info?.total_pages ? page >= data.result_info.total_pages : data.result.length < 50) return entries;
		}
		throw new Error("Too many Cloudflare records to verify safely");
	}

	async function zone(domain: string) {
		const result = (await api<Zone[]>(`/zones?${new URLSearchParams({ status: "active", name: domain, ...(account ? { "account.id": account } : {}) })}`)).result;
		const found = result.find((item) => item.name === domain && (!account || account === item.account.id));
		if (!found) throw new Error("No matching active Cloudflare zone. Check the domain, nameserver delegation, and token scope.");
		return { base: `/zones/${encodeURIComponent(found.id)}`, destinationBase: `/accounts/${encodeURIComponent(found.account.id)}/email/routing/addresses` };
	}

	const matchesWorker = (rule?: RoutingRule | null) => rule?.actions?.length === 1 &&
		rule.actions[0].type === "worker" && rule.actions[0].value?.length === 1 && rule.actions[0].value[0] === worker;
	const missing = (error: unknown) => error instanceof ProviderError && error.status === 404;
	async function routingState(base: string, domain: string) {
		const routing = `${base}/email/routing`;
		const [settings, mx] = await Promise.all([
			api<{ enabled: boolean }>(routing).then(({ result }) => result).catch((error) => { if (missing(error)) return null; throw error; }),
			pages<DnsRecord>(`${base}/dns_records?${new URLSearchParams({ "name.exact": domain, type: "MX" })}`),
		]);
		const [catchAll, exact] = await Promise.all([
			settings?.enabled ? api<RoutingRule | null>(`${routing}/rules/catch_all`).then(({ result }) => result).catch((error) => { if (missing(error)) return null; throw error; }) : null,
			settings?.enabled ? pages<RoutingRule>(`${routing}/rules`) : [],
		]);
		const blockingMx = mx.filter(({ type, name, content }) => type === "MX" && name.toLowerCase() === domain && !/^route[1-3]\.mx\.cloudflare\.net\.?$/i.test(content)).map(({ content }) => content);
		return { routingEnabled: !!settings?.enabled, workerConnected: !!settings?.enabled && !!catchAll?.enabled && !!matchesWorker(catchAll),
			blockingMx, catchAllConflict: !!catchAll?.enabled && !matchesWorker(catchAll),
			overrides: exact.filter((rule) => rule.enabled && !matchesWorker(rule)).map((rule) => rule.matchers?.map(({ value }) => value).filter(Boolean).join(", ") || rule.name || "Unnamed rule"),
		};
	}

	async function sendingState(base: string, domain: string) {
		try {
			const rows = (await api<Sending[]>(`${base}/email/sending/subdomains`)).result;
			const match = rows.find((row) => row.name === domain);
			return { sendingSupported: true, sendingStatus: match ? (match.enabled ? "enabled" : "disabled") : null };
		} catch (error) {
			if (error instanceof ProviderError && [401, 403, 404].includes(error.status)) return { sendingSupported: false, sendingStatus: null };
			throw error;
		}
	}

	return {
		async inspect(domain: string): Promise<CloudflareMailStatus> {
			const { base } = await zone(domain);
			const [routing, sending] = await Promise.all([routingState(base, domain), sendingState(base, domain)]);
			return { ...routing, ...sending };
		},
		async enable(domain: string): Promise<CloudflareMailStatus> {
			const { base } = await zone(domain);
			const path = `${base}/email/routing`;
			const existing = await routingState(base, domain);
			if (existing.catchAllConflict || existing.blockingMx.length) throw new Error("Existing MX or catch-all configuration belongs to another service. Resolve the conflict in Cloudflare before connecting this domain.");
			if (!existing.routingEnabled) await api(`${path}/dns`, "POST", { name: domain });
			// Re-read if onboarding just ran: do not silently replace an enabled catch-all.
			const current = existing.routingEnabled ? existing : await routingState(base, domain);
			if (current.catchAllConflict || current.blockingMx.length) throw new Error("An existing catch-all or conflicting MX prevents connecting the Worker.");
			if (!current.workerConnected) await api(`${path}/rules/catch_all`, "PUT", {
				name: `NeoMail (${worker})`, enabled: true, matchers: [{ type: "all" }], actions: [{ type: "worker", value: [worker] }],
			});
			return this.inspect(domain);
		},
		async enableSending(domain: string): Promise<CloudflareMailStatus> {
			const { base } = await zone(domain);
			if ((await sendingState(base, domain)).sendingStatus !== "enabled") {
				await api(`${base}/email/sending/subdomains`, "POST", { name: domain });
			}
			return this.inspect(domain);
		},
		async destinations(domain: string): Promise<ForwardingDestination[]> {
			const { destinationBase } = await zone(domain);
			const rows = await pages<{ email: string; verified?: string | null }>(destinationBase);
			return rows.map(({ email, verified }) => ({ email, verified: !!verified }));
		},
		async verifyDestination(domain: string, email: string): Promise<ForwardingDestination> {
			const { destinationBase } = await zone(domain);
			const rows = await pages<{ email: string; verified?: string | null }>(destinationBase);
			const existing = rows.find((row) => row.email.toLowerCase() === email);
			if (existing) return { email, verified: !!existing.verified };
			const { result } = await api<{ email: string; verified?: string | null }>(destinationBase, "POST", { email });
			return { email: result.email, verified: !!result.verified };
		},
	};
}
