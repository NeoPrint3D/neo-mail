// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import type { McpScope } from "../shared/mcp";
import { accountRoutes, sessionCookie } from "./account-routes";
import { domainRoutes } from "./domain-routes";
import { dnsPlan } from "./domains";
import { app as apiApp } from "./index";
import { handleMcp } from "./mcp";
import { pushRoutes } from "./push-routes";
import { routingRoutes } from "./routing-routes";
import type { Env } from "./types";

export function createApp(render: (request: Request) => Response | Promise<Response>) {
	const app = new Hono<{ Bindings: Env; Variables: { mcpScope: McpScope } }>();
	app.get("/healthz", (c) => c.text("ok"));
	app.get("/.well-known/mta-sts.txt", async (c) => {
		const host = new URL(c.req.url).hostname.toLowerCase();
		const domain = host.startsWith("mta-sts.") && await c.env.DOMAINS.get(host.slice(8));
		const policy = domain && dnsPlan(domain).policy;
		if (!policy) return c.text("No MTA-STS policy at this hostname", 404);
		return c.text(policy, 200, { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" });
	});

	const largeBody = bodyLimit({ maxSize: 24 * 1024 * 1024, onError: (c) => c.json({ error: "Request exceeds 24 MiB" }, 413) });
	const smallBody = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "Request exceeds 64 KiB" }, 413) });
	app.use("*", async (c, next) => {
		const path = c.req.path;
		const method = c.req.method;
		const isMcp = path === "/mcp";
		const reads = method === "GET" || method === "HEAD";
		const requestOrigin = c.req.header("Origin");
		const origin = c.env.APP_URL?.origin || new URL(c.req.url).origin;
		c.header("Cache-Control", "no-store");
		c.header("X-Content-Type-Options", "nosniff");
		c.header("X-Frame-Options", "DENY");
		c.header("Referrer-Policy", "same-origin");
		if (path === "/api/inbound" && method === "POST") return largeBody(c, next);

		if (isMcp) {
			if (requestOrigin && requestOrigin !== origin) return c.json({ error: "Cross-origin request denied" }, 403);
			const authorization = c.req.header("Authorization");
			const scope = authorization ? await c.env.AUTH.verifyToken(authorization) : null;
			if (!scope) return c.json({ error: "Provide a valid MCP Bearer token" }, 401, { "WWW-Authenticate": 'Bearer realm="NeoMail MCP"' });
			c.set("mcpScope", scope);
			return reads ? next() : largeBody(c, next);
		}
		// Never authorize cookie-backed writes without the deployed browser origin.
		if (!reads && requestOrigin !== origin) return c.json({ error: "Cross-origin request denied" }, 403);
		const cookie = getCookie(c, sessionCookie);
		const session = cookie ? await c.env.AUTH.sessionEmail(cookie) : undefined;
		if (reads && ["/login", "/setup", "/login.data", "/setup.data"].includes(path)) {
			if (session) return c.redirect("/");
			const target = await c.env.AUTH.configured() ? "/login" : "/setup";
			if (path === "/login" || path === "/setup") {
				if (path !== target) return c.redirect(target);
			}
			return next();
		}
		const publicRoute = (reads && path === "/api/auth/session") ||
			(method === "POST" && (path === "/api/auth/login" || path === "/api/auth/setup"));
		if (!session && !publicRoute) {
			if (path.startsWith("/api/")) return c.json({ error: "Sign in to continue" }, 401);
			return c.redirect(await c.env.AUTH.configured() ? "/login" : "/setup");
		}
		return reads ? next() : (path.startsWith("/api/auth/") || path.startsWith("/api/v1/domains") || path.startsWith("/api/v1/routing") ? smallBody : largeBody)(c, next);
	});
	app.all("/mcp", (c) => handleMcp(c.req.raw, c.env, c.var.mcpScope));
	app.route("/", accountRoutes);
	app.route("/", pushRoutes);
	app.route("/", domainRoutes);
	app.route("/", routingRoutes);
	app.route("/", apiApp);
	app.all("/api/*", (c) => c.json({ error: "Endpoint not found" }, 404));
	app.all("*", (c) => render(c.req.raw));
	return app;
}
