import type { Env } from "../types";

// Normalize deployment configuration and addresses once for UI, delivery and MCP.
export const normalizeAddress = (address: string) => address.trim().toLowerCase();
export const addressDomain = (address: string) => normalizeAddress(address).split("@").at(-1) ?? "";

export async function mailConfig(env: Pick<Env, "DOMAINS" | "EMAIL_ADDRESSES">) {
	const domains = await env.DOMAINS.names();
	const emailAddresses = [...new Set((env.EMAIL_ADDRESSES ?? []).map(normalizeAddress).filter(Boolean))];
	return { domains, emailAddresses };
}

export function canRouteAddress(address: string, config: Awaited<ReturnType<typeof mailConfig>>) {
	return config.domains.includes(addressDomain(address)) &&
		(!config.emailAddresses.length || config.emailAddresses.includes(normalizeAddress(address)));
}
