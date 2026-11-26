import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudflareMail } from "../workers/cloudflare-mail.ts";
import { dohResolver } from "../workers/dns.ts";
import { checkDns, DomainSchema } from "../server/domains.ts";

function providerFixture({ enabled = false, blocked = false, catchAll = null, denySending = false } = {}) {
	const calls = [];
	let sending = false;
	const addresses = [{ email: "verified@example.net", verified: "2026-06-01" }];
	const base = "/zones/zone-1";
	const path = `${base}/email/routing`;
	const sendingPath = `${base}/email/sending/subdomains`;
	const destinationPath = "/accounts/account-1/email/routing/addresses";
	const ok = (result, result_info) => Response.json({ success: true, result, result_info });
	const request = async (url, init) => {
		assert.equal(init.headers.Authorization, "Bearer fake-token");
		assert.equal(init.redirect, "manual");
		const { pathname, searchParams } = new URL(url);
		const key = pathname.replace("/client/v4", "");
		const body = init.body && JSON.parse(init.body);
		calls.push({ path: key, method: init.method, body, query: Object.fromEntries(searchParams) });
		if (key === "/zones") {
			assert.equal(searchParams.get("name"), "example.com");
			assert.equal(searchParams.get("account.id"), "account-1");
			return ok([{ id: "zone-1", name: "example.com", account: { id: "account-1" } }]);
		}
		if (key === `${base}/dns_records`) return ok(blocked ? [{ type: "MX", name: "example.com", content: "existing.example.net" }] : []);
		if (key === path) return ok({ enabled });
		if (key === `${path}/dns` && init.method === "POST") { assert.deepEqual(body, { name: "example.com" }); enabled = true; return ok([]); }
		if (key === `${path}/rules/catch_all`) {
			if (init.method === "PUT") catchAll = body;
			return ok(catchAll);
		}
		if (key === `${path}/rules`) {
			assert.equal(searchParams.get("per_page"), "50");
			return searchParams.get("page") === "1" ? ok([{ enabled: true, matchers: [{ value: "legacy@example.com" }], actions: [{ type: "forward", value: ["verified@example.net"] }] }], { total_pages: 2 })
				: ok([{ enabled: false, matchers: [{ value: "old@example.com" }] }], { total_pages: 2 });
		}
		if (key === sendingPath) {
			if (denySending) return Response.json({ success: false, errors: [{ message: "Not allowed" }] }, { status: 403 });
			if (init.method === "POST") { assert.deepEqual(body, { name: "example.com" }); sending = true; }
			return ok(init.method === "POST" ? {} : (sending ? [{ name: "example.com", enabled: true }] : []));
		}
		if (key === destinationPath) {
			if (init.method === "GET") return ok(addresses);
			addresses.push({ email: body.email, verified: null });
			return ok(addresses.at(-1));
		}
		throw Error(`Unexpected provider request: ${init.method} ${key}`);
	};
	return { client: cloudflareMail("fake-token", "agentic-inbox", "account-1", request), calls };
}

test("native Cloudflare onboarding configures just the Worker catch-all and is idempotent", async () => {
	const { client, calls } = providerFixture();
	const first = await client.inspect("example.com");
	assert.equal(first.routingEnabled, false);
	assert.equal(first.sendingStatus, null);
	const state = await client.enable("example.com");
	assert.equal(state.routingEnabled, true);
	assert.equal(state.workerConnected, true);
	assert.deepEqual(state.overrides, ["legacy@example.com"]);
	await client.enable("example.com");
	assert.equal((await client.enableSending("example.com")).sendingStatus, "enabled");
	await client.enableSending("example.com");
	assert.deepEqual(calls.filter(({ method }) => method !== "GET").map(({ method, path }) => [method, path]), [
		["POST", "/zones/zone-1/email/routing/dns"],
		["PUT", "/zones/zone-1/email/routing/rules/catch_all"],
		["POST", "/zones/zone-1/email/sending/subdomains"],
	]);
	assert.deepEqual(calls.find(({ method }) => method === "PUT").body.actions, [{ type: "worker", value: ["agentic-inbox"] }]);
});

test("native Cloudflare setup refuses conflicting MX and a live catch-all it does not own", async () => {
	for (const options of [{ blocked: true }, { enabled: true, catchAll: { enabled: true, actions: [{ type: "worker", value: ["existing-worker"] }] } }]) {
		const { client, calls } = providerFixture(options);
		await assert.rejects(client.enable("example.com"), /existing MX or catch-all/i);
		assert.ok(calls.every(({ method }) => method === "GET"));
	}
});

test("destination verification is account-scoped and missing sending permission doesn't hide routing", async () => {
	const { client, calls } = providerFixture({ denySending: true });
	assert.equal((await client.enable("example.com")).sendingSupported, false);
	assert.deepEqual(await client.verifyDestination("example.com", "verified@example.net"), { email: "verified@example.net", verified: true });
	assert.deepEqual(await client.verifyDestination("example.com", "new@example.net"), { email: "new@example.net", verified: false });
	await client.verifyDestination("example.com", "new@example.net");
	assert.equal((await client.destinations("example.com")).length, 2);
	assert.equal(calls.filter(({ path, method }) => path.endsWith("/addresses") && method === "POST").length, 1);
});

test("Workers DNS checks use DoH and compare multi-chunk TXT records", async () => {
	const resolver = dohResolver(async (url, options) => {
		assert.equal(options.headers.Accept, "application/dns-json");
		assert.equal(options.redirect, "manual");
		const type = new URL(url).searchParams.get("type");
		return Response.json({ Status: 0, Answer: type === "MX" ? [{ type: 15, data: "10 mail.example.com." }] : [{ type: 16, data: '"v=DKIM1; " "p=publickey"' }] });
	});
	const plan = DomainSchema.parse({ domain: "example.com", mxHost: "mail.example.com", dmarc: "", dkim: [{ selector: "test", type: "TXT", value: "v=DKIM1; p=publickey" }] });
	assert.deepEqual((await checkDns(plan, resolver)).map(({ status }) => status), ["ready", "ready"]);
});
