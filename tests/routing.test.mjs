import assert from "node:assert/strict";
import { test } from "node:test";
import { receiveEmail } from "../server/index.ts";
import { RoutingInputSchema, syncCloudflareEmailRouting } from "../server/routing.ts";

test("RoutingInputSchema validates alias forwarding, catch-all, and self-loop protection", () => {
	const forwardRule = RoutingInputSchema.parse({
		domain: "Example.COM",
		matchType: "exact",
		localPart: "Sales",
		action: "forward",
		forwardTo: ["Me@Gmail.com", "me@gmail.com", "ops@partner.org"],
	});
	assert.equal(forwardRule.domain, "example.com");
	assert.equal(forwardRule.localPart, "sales");
	assert.deepEqual(forwardRule.forwardTo, ["Me@Gmail.com", "me@gmail.com", "ops@partner.org"].map((e) => e.toLowerCase()));

	const catchAll = RoutingInputSchema.parse({
		domain: "example.com",
		matchType: "catch_all",
		action: "forward",
		forwardTo: ["inbox@external.test"],
	});
	assert.equal(catchAll.matchType, "catch_all");

	assert.throws(() => RoutingInputSchema.parse({
		domain: "example.com",
		matchType: "exact",
		localPart: "sales",
		action: "forward",
		forwardTo: [],
	}), /at least one destination/);

	assert.throws(() => RoutingInputSchema.parse({
		domain: "example.com",
		matchType: "exact",
		localPart: "sales",
		action: "forward",
		forwardTo: ["sales@example.com"],
	}), /forward directly to itself/);

	assert.throws(() => RoutingInputSchema.parse({
		domain: "example.com",
		matchType: "exact",
		localPart: "sales",
		action: "mailbox",
		deliverTo: null,
	}), /local mailbox/);
});

test("syncCloudflareEmailRouting syncs forward, reject, and catch-all rules while skipping local-copy rules", async () => {
	const calls = [];
	const fakeCf = async (url, init) => {
		const path = new URL(url).pathname;
		calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : null });
		if (path.endsWith("/zones")) {
			return Response.json({ success: true, result: [{ id: "z1", name: "example.com" }] });
		}
		if (path.endsWith("/email/routing/rules") && init.method === "GET") {
			return Response.json({
				success: true,
				result: [{
					id: "r-existing",
					matchers: [{ type: "literal", field: "to", value: "billing@example.com" }],
					actions: [{ type: "forward", value: ["old@gmail.com"] }],
				}],
			});
		}
		return Response.json({ success: true, result: {} });
	};

	const results = await syncCloudflareEmailRouting("example.com", [
		{
			id: "1",
			domain: "example.com",
			matchType: "exact",
			address: "sales@example.com",
			action: "forward",
			forwardTo: ["owner@gmail.com"],
			deliverTo: null,
			rejectReason: "Mailbox unavailable",
			enabled: true,
			note: "Sales alias",
			createdAt: "",
			updatedAt: "",
		},
		{
			id: "2",
			domain: "example.com",
			matchType: "exact",
			address: "billing@example.com",
			action: "forward",
			forwardTo: ["finance@gmail.com"],
			deliverTo: null,
			rejectReason: "Mailbox unavailable",
			enabled: true,
			note: "Billing alias",
			createdAt: "",
			updatedAt: "",
		},
		{
			id: "3",
			domain: "example.com",
			matchType: "exact",
			address: "team-alias@example.com",
			action: "mailbox",
			forwardTo: [],
			deliverTo: "team@example.com",
			rejectReason: "Mailbox unavailable",
			enabled: true,
			note: "",
			createdAt: "",
			updatedAt: "",
		},
		{
			id: "4",
			domain: "example.com",
			matchType: "catch_all",
			address: "*@example.com",
			action: "reject",
			forwardTo: [],
			deliverTo: null,
			rejectReason: "No catch-all",
			enabled: true,
			note: "",
			createdAt: "",
			updatedAt: "",
		},
	], "cf-test-token", fakeCf);

	assert.deepEqual(results.map((r) => [r.address, r.state]), [
		["sales@example.com", "created"],
		["billing@example.com", "updated"],
		["team-alias@example.com", "skipped"],
		["*@example.com", "updated"],
	]);
	assert.ok(calls.some((c) => c.method === "POST" && c.path.endsWith("/email/routing/rules")));
	assert.ok(calls.some((c) => c.method === "PUT" && c.path.endsWith("/email/routing/rules/r-existing")));
	assert.ok(calls.some((c) => c.method === "PUT" && c.path.endsWith("/email/routing/rules/catch_all")));
});

test("Cloudflare receiveEmail re-sends via Email Sending when forwarding back to sender address, with native fallback", async () => {
	const stored = [];
	const sent = [];
	const nativeForwards = [];
	let failSend = false;

	const env = {
		platform: "cloudflare",
		DOMAINS: { names: async () => ["neomail.test"] },
		ROUTING: { findByAddress: async () => null },
		STORE: {
			head: async (key) => key === "mailboxes/drew@neomail.test.json",
			get: async (key) => key === "mailboxes/drew@neomail.test.json"
				? { json: async () => ({ forwarding: { enabled: true, targets: ["drew@ronsman.test", "backup@other.test"], keepCopy: true } }) }
				: null,
		},
		MAILBOX: {
			get: (mailbox) => ({
				findThreadByMessageIds: async () => null,
				findThreadBySubject: async () => null,
				createEmail: async (_folder, data) => stored.push({ mailbox, data }),
			}),
		},
		SEND_EMAIL: async (msg) => {
			if (failSend) throw new Error("Email Sending disabled");
			sent.push(msg);
			return { messageId: "new-id@neomail.test" };
		},
	};

	const rawSelf = new TextEncoder().encode("From: Drew <drew+test@ronsman.test>\r\nTo: drew@neomail.test\r\nMessage-ID: <orig-1@mail.gmail.com>\r\nSubject: Self test\r\n\r\nHello");
	await receiveEmail({
		from: "drew+test@ronsman.test",
		to: "drew@neomail.test",
		raw: new Blob([rawSelf]).stream(),
		rawSize: rawSelf.length,
		setReject: assert.fail,
		forward: async (dest) => nativeForwards.push(dest),
	}, env);

	assert.equal(stored.length, 1);
	assert.equal(stored[0].data.subject, "Self test");
	assert.equal(sent.length, 1);
	assert.deepEqual(sent[0].to, ["drew@ronsman.test"]);
	assert.deepEqual(sent[0].from, { name: "Drew (via drew@neomail.test)", email: "drew@neomail.test" });
	assert.equal(sent[0].replyTo, "drew+test@ronsman.test");
	assert.equal(sent[0].headers["Auto-Submitted"], "auto-generated");
	assert.deepEqual(nativeForwards, ["backup@other.test"]);

	failSend = true;
	await receiveEmail({
		from: "drew+test@ronsman.test",
		to: "drew@neomail.test",
		raw: new Blob([rawSelf]).stream(),
		rawSize: rawSelf.length,
		setReject: assert.fail,
		forward: async (dest) => nativeForwards.push(dest),
	}, env);
	assert.deepEqual(nativeForwards, ["backup@other.test", "backup@other.test", "drew@ronsman.test"]);
});
