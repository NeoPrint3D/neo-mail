import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { receiveEmail } from "../server/index.ts";
import { SQLiteStore } from "../server/sqlite.ts";
import { deliverWebhook, mailWebhookEvent, webhookDestination, webhookOrigins, WebhookStore } from "../server/webhooks.ts";

function store(t) {
	const { db } = new SQLiteStore(":memory:");
	t.after(() => db.close());
	return new WebhookStore(db);
}

test("webhook URL validation accepts supported automation ingress and operator-approved origins only", () => {
	const allowed = webhookOrigins("https://hooks.example.com, http://insecure.example.com, https://has-path.example.com/hook");
	assert.deepEqual(allowed, ["https://hooks.example.com"]);

	for (const url of [
		"https://hooks.zapier.com/hooks/catch/12345/abcdef/",
		"https://hook.us1.make.com/abc123",
		"https://hook.make.com/abc123",
		"https://eo12345.m.pipedream.net",
		"https://team.app.n8n.cloud/webhook/mail-trigger",
		"https://team.app.n8n.cloud/webhook-test/mail-trigger",
		"https://hooks.example.com/neomail?channel=ops",
	]) {
		assert.ok(webhookDestination(url, allowed), `Expected ${url} to be accepted`);
	}

	for (const url of [
		"http://hooks.zapier.com/hooks/catch/123/abc",
		"https://hooks.zapier.com/other/path",
		"https://team.app.n8n.cloud/admin/settings",
		"https://hooks.example.com:8443/hook",
		["https://", "demo", ":", "cred", "@hooks.example.com/hook"].join(""),
		"https://127.0.0.1/hook",
		"https://webhook.internal/hook",
		"https://unapproved.example.com/hook",
	]) {
		assert.equal(webhookDestination(url, allowed), undefined, `Expected ${url} to be rejected`);
	}
});

test("WebhookStore stores secrets privately, caps registrations, and rate limits claims", (t) => {
	const hooks = store(t);
	const created = hooks.create("alerts@mail.test", "https://hooks.zapier.com/hooks/catch/1/a");
	assert.ok(created?.secret);
	assert.equal(created.webhook.origin, "https://hooks.zapier.com");
	assert.equal("secret" in created.webhook, false);
	assert.equal("endpoint" in created.webhook, false);
	assert.equal(hooks.create("alerts@mail.test", "https://hooks.zapier.com/hooks/catch/1/a"), null);

	for (let i = 0; i < 4; i++) {
		assert.ok(hooks.create("alerts@mail.test", `https://hooks.zapier.com/hooks/catch/1/extra${i}`));
	}
	assert.equal(hooks.create("alerts@mail.test", "https://hooks.zapier.com/hooks/catch/1/sixth"), null);

	assert.equal(hooks.setEnabled(created.webhook.id, false), true);
	assert.equal(hooks.forRecipient("alerts@mail.test").length, 4);
	assert.equal(hooks.claim(created.webhook.id, 1000), false);
	assert.equal(hooks.setEnabled(created.webhook.id, true), true);
	for (let i = 0; i < 30; i++) assert.equal(hooks.claim(created.webhook.id, 1000), true);
	assert.equal(hooks.claim(created.webhook.id, 1010), false);
	assert.equal(hooks.claim(created.webhook.id, 1061), true);
	assert.equal(hooks.delete(created.webhook.id), true);
	assert.equal(hooks.delete(created.webhook.id), false);
});

