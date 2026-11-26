import { Hono } from "hono";
import { z } from "zod";
import { mailConfig, canRouteAddress } from "./lib/domains";
import { listMailboxes } from "./lib/email-helpers";
import { resolveInboundRecipient } from "./routing";
import { deliverWebhook, mailWebhookEvent, webhookDestination } from "./webhooks";
import type { Env } from "./types";

export const webhookRoutes = new Hono<{ Bindings: Env }>();
const path = "/api/v1/webhooks";
const id = z.string().uuid();
const create = z.object({ recipient: z.string().trim().toLowerCase().email().max(254), endpoint: z.string().trim().max(2000) });

webhookRoutes.onError((error, c) => {
	if (error instanceof SyntaxError || error instanceof z.ZodError) return c.json({ error: "Enter a valid incoming address and webhook URL" }, 400);
	return c.json({ error: "Could not complete the webhook operation" }, 500);
});

webhookRoutes.get(path, async (c) => {
	const [rules, boxes, config, webhooks] = await Promise.all([
		c.env.ROUTING.list(), listMailboxes(c.env.STORE), mailConfig(c.env), c.env.WEBHOOKS?.list() ?? [],
	]);
	const sources = [...new Set([
		...boxes.map(({ id }) => id), ...rules.filter((r) => r.enabled && r.matchType === "exact" && r.action !== "reject").map((r) => r.address),
	])].filter((address) => canRouteAddress(address, config)).sort();
	return c.json({ webhooks, sources, allowedOrigins: c.env.WEBHOOK_ALLOWED_ORIGINS ?? [] });
});

webhookRoutes.post(path, async (c) => {
	const { recipient, endpoint } = create.parse(await c.req.json());
	const destination = webhookDestination(endpoint, c.env.WEBHOOK_ALLOWED_ORIGINS);
	if (!destination || destination.origin === (c.env.APP_URL ?? new URL(c.req.url)).origin) {
		return c.json({ error: "Use a supported automation webhook URL or an HTTPS origin approved by the server operator." }, 400);
	}
	const plan = await resolveInboundRecipient(c.env, recipient);
	if (!plan.accept || plan.rule?.matchType === "catch_all") return c.json({ error: "Choose an active inbox or exact alias" }, 400);
	if (!c.env.WEBHOOKS) return c.json({ error: "Webhooks are unavailable" }, 503);
	const saved = await c.env.WEBHOOKS.create(recipient, destination.toString());
	return saved ? c.json(saved, 201) : c.json({ error: "This webhook already exists or the limit has been reached" }, 409);
});

webhookRoutes.put(`${path}/:id`, async (c) => {
	const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
	const changed = await c.env.WEBHOOKS?.setEnabled(id.parse(c.req.param("id")), enabled);
	return changed ? c.body(null, 204) : c.json({ error: "Webhook not found" }, 404);
});

webhookRoutes.delete(`${path}/:id`, async (c) => {
	const deleted = await c.env.WEBHOOKS?.delete(id.parse(c.req.param("id")));
	return deleted ? c.body(null, 204) : c.json({ error: "Webhook not found" }, 404);
});

webhookRoutes.post(`${path}/:id/test`, async (c) => {
	const hook = await c.env.WEBHOOKS?.get(id.parse(c.req.param("id")));
	if (!hook) return c.json({ error: "Webhook not found" }, 404);
	if (!await c.env.AUTH.allowAttempt("webhook:test", 20)) return c.json({ error: "Too many tests. Wait a few minutes and try again." }, 429);
	const status = await deliverWebhook(c.env, hook, mailWebhookEvent("webhook.test", hook.recipient));
	return c.json({ status });
});
