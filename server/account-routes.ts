import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { mcpIssuablePermissions } from "../shared/mcp";
import { listMailboxes } from "./lib/email-helpers";
import type { Env } from "./types";

export const sessionCookie = "inbox_session";
const login = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(256) });
const strongPassword = z.string().min(12, "Use at least 12 characters").max(256);
const setup = login.extend({ code: z.string().trim().min(1).max(256), password: strongPassword });
const passwordChange = z.object({ current: login.shape.password, password: strongPassword });

export const accountRoutes = new Hono<{ Bindings: Env }>();

accountRoutes.onError((error, c) => {
	if (error instanceof z.ZodError) return c.json({ error: error.issues[0]?.message || "Invalid request" }, 400);
	if (error instanceof SyntaxError) return c.json({ error: "Invalid request" }, 400);
	console.error("Account request failed", error);
	return c.json({ error: "Account request could not be completed" }, 500);
});

accountRoutes.get("/api/auth/session", async (c) => {
	const token = getCookie(c, sessionCookie);
	return c.json({ email: (token && await c.env.AUTH.sessionEmail(token)) || null, setupRequired: !await c.env.AUTH.configured(), setupAvailable: await c.env.AUTH.canSetup() });
});
let authJobs = 0;
accountRoutes.post("/api/auth/:action{login|setup}", async (c) => {
	const auth = c.env.AUTH;
	if (authJobs >= 4) return c.json({ error: "Too many attempts. Try again in a few minutes." }, 429);
	const initializing = c.req.param("action") === "setup";
	let email: string, accepted: boolean;
	authJobs++;
	try {
		if (!await auth.allowAttempt("login:global", 80) || !await auth.allowAttempt(`login:${c.env.requestIp || "local"}`))
			return c.json({ error: "Too many attempts. Try again in a few minutes." }, 429);
		if (initializing && await auth.configured()) return c.json({ error: "An owner account already exists" }, 409);
		if (initializing && !await auth.canSetup()) return c.json({ error: "Set a SETUP_CODE secret of at least 20 characters before creating the owner account." }, 503);
		if (initializing) {
			const input = setup.parse(await c.req.json()); email = input.email;
			accepted = await auth.initialize(input.code, input.email, input.password);
		} else {
			const input = login.parse(await c.req.json()); email = input.email;
			accepted = await auth.verify(input.email, input.password);
		}
	} finally { authJobs--; }
	if (!accepted) return c.json({ error: initializing ? "Invalid or already used setup code" : "Email or password is incorrect" }, 401);
	const oldToken = getCookie(c, sessionCookie);
	if (oldToken) {
		await c.env.PUSH_DEVICES?.removeForSession(oldToken);
		await auth.deleteSession(oldToken);
	}
	const { token, maxAge } = await auth.createSession();
	setCookie(c, sessionCookie, token, { path: "/", httpOnly: true, sameSite: "Lax", secure: (c.env.APP_URL ?? new URL(c.req.url)).protocol === "https:", maxAge });
	return c.json({ email }, initializing ? 201 : 200);
});

accountRoutes.post("/api/auth/logout", async (c) => {
	const token = getCookie(c, sessionCookie);
	if (token) {
		const body = await c.req.json().catch(() => null) as { deviceId?: unknown } | null;
		const deviceId = typeof body?.deviceId === "string" && /^[0-9a-f]{64}$/.test(body.deviceId) ? body.deviceId : undefined;
		await c.env.PUSH_DEVICES?.removeForSession(token, deviceId);
		await c.env.AUTH.deleteSession(token);
	}
	deleteCookie(c, sessionCookie, { path: "/", secure: (c.env.APP_URL ?? new URL(c.req.url)).protocol === "https:" });
	return c.body(null, 204);
});

accountRoutes.post("/api/auth/password", async (c) => {
	if (!await c.env.AUTH.allowAttempt(`password:${c.env.requestIp || "local"}`, 5)) return c.json({ error: "Try again in a few minutes" }, 429);
	const input = passwordChange.parse(await c.req.json());
	if (!await c.env.AUTH.changePassword(input.current, input.password, getCookie(c, sessionCookie) || "")) return c.json({ error: "Current password is incorrect" }, 400);
	await c.env.PUSH_DEVICES?.clear();
	return c.body(null, 204);
});

accountRoutes.get("/api/auth/mcp-tokens", async (c) => c.json(await c.env.AUTH.listTokens()));
accountRoutes.post("/api/auth/mcp-tokens", async (c) => {
	const { name, permission, mailboxes } = z.object({
		name: z.string().trim().min(1).max(80),
		permission: z.enum(mcpIssuablePermissions).default("read"),
		mailboxes: z.array(z.string().trim().toLowerCase().email().max(254)).min(1).max(100).nullable(),
	}).parse(await c.req.json());
	if (permission === "admin" && mailboxes !== null) return c.json({ error: "Workspace admin requires access to all current and future mailboxes" }, 400);
	const ids = mailboxes && [...new Set(mailboxes)];
	if (ids) {
		const registered = new Set((await listMailboxes(c.env.STORE)).filter(({ disposable }) => !disposable).map(({ id }) => id));
		if (ids.some((id) => !registered.has(id))) return c.json({ error: "One or more selected mailboxes are unavailable for MCP access" }, 400);
	}
	const result = await c.env.AUTH.createToken(name, { permission, mailboxes: ids });
	return result ? c.json(result, 201) : c.json({ error: "Revoke an unused token first" }, 409);
});
accountRoutes.delete("/api/auth/mcp-tokens/:id", async (c) => await c.env.AUTH.revokeToken(c.req.param("id")) ? c.body(null, 204) : c.json({ error: "Token not found" }, 404));