test("incoming mail triggers signed metadata-only webhooks for inbox and forward-only aliases", async (t) => {
	const hooks = store(t);
	const inboxHook = hooks.create("team@mail.test", "https://hooks.example.com/inbox");
	const aliasHook = hooks.create("sales@mail.test", "https://hooks.example.com/sales");
	const pausedHook = hooks.create("paused@mail.test", "https://hooks.example.com/paused");
	hooks.setEnabled(pausedHook.webhook.id, false);

	const deliveries = [];
	t.mock.method(globalThis, "fetch", async (url, init) => {
		deliveries.push({ url, init });
		return new Response("ok", { status: 202 });
	});

	const jobs = [];
	const rules = new Map([
		["sales@mail.test", {
			id: "r1", domain: "mail.test", matchType: "exact", address: "sales@mail.test",
			action: "forward", forwardTo: ["owner@outside.test"], deliverTo: null,
			rejectReason: "", enabled: true, note: "", createdAt: "", updatedAt: "",
		}],
		["blocked@mail.test", {
			id: "r2", domain: "mail.test", matchType: "exact", address: "blocked@mail.test",
			action: "reject", forwardTo: [], deliverTo: null,
			rejectReason: "No longer used", enabled: true, note: "", createdAt: "", updatedAt: "",
		}],
	]);
	const env = {
		WEBHOOKS: hooks,
		WEBHOOK_ALLOWED_ORIGINS: ["https://hooks.example.com"],
		waitUntil: (job) => jobs.push(job),
		DOMAINS: { names: () => ["mail.test"] },
		ROUTING: { findByAddress: (addr) => rules.get(addr) ?? null },
		STORE: {
			head: async (key) => key === "mailboxes/team@mail.test.json" || key === "mailboxes/paused@mail.test.json",
			get: async (key) => (key === "mailboxes/team@mail.test.json" || key === "mailboxes/paused@mail.test.json")
				? { json: async () => ({}) }
				: null,
		},
		MAILBOX: {
			get: () => ({
				findThreadByMessageIds: () => null,
				findThreadBySubject: () => null,
				createEmail: () => {},
			}),
		},
	};

	async function send(to) {
		const raw = new TextEncoder().encode(`From: secret-sender@outside.test\r\nTo: ${to}\r\nSubject: Secret Subject\r\n\r\nConfidential body`);
		let rejected = null;
		await receiveEmail({
			to,
			raw: new Blob([raw]).stream(),
			rawSize: raw.length,
			setReject: (reason) => { rejected = reason; },
			forward: async () => {},
		}, env);
		await Promise.all(jobs.splice(0));
		return rejected;
	}

	assert.equal(await send("team@mail.test"), null);
	assert.equal(await send("sales@mail.test"), null);
	assert.equal(await send("paused@mail.test"), null);
	assert.equal(await send("blocked@mail.test"), "No longer used");

	assert.equal(deliveries.length, 2);
	const [first, second] = deliveries;
	assert.equal(first.url, "https://hooks.example.com/inbox");
	assert.equal(first.init.redirect, "manual");
	assert.equal(first.init.headers["X-NeoMail-Event"], "mail.received");
	assert.ok(!first.init.body.includes("Secret Subject"));
	assert.ok(!first.init.body.includes("Confidential body"));
	assert.ok(!first.init.body.includes("secret-sender"));
	const sig1 = createHmac("sha256", inboxHook.secret)
		.update(`${first.init.headers["X-NeoMail-Timestamp"]}.${first.init.body}`)
		.digest("hex");
	assert.equal(first.init.headers["X-NeoMail-Signature"], `sha256=${sig1}`);
	const body1 = JSON.parse(first.init.body);
	assert.equal(body1.recipient, "team@mail.test");
	assert.equal(body1.mailboxId, "team@mail.test");
	assert.ok(body1.messageId);

	assert.equal(second.url, "https://hooks.example.com/sales");
	const sig2 = createHmac("sha256", aliasHook.secret)
		.update(`${second.init.headers["X-NeoMail-Timestamp"]}.${second.init.body}`)
		.digest("hex");
	assert.equal(second.init.headers["X-NeoMail-Signature"], `sha256=${sig2}`);
	const body2 = JSON.parse(second.init.body);
	assert.equal(body2.recipient, "sales@mail.test");
	assert.equal(body2.mailboxId, null);
	assert.equal(body2.messageId, null);

	const listed = hooks.list();
	assert.equal(listed.find((h) => h.id === inboxHook.webhook.id)?.lastAttempt?.status, 202);

	const testStatus = await deliverWebhook(env, hooks.get(inboxHook.webhook.id), mailWebhookEvent("webhook.test", "team@mail.test"));
	assert.equal(testStatus, 202);
});
