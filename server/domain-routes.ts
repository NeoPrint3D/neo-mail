import { Hono } from "hono";
import { z } from "zod";
import { checkDns, dnsPlan, DomainSchema, hostName, publishMissing } from "./domains";
import { listMailboxes } from "./lib/email-helpers";
import type { Env } from "./types";

export const domainRoutes = new Hono<{ Bindings: Env }>();

domainRoutes.onError((error, c) => {
	if (error instanceof z.ZodError) return c.json({ error: error.issues[0]?.message || "Invalid domain setup" }, 400);
	if (error instanceof SyntaxError) return c.json({ error: "Invalid request" }, 400);
	console.error("Domain operation failed", error);
	return c.json({ error: "Could not complete the domain operation" }, 500);
});
domainRoutes.get("/api/v1/domains", async (c) => c.json({
	domains: (await c.env.DOMAINS.list()).map(dnsPlan), platform: c.env.platform, cloudflareConfigured: !!c.env.CLOUDFLARE_MAIL, defaultMxHost: c.env.MAIL_HOSTNAME,
	autoPublish: !!c.env.CLOUDFLARE_TOKEN, smtpTls: c.env.SMTP_TLS,
}));
domainRoutes.post("/api/v1/domains", async (c) => {
	const input = DomainSchema.parse(await c.req.json());
	return await c.env.DOMAINS.create(input) ? c.json(dnsPlan(input), 201) : c.json({ error: "Domain already exists" }, 409);
});
domainRoutes.put("/api/v1/domains/:domain", async (c) => {
	const domain = hostName.parse(c.req.param("domain"));
	const input = DomainSchema.parse({ ...await c.req.json(), domain });
	return await c.env.DOMAINS.update(input) ? c.json(dnsPlan(input)) : c.json({ error: "Domain not found" }, 404);
});
domainRoutes.delete("/api/v1/domains/:domain", async (c) => {
	const domain = hostName.parse(c.req.param("domain"));
	if ((await listMailboxes(c.env.STORE)).some((mailbox) => mailbox.domain === domain)) return c.json({ error: "Disconnect this domain's mailboxes before removing it" }, 409);
	if ((await c.env.ROUTING.list(domain)).length) return c.json({ error: "Remove this domain's routing rules before removing it" }, 409);
	return await c.env.DOMAINS.delete(domain) ? c.body(null, 204) : c.json({ error: "Domain not found" }, 404);
});
domainRoutes.get("/api/v1/domains/:domain/check", async (c) => {
	const config = await c.env.DOMAINS.get(hostName.parse(c.req.param("domain")));
	return config ? c.json(await checkDns(config, c.env.DNS)) : c.json({ error: "Domain not found" }, 404);
});
domainRoutes.get("/api/v1/domains/:domain/cloudflare", async (c) => {
	const domain = hostName.parse(c.req.param("domain"));
	if (!c.env.CLOUDFLARE_MAIL) return c.json({ error: "Configure the Cloudflare API token for this Worker first" }, 409);
	if (!await c.env.DOMAINS.get(domain)) return c.json({ error: "Domain not found" }, 404);
	try { return c.json(await c.env.CLOUDFLARE_MAIL.inspect(domain)); }
	catch (error) { return c.json({ error: error instanceof Error ? error.message : "Cloudflare status check failed" }, 502); }
});
domainRoutes.post("/api/v1/domains/:domain/cloudflare", async (c) => {
	const domain = hostName.parse(c.req.param("domain"));
	const { action } = z.object({ confirmed: z.literal(true), action: z.enum(["receive", "send"]) }).parse(await c.req.json());
	const provider = c.env.CLOUDFLARE_MAIL;
	if (!provider) return c.json({ error: "Configure the Cloudflare API token for this Worker first" }, 409);
	if (!await c.env.DOMAINS.get(domain)) return c.json({ error: "Domain not found" }, 404);
	try { return c.json(await (action === "receive" ? provider.enable(domain) : provider.enableSending(domain))); }
	catch (error) { return c.json({ error: error instanceof Error ? error.message : "Cloudflare connection failed" }, 502); }
});
domainRoutes.get("/api/v1/domains/:domain/cloudflare/destinations", async (c) => {
	const domain = hostName.parse(c.req.param("domain"));
	if (!c.env.CLOUDFLARE_MAIL) return c.json({ error: "Configure the Cloudflare API token for this Worker first" }, 409);
	if (!await c.env.DOMAINS.get(domain)) return c.json({ error: "Domain not found" }, 404);
	try { return c.json(await c.env.CLOUDFLARE_MAIL.destinations(domain)); }
	catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not load forwarding destinations" }, 502); }
});
domainRoutes.post("/api/v1/domains/:domain/cloudflare/destinations", async (c) => {
	const domain = hostName.parse(c.req.param("domain"));
	const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(await c.req.json());
	if (!c.env.CLOUDFLARE_MAIL) return c.json({ error: "Configure the Cloudflare API token for this Worker first" }, 409);
	if (!await c.env.DOMAINS.get(domain)) return c.json({ error: "Domain not found" }, 404);
	if ((await c.env.DOMAINS.names()).includes(email.split("@")[1])) return c.json({ error: "Use an external forwarding destination. To route to an inbox in this workspace, choose a local mailbox instead." }, 400);
	try { return c.json(await c.env.CLOUDFLARE_MAIL.verifyDestination(domain, email), 201); }
	catch (error) { return c.json({ error: error instanceof Error ? error.message : "Could not register the forwarding destination" }, 502); }
});
domainRoutes.post("/api/v1/domains/:domain/publish", async (c) => {
	if (!c.env.CLOUDFLARE_TOKEN) return c.json({ error: "Automatic DNS publishing is not configured" }, 409);
	const config = await c.env.DOMAINS.get(hostName.parse(c.req.param("domain")));
	if (!config) return c.json({ error: "Domain not found" }, 404);
	z.object({ confirmed: z.literal(true) }).parse(await c.req.json());
	try { return c.json(await publishMissing(config, c.env.CLOUDFLARE_TOKEN)); }
	catch (error) { return c.json({ error: error instanceof Error ? error.message : "DNS publication failed" }, 502); }
});
