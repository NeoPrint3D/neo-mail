import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { hostName } from "./domains";
import { receiveEmail } from "./index";
import { addressDomain, normalizeAddress } from "./lib/domains";
import { RoutingInputSchema, syncCloudflareEmailRouting } from "./routing";
import type { Env } from "./types";

export const routingRoutes = new Hono<{ Bindings: Env }>();

routingRoutes.onError((error, c) => {
	if (error instanceof z.ZodError) return c.json({ error: error.issues[0]?.message || "Invalid routing rule" }, 400);
	if (error instanceof SyntaxError) return c.json({ error: "Invalid request" }, 400);
	console.error("Routing request failed", error);
	return c.json({ error: "Could not complete the routing operation" }, 500);
});

routingRoutes.get("/api/v1/routing", async (c) => {
	const domainParam = c.req.query("domain");
	const domain = domainParam ? hostName.parse(domainParam) : undefined;
	return c.json({
		rules: await c.env.ROUTING.list(domain),
		platform: c.env.platform,
		forwardingVerification: !!c.env.CLOUDFLARE_MAIL,
		smtpInboundPort: c.env.SMTP_INBOUND_PORT,
		smtpOutboundAvailable: !!c.env.SEND_EMAIL,
		cloudflareSyncAvailable: !c.env.platform && !!c.env.CLOUDFLARE_TOKEN,
		inboundWebhookEnabled: !!c.env.INBOUND_WEBHOOK_SECRET,
	});
});

async function checkAliasRule(env: Env, input: z.output<typeof RoutingInputSchema>) {
	if (!await env.DOMAINS.get(input.domain)) return { status: 404, error: "Add this domain in Domains & DNS first" } as const;
	if (input.matchType === "exact" && await env.STORE.head(`mailboxes/${input.localPart}@${input.domain}.json`)) {
		return { status: 409, error: "Alias rules need a different address from an existing inbox." } as const;
	}
	if (input.deliverTo && !await env.STORE.head(`mailboxes/${input.deliverTo}.json`)) {
		return { status: 404, error: "Target local mailbox was not found" } as const;
	}
	if (env.platform && input.enabled && input.action !== "reject") {
		const domains = await env.DOMAINS.names();
		if (input.forwardTo.some((target) => domains.includes(addressDomain(target)))) {
			return { status: 400, error: "Choose external addresses for forwarding, or select a local mailbox" } as const;
		}
	}
}

routingRoutes.post("/api/v1/routing", async (c) => {
	const input = RoutingInputSchema.parse(await c.req.json());
	const problem = await checkAliasRule(c.env, input);
	if (problem) return c.json({ error: problem.error }, problem.status);
	const created = await c.env.ROUTING.create(input);
	if (!created) return c.json({ error: "A routing rule for this address already exists" }, 409);
	return c.json(created, 201);
});

routingRoutes.put("/api/v1/routing/:id", async (c) => {
	const id = c.req.param("id");
	const input = RoutingInputSchema.parse(await c.req.json());
	const problem = await checkAliasRule(c.env, input);
	if (problem) return c.json({ error: problem.error }, problem.status);
	const updated = await c.env.ROUTING.update(id, input);
	if (updated === "missing") return c.json({ error: "Routing rule not found" }, 404);
	if (updated === "duplicate") return c.json({ error: "Another routing rule already uses this address" }, 409);
	return c.json(updated);
});

routingRoutes.delete("/api/v1/routing/:id", async (c) => {
	return await c.env.ROUTING.delete(c.req.param("id"))
		? c.body(null, 204)
		: c.json({ error: "Routing rule not found" }, 404);
});

routingRoutes.post("/api/v1/routing/sync-cloudflare", async (c) => {
	if (c.env.platform === "cloudflare") return c.json({ error: "Configure the domain’s Worker connection in Domains & DNS instead" }, 409);
	if (!c.env.CLOUDFLARE_TOKEN) {
		return c.json({ error: "CLOUDFLARE_TOKEN is not configured on the server" }, 409);
	}
	const { domain } = z.object({ domain: hostName, confirmed: z.literal(true) }).parse(await c.req.json());
	if (!await c.env.DOMAINS.get(domain)) return c.json({ error: "Domain not found" }, 404);
	const rules = await c.env.ROUTING.list(domain);
	try {
		return c.json(await syncCloudflareEmailRouting(domain, rules, c.env.CLOUDFLARE_TOKEN));
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : "Could not sync Cloudflare Email Routing" }, 502);
	}
});

// Optional inbound webhook for a Cloudflare Email Routing relay worker or external mail relay.
routingRoutes.post("/api/inbound", async (c) => {
	const secret = c.env.INBOUND_WEBHOOK_SECRET;
	if (!secret) return c.json({ error: "Inbound webhook is not configured" }, 404);

	const rawBytes = new Uint8Array(await c.req.arrayBuffer());
	const toHeader = c.req.header("x-inbound-to") || "";
	const sigHeader = c.req.header("x-inbound-signature") || "";
	const timestampHeader = c.req.header("x-inbound-timestamp") || "";
	if (!toHeader || !sigHeader || !timestampHeader) {
		return c.json({ error: "Missing inbound signature headers" }, 401);
	}
	const ts = Number(timestampHeader);
	if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
		return c.json({ error: "Expired inbound timestamp" }, 401);
	}
	const expected = createHmac("sha256", secret)
		.update(`${timestampHeader}.${normalizeAddress(toHeader)}.`)
		.update(rawBytes)
		.digest("hex");
	const provided = sigHeader.replace(/^sha256=/i, "");
	const match = /^[a-f0-9]{64}$/i.test(provided) &&
		timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
	if (!match) return c.json({ error: "Invalid inbound signature" }, 401);

	let rejected: string | null = null;
	await receiveEmail({
		to: normalizeAddress(toHeader),
		raw: new ReadableStream({ start(controller) { controller.enqueue(rawBytes); controller.close(); } }),
		rawSize: rawBytes.byteLength,
		setReject: (reason) => { rejected = reason; },
	}, c.env);

	if (rejected) return c.json({ action: "reject", reason: rejected }, 422);
	return c.json({ action: "accept" }, 200);
});
