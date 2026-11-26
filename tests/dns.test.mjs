import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDns, dnsPlan, DomainSchema, publishMissing } from "../server/domains.ts";

const config = DomainSchema.parse({
	domain: "Example.NET", mxHost: "mx.example.net", spf: "v=spf1 include:relay.example.net -all",
	dkim: [{ selector: "work", type: "TXT", value: "v=DKIM1; p=KEY" }], sts: "testing", tlsReports: "reports@example.net",
});

test("DNS plan, record comparison and MTA-STS ID are stable", async () => {
	assert.equal(config.domain, "example.net");
	const first = dnsPlan(config);
	const planId = first.records.find(({ purpose }) => purpose === "MTA-STS").value;
	assert.equal(dnsPlan(config).records.find(({ purpose }) => purpose === "MTA-STS").value, planId);
	assert.notEqual(dnsPlan({ ...config, sts: "enforce" }).records.find(({ purpose }) => purpose === "MTA-STS").value, planId);
	assert.equal(first.policyUrl, "https://mta-sts.example.net/.well-known/mta-sts.txt");
	assert.throws(() => DomainSchema.parse({ domain: "example.net", sts: "enforce" }), /MX hostname is required/);
	const resolver = {
		async resolveMx() { return [{ exchange: "other-provider.example.net", priority: 10 }]; },
		async resolveTxt(name) {
			if (name === "example.net") return [["provider-verification"], ["v=spf1 include:relay.example.net", " -all"]];
			if (name.startsWith("work.")) return [["v=DKIM1; p=", "KEY"]];
			throw Object.assign(new Error("No such record"), { code: "ENODATA" });
		},
	};
	const checks = Object.fromEntries((await checkDns(config, resolver)).map((record) => [record.purpose, record.status]));
	assert.deepEqual(checks, { MX: "conflict", SPF: "ready", DKIM: "ready", DMARC: "missing", "MTA-STS": "missing", "TLS-RPT": "missing" });
});

test("optional DNS publishing creates missing values without replacing active MX or SPF", async () => {
	const created = [];
	const fakeApi = async (url, request) => {
		const path = new URL(url);
		assert.equal(path.hostname, "api.cloudflare.com");
		assert.equal(request.headers.Authorization, "Bearer test-token");
		if (path.pathname.endsWith("/zones")) return Response.json({ success: true, result: [{ id: "zone", name: config.domain }] });
		if (request.method === "POST") {
			const record = JSON.parse(request.body);
			created.push(record);
			return Response.json({ success: true, result: {} });
		}
		assert.equal(request.method, "GET");
		return Response.json({ success: true, result: path.searchParams.get("name.exact") === config.domain ? [
			{ id: "old-mx", type: "MX", name: config.domain, content: "other.example.net", priority: 10 },
			{ id: "same-spf", type: "TXT", name: config.domain, content: `"${config.spf}"` },
		] : [] });
	};
	const result = Object.fromEntries((await publishMissing(config, "test-token", fakeApi)).map((record) => [record.purpose, record.state]));
	assert.equal(result.MX, "conflict"); assert.equal(result.SPF, "unchanged");
	assert.equal(result.DKIM, "created"); assert.equal(result.DMARC, "created");
	assert.ok(created.every(({ name }) => name !== config.domain));
});
