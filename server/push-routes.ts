import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { sessionCookie } from "./account-routes";
import { deliverPush, pushSubscription } from "./push";
import type { Env } from "./types";

export const pushRoutes = new Hono<{ Bindings: Env }>();
const path = "/api/auth/push";
const deviceId = z.string().regex(/^[0-9a-f]{64}$/);

pushRoutes.onError((error, c) => {
	if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: "Invalid browser notification subscription" }, 400);
	return c.json({ error: "Could not update notification settings" }, 500);
});

pushRoutes.get(path, async (c) => {
	const publicKey = c.env.PUSH_KEYS?.publicKey ?? null;
	return c.json({ publicKey, devices: await c.env.PUSH_DEVICES?.list(publicKey ?? undefined) ?? [] });
});

pushRoutes.put(path, async (c) => {
	const { PUSH_DEVICES: devices, PUSH_KEYS: keys } = c.env;
	const session = getCookie(c, sessionCookie);
	if (!session) return c.json({ error: "Sign in to continue" }, 401);
	if (!devices || !keys) return c.json({ error: "Web Push is not configured" }, 503);
	const { label, subscription } = z.object({ label: z.string().trim().min(1).max(80), subscription: pushSubscription }).parse(await c.req.json());
	const saved = await devices.save(subscription, label, keys.publicKey, session);
	return saved ? c.json(saved) : c.json({ error: "This subscription expired or the device limit was reached. Remove an old device and try again." }, 409);
});

pushRoutes.delete(`${path}/:id`, async (c) => {
	await c.env.PUSH_DEVICES?.remove(deviceId.parse(c.req.param("id")));
	return c.body(null, 204);
});

pushRoutes.post(`${path}/:id/test`, async (c) => {
	const { PUSH_DEVICES: devices, PUSH_KEYS: keys } = c.env;
	if (!devices || !keys) return c.json({ error: "Web Push is not configured" }, 503);
	const id = deviceId.parse(c.req.param("id"));
	const device = (await devices.rows(keys.publicKey)).find((row) => row.id === id);
	if (!device) return c.json({ error: "This device is not registered for notifications" }, 404);
	if (!await c.env.AUTH.allowAttempt(`push:test:${id}`, 4) || !await c.env.AUTH.allowAttempt("push:test:workspace", 12)) {
		return c.json({ error: "Too many tests. Wait a few minutes and try again." }, 429);
	}
	const result = await deliverPush(c.env, device, "test");
	if (result === "expired") return c.json({ error: "This subscription expired. Turn notifications on again." }, 410);
	if (result === "failed") return c.json({ error: "The push service could not accept the notification. Try again in a moment." }, 502);
	return c.body(null, 204);
});
