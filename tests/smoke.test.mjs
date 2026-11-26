import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { get as httpGet } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { AuthStore } from "../server/auth";
import { SQLiteStore } from "../server/sqlite";

async function unusedPort() {
	const socket = createServer().listen(0, "127.0.0.1");
	await once(socket, "listening");
	const { port } = socket.address();
	await new Promise((resolve) => socket.close(resolve));
	return port;
}

const pathFor = (id) => `/api/v1/mailboxes/${encodeURIComponent(id)}`;

test("standalone login, DNS setup, two-domain real SMTP and MCP", { timeout: 90_000 }, async (t) => {
	const port = await unusedPort(), smtpPort = await unusedPort();
	const base = `http://127.0.0.1:${port}`;
	const data = await mkdtemp(join(tmpdir(), "agentic-test-"));
	const relayed = [];
	const relay = new SMTPServer({
		authOptional: true, disabledCommands: ["AUTH", "STARTTLS"],
		onData(stream, session, callback) {
			const chunks = [];
			stream.on("data", (chunk) => chunks.push(chunk));
			stream.on("error", callback);
			stream.on("end", () => {
				relayed.push({
					from: session.envelope.mailFrom?.address || "",
					to: session.envelope.rcptTo.map((r) => r.address),
					raw: Buffer.concat(chunks).toString("utf8"),
				});
				callback();
			});
		},
	});
	const relayPort = await unusedPort();
	await new Promise((done) => relay.listen(relayPort, "127.0.0.1", done));
	const code = "one-time-setup-code-smoke-test";
	const webhookSecret = "smoke-webhook-secret-2026";
	// Simulate a previously issued token, independent of the new-token API.
	const catalog = new SQLiteStore(join(data, "workspace.sqlite"));
	const legacyToken = new AuthStore(catalog.db, code).createToken("Legacy client", { mailboxes: null, permission: "manage" });
	catalog.db.close();
	const child = spawn(process.execPath, ["--import", "tsx", "server/start.ts", "--dev"], {
		env: { ...process.env, APP_URL: base, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: data, SETUP_CODE: code, DOMAINS: "", EMAIL_ADDRESSES: "",
			SMTP_INBOUND_HOST: "127.0.0.1", SMTP_INBOUND_PORT: String(smtpPort), SMTP_URL: `smtp://127.0.0.1:${relayPort}`, SMTP_TLS_KEY: "", SMTP_TLS_CERT: "", INBOUND_WEBHOOK_SECRET: webhookSecret, MCP_ALLOW_SEND: "false" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-8000); });
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) {
			const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
		}
		await new Promise((done) => relay.close(done));
		await rm(data, { recursive: true, force: true });
	});

	let healthy = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		if (child.exitCode !== null) break;
		try { healthy = (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) })).ok; if (healthy) break; } catch {}
		await sleep(200);
	}
	assert.ok(healthy, `Dev server did not start:\n${output}`);
	let cookie = "";
	const fetchLocal = (path, { headers, ...init } = {}) => fetch(`${base}${path}`, {
		signal: AbortSignal.timeout(15000), ...init, headers: {
			Origin: base, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers,
		},
	});
	const json = async (path, options = {}, status = 200) => {
		const response = await fetchLocal(path, options);
		const text = await response.text();
		assert.equal(response.status, status, text);
		return JSON.parse(text);
	};
	const post = (path, data, status = 201) => json(path, { method: "POST", body: JSON.stringify(data) }, status);
	assert.equal((await fetchLocal("/", { redirect: "manual" })).headers.get("location"), "/setup");
	assert.match(await (await fetchLocal("/setup")).text(), /data-mode="dark"/);
	assert.equal((await fetchLocal("/api/v1/mailboxes")).status, 401);
	assert.equal((await fetchLocal("/server/auth.ts")).status, 403);
	assert.equal((await json("/api/auth/session")).setupRequired, true);
	const email = "owner@example.test", password = "a-strong-password-for-the-smoke-test";
	await post("/api/auth/setup", { email, password, code: "invalid" }, 401);
	const setup = await fetchLocal("/api/auth/setup", { method: "POST", body: JSON.stringify({ email, password, code }) });
	assert.equal(setup.status, 201, await setup.text());
	assert.match(setup.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
	cookie = setup.headers.get("set-cookie").split(";")[0];
	await post("/api/auth/setup", { email, password, code }, 409);
	assert.equal((await fetchLocal("/api/v1/domains", { method: "POST", headers: { Origin: "https://untrusted.example" }, body: "{}" })).status, 403);
	assert.equal((await json("/api/auth/session")).email, email);
	const login = await fetchLocal("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
	assert.equal(login.status, 200, await login.text());
	cookie = login.headers.get("set-cookie").split(";")[0];
	assert.match(await (await fetchLocal("/")).text(), /All inboxes/);
	assert.match(await (await fetchLocal("/routing")).text(), /Email routing/);
	assert.match(await (await fetchLocal("/integrations")).text(), /MCP connections/);

	const domainA = "apple.test", domainB = "berry.test";
	const a = `team@${domainA}`, b = `help@${domainB}`;
	const messageId = "<smoke-1@sender.example>";
	const dns = await post("/api/v1/domains", { domain: domainA, mxHost: "mx.apple.test", spf: "v=spf1 -all", dkim: [{ selector: "relay", type: "CNAME", value: "key.relay.test" }], sts: "testing", tlsReports: "reports@apple.test" });
	assert.deepEqual(dns.records.map((row) => row.purpose), ["MX", "SPF", "DKIM", "DMARC", "MTA-STS", "TLS-RPT"]);
	const policy = await new Promise((resolve, reject) => {
		httpGet(`${base}/.well-known/mta-sts.txt`, { headers: { Host: "mta-sts.apple.test" } }, async (response) => {
			let text = ""; for await (const chunk of response) text += chunk;
			resolve({ status: response.statusCode, text });
		}).on("error", reject);
	});
	assert.equal(policy.status, 200, policy.text);
	assert.match(policy.text, /mode: testing\r?\nmx: mx.apple.test/);
	assert.equal((await fetchLocal("/.well-known/mta-sts.txt")).status, 404);
	await post("/api/v1/domains", { domain: domainB, mxHost: "mx.berry.test" });
	const config = await json("/api/v1/config");
	assert.deepEqual(config.domains, [domainA, domainB]);
	await post("/api/v1/mailboxes", { email: a.toUpperCase(), name: "Team" });
	await post("/api/v1/mailboxes", { email: b, name: "Help" });
	await post("/api/v1/mailboxes", { email: a, name: "Duplicate" }, 409);
	await post("/api/v1/mailboxes", { email: "not-an-email", name: "Invalid" }, 400);
	await post("/api/v1/mailboxes", { email: "test@not-configured.invalid", name: "No" }, 403);
	assert.equal((await fetchLocal(`/api/v1/domains/${domainA}`, { method: "DELETE" })).status, 409);
	const renamed = await json(pathFor(b), { method: "PUT", body: JSON.stringify({ settings: { fromName: "Help desk", signature: { enabled: true, text: "Thanks" } } }) });
	assert.equal(renamed.name, "Help desk");
	assert.equal((await json("/api/v1/mailboxes")).find((row) => row.id === b).name, "Help desk");

	const disposable = `codes@${domainA}`;
	assert.equal((await post("/api/v1/mailboxes", { email: disposable, name: "Codes", disposable: true })).disposable, true);
	assert.equal((await json("/api/v1/mailboxes")).find(({ id }) => id === disposable).disposable, true);
	const inbound = nodemailer.createTransport({ host: "127.0.0.1", port: smtpPort, ignoreTLS: true });
	const deliver = (to, mime) => inbound.sendMail({ envelope: { from: "out@sender.example", to }, raw: `From: out@sender.example\r\n${mime}\r\n` });
	assert.equal((await deliver(b, `To: ${a}\r\nMessage-ID: ${messageId}\r\nSubject: Envelope not header\r\n\r\nFirst mail`)).accepted.length, 1);
	assert.equal((await deliver(a, `Message-ID: <smoke-2@sender.example>\r\nSubject: Bcc message\r\n\r\nSecond mail`)).accepted.length, 1);
	await assert.rejects(deliver(`missing@${domainA}`, "Subject: Unknown recipient\r\n\r\nRejected"), /550 Mailbox unavailable/);
	await deliver(disposable, "Subject: Verification fixture\r\n\r\nCode in low-priority mail");
	assert.equal((await json(`${pathFor(disposable)}/emails?folder=inbox`)).totalCount, 1);
	assert.equal((await json(`${pathFor(disposable)}/folders`)).find(({ id }) => id === "inbox").unreadCount, 0);
	assert.equal((await json("/api/v1/workspace/emails?q=Verification")).emails.length, 0);

	// Alias routing: direct external forwarding, local-mailbox alias + forward, catch-all, reject, and webhook.
	const salesAlias = `sales@${domainA}`;
	const supportAlias = `support@${domainA}`;
	const salesRule = await post("/api/v1/routing", {
		domain: domainA, matchType: "exact", localPart: "sales", action: "forward",
		forwardTo: ["owner@outside.test", "ops@outside.test"], deliverTo: null, note: "Direct forward",
	});
	const supportRule = await post("/api/v1/routing", {
		domain: domainA, matchType: "exact", localPart: "support", action: "mailbox",
		deliverTo: a, forwardTo: ["backup@outside.test"], note: "Support alias",
	});
	await post("/api/v1/routing", {
		domain: domainA, matchType: "exact", localPart: "blocked", action: "reject",
		rejectReason: "Address retired",
	});
	await post("/api/v1/routing", {
		domain: domainB, matchType: "catch_all", action: "forward",
		forwardTo: ["catchall@outside.test"],
	});
	// Cannot create a mailbox with the same address as an alias rule, or delete domain while rules exist.
	await post("/api/v1/mailboxes", { email: salesAlias, name: "Sales" }, 409);
	assert.equal((await fetchLocal(`/api/v1/domains/${domainA}`, { method: "DELETE" })).status, 409);

	const beforeSales = relayed.length;
	assert.equal((await deliver(salesAlias, "Reply-To: buyer@outside.test\r\nMessage-ID: <sales-1@outside.test>\r\nSubject: Order inquiry\r\n\r\nPlease quote")).accepted.length, 1);
	assert.equal(relayed.length, beforeSales + 1);
	assert.equal(relayed[beforeSales].from, salesAlias);
	assert.deepEqual(relayed[beforeSales].to, ["owner@outside.test", "ops@outside.test"]);
	assert.match(relayed[beforeSales].raw, /Auto-Submitted: auto-forwarded/i);
	assert.match(relayed[beforeSales].raw, /X-Original-To: sales@apple\.test/i);
	assert.match(relayed[beforeSales].raw, /Reply-To: buyer@outside\.test/i);

	// Pure-forward alias did not store a local copy in team@apple.test.
	const supportBefore = (await json(`${pathFor(a)}/emails?folder=inbox`)).totalCount;
	assert.equal((await deliver(supportAlias, "Message-ID: <sup-1@outside.test>\r\nSubject: Alias to local + forward\r\n\r\nNeed help")).accepted.length, 1);
	assert.equal((await json(`${pathFor(a)}/emails?folder=inbox`)).totalCount, supportBefore + 1);
	assert.equal(relayed.at(-1).from, supportAlias);
	assert.deepEqual(relayed.at(-1).to, ["backup@outside.test"]);

	// Catch-all on domainB forwards unknown addresses; reject rule on domainA answers 550.
	const beforeCatchAll = relayed.length;
	assert.equal((await deliver(`anything@${domainB}`, "Message-ID: <ca-1@outside.test>\r\nSubject: Catch all\r\n\r\nCaught")).accepted.length, 1);
	assert.equal(relayed.length, beforeCatchAll + 1);
	assert.deepEqual(relayed[beforeCatchAll].to, ["catchall@outside.test"]);
	await assert.rejects(deliver(`blocked@${domainA}`, "Subject: Blocked\r\n\r\nNo"), /550 Address retired/);

	// Loop guard skips re-forwarding when hop >= 4.
	const beforeLoop = relayed.length;
	assert.equal((await deliver(salesAlias, "X-Agentic-Hop: 4\r\nMessage-ID: <loop@outside.test>\r\nSubject: Loop\r\n\r\nStop")).accepted.length, 1);
	assert.equal(relayed.length, beforeLoop);

	// Replying/sending from an assigned local alias works; sending from an unowned address fails.
	assert.equal((await json(pathFor(a))).aliases.length, 1);
	const aliasSend = await post(`${pathFor(a)}/emails`, { from: supportAlias, to: "client@outside.test", subject: "From alias", text: "Hello from support" });
	assert.equal(aliasSend.status, "sent");
	await post(`${pathFor(a)}/emails`, { from: salesAlias, to: "client@outside.test", subject: "Unauthorized", text: "Nope" }, 400);

	// Direct mailbox forwarding (keepCopy: false) forwards without keeping a local copy.
	await json(pathFor(a), { method: "PUT", body: JSON.stringify({ settings: { fromName: "Team", forwarding: { enabled: true, targets: ["direct@outside.test", "extra@outside.test"], keepCopy: false } } }) });
	const inboxCountBeforeFwd = (await json(`${pathFor(a)}/emails?folder=inbox`)).totalCount;
	const beforeDirect = relayed.length;
	assert.equal((await deliver(a, "Message-ID: <dir-1@outside.test>\r\nSubject: Direct forward only\r\n\r\nForwarded")).accepted.length, 1);
	assert.equal(relayed.length, beforeDirect + 1);
	assert.deepEqual(relayed[beforeDirect].to, ["direct@outside.test", "extra@outside.test"]);
	assert.equal((await json(`${pathFor(a)}/emails?folder=inbox`)).totalCount, inboxCountBeforeFwd);
	await json(pathFor(a), { method: "PUT", body: JSON.stringify({ settings: { fromName: "Team", forwarding: { enabled: false, targets: [], keepCopy: true } } }) });

	// HMAC-signed /api/inbound relay webhook delivers through the same routing engine.
	const inboundRaw = Buffer.from("From: relay@sender.example\r\nMessage-ID: <hook-1@sender.example>\r\nSubject: Webhook relay\r\n\r\nVia relay");
	const inboundTs = String(Math.floor(Date.now() / 1000));
	const inboundSig = createHmac("sha256", webhookSecret).update(`${inboundTs}.${salesAlias}.`).update(inboundRaw).digest("hex");
	const beforeWebhook = relayed.length;
	const webhookRes = await fetch(`${base}/api/inbound`, {
		method: "POST",
		headers: { "Content-Type": "application/octet-stream", "x-inbound-to": salesAlias, "x-inbound-timestamp": inboundTs, "x-inbound-signature": `sha256=${inboundSig}` },
		body: inboundRaw,
	});
	assert.equal(webhookRes.status, 200, await webhookRes.clone().text());
	assert.equal(relayed.length, beforeWebhook + 1);

	const hooksInfo = await json("/api/v1/webhooks");
	assert.ok(hooksInfo.sources.includes(salesAlias));
	assert.ok(hooksInfo.sources.includes(a));
	const hookRes = await post("/api/v1/webhooks", { recipient: salesAlias, endpoint: "https://hooks.zapier.com/hooks/catch/99/xyz/" }, 201);
	assert.ok(hookRes.secret);
	assert.equal((await fetchLocal(`/api/v1/webhooks/${hookRes.webhook.id}`, { method: "PUT", body: JSON.stringify({ enabled: false }) })).status, 204);
	assert.equal((await fetchLocal(`/api/v1/webhooks/${hookRes.webhook.id}`, { method: "DELETE" })).status, 204);

	// Toggle/cleanup routing rules checks.
	assert.equal((await json(`/api/v1/routing?domain=${domainA}`)).rules.length, 3);
	await json(`/api/v1/routing/${salesRule.id}`, { method: "PUT", body: JSON.stringify({ domain: domainA, matchType: "exact", localPart: "sales", action: "forward", forwardTo: ["owner@outside.test"], enabled: false }) });
	await assert.rejects(deliver(salesAlias, "Subject: Paused\r\n\r\nPaused"), /550 Mailbox unavailable/);
	assert.equal((await json("/api/v1/webhooks")).sources.includes(salesAlias), false);
	assert.equal((await fetchLocal(`/api/v1/routing/${salesRule.id}`, { method: "DELETE" })).status, 204);
	assert.equal((await fetchLocal(`/api/v1/routing/${supportRule.id}`, { method: "DELETE" })).status, 204);
	const first = await json("/api/v1/workspace/emails?limit=1");
	assert.equal(first.mailboxCount, 2);
	assert.equal(first.emails.length, 1);
	assert.ok(first.nextCursor);
	const second = await json(`/api/v1/workspace/emails?${new URLSearchParams({ limit: "1", cursor: first.nextCursor })}`);
	assert.ok(second.nextCursor);
	const third = await json(`/api/v1/workspace/emails?${new URLSearchParams({ limit: "1", cursor: second.nextCursor })}`);
	assert.equal(third.nextCursor, null);
	assert.deepEqual(new Set([first.emails[0].mailboxId, second.emails[0].mailboxId, third.emails[0].mailboxId]), new Set([a, b]));
	await json("/api/v1/workspace/emails?cursor=broken", {}, 400);
	const scoped = await json(`/api/v1/workspace/emails?${new URLSearchParams({ domain: domainB, q: 'subject:"Envelope not header" is:unread' })}`);
	assert.equal(scoped.emails.length, 1);
	const [original] = scoped.emails;
	assert.equal(original.mailboxId, b);
	assert.equal(original.recipient, a);
	await json(`${pathFor(a)}/emails/${original.id}`, {}, 404);
	const reply = await deliver(b, `To: ${b}\r\nMessage-ID: <smoke-4@sender.example>\r\nIn-Reply-To: ${messageId}\r\nReferences: ${messageId}\r\nSubject: Re: Envelope not header\r\n\r\nReply`);
	assert.equal(reply.accepted.length, 1);
	assert.equal((await json(`${pathFor(b)}/threads/${original.thread_id}`)).length, 2);
	await post(`${pathFor(b)}/drafts`, { draft_id: original.id, body: "Not a draft" }, 404);

	const mcp = new Client({ name: "smoke-test", version: "1.0.0" });
	await post("/api/auth/mcp-tokens", { name: "Not issuable", permission: "manage", mailboxes: null }, 400);
	const token = legacyToken;
	const bearer = { Authorization: `Bearer ${token.token}` };
	assert.equal((await fetch(`${base}/api/v1/mailboxes`, { headers: bearer })).status, 401);
	assert.equal((await fetch(`${base}/mcp`, { method: "POST" })).status, 401);
	const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: bearer } });
	await mcp.connect(transport);
	t.after(() => mcp.close());
	const { tools } = await mcp.listTools();
	assert.ok(tools.some((tool) => tool.name === "search_workspace"));
	assert.ok(!tools.some((tool) => tool.name === "create_mailbox"), "Legacy manage token must not gain administration");
	assert.equal(tools.some((tool) => tool.name === "send_email"), config.mcpAllowSend);
	assert.ok(!tools.some((tool) => tool.name === "delete_email"));
	const actionToken = await post("/api/auth/mcp-tokens", { name: "Act without provider permission", permission: "send", mailboxes: [b] });
	const actionClient = new Client({ name: "action-smoke-test", version: "1.0.0" });
	await actionClient.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${actionToken.token}` } } }));
	t.after(() => actionClient.close());
	const actionTools = (await actionClient.listTools()).tools.map(({ name }) => name);
	assert.ok(actionTools.includes("move_email"));
	assert.ok(!actionTools.includes("send_email"));
	const call = async (name, args, isError = false) => {
		const reply = await mcp.callTool({ name, arguments: args });
		assert.equal(!!reply.isError, isError, JSON.stringify(reply));
		return JSON.parse(reply.content[0].text);
	};
	assert.equal((await call("list_domains", {})).find(({ domain }) => domain === domainB).mailboxCount, 1);
	assert.equal((await call("list_routing_rules", { domain: domainB })).length, 1);
	assert.equal((await call("list_mailboxes", { domain: domainB }))[0].id, b);
	const result = await call("search_workspace", { domain: domainB, q: "Envelope", limit: 1 });
	assert.ok(result.nextCursor);
	assert.equal((await call("search_workspace", { domain: domainB, q: "Envelope", limit: 1, cursor: result.nextCursor })).emails.length, 1);
	assert.equal((await call("get_email", { mailboxId: b.toUpperCase(), emailId: original.id })).subject, "Envelope not header");
	await call("get_email", { mailboxId: a, emailId: original.id }, true);
	const draft = await call("draft_reply", { mailboxId: b, originalEmailId: original.id, subject: "Re: Envelope not header", bodyHtml: "<p>Draft body</p>" });
	assert.equal(draft.status, "draft");
	const updated = await call("update_draft", { mailboxId: b, draftId: draft.id, subject: "Edited subject" });
	assert.equal(updated.draftId, draft.id);
	const storedDraft = await json(`${pathFor(b)}/emails/${draft.id}`);
	assert.equal(storedDraft.subject, "Edited subject");
	assert.match(storedDraft.body, /Draft body/);
	assert.equal(storedDraft.thread_id, original.thread_id);
	assert.equal((await call("list_emails", { mailboxId: b, folder: "draft" })).length, 1);
	const attached = await post(`${pathFor(b)}/drafts`, {
		body: "Attachment draft", subject: "With a file", to: "out@sender.example", attachments: [
			{ filename: "hello.json", type: "application/json", disposition: "attachment", content: Buffer.from('{"hello":true}').toString("base64") },
		],
	});
	const attachmentPath = `${pathFor(b)}/emails/${attached.id}/attachments/${attached.attachments[0].id}`;
	assert.equal((await fetchLocal(attachmentPath)).headers.get("content-disposition").startsWith("attachment"), true);
	assert.equal(await (await fetchLocal(attachmentPath)).text(), '{"hello":true}');
	const updatedAttachmentDraft = await post(`${pathFor(b)}/drafts`, { draft_id: attached.id, body: "New body", attachments: [] }, 200);
	assert.deepEqual(updatedAttachmentDraft.attachments, []);
	await json(attachmentPath, {}, 404);
	const sent = await post(`${pathFor(b)}/emails`, { from: b, to: "out@sender.example", subject: "Local test", text: "Simulated provider" });
	assert.equal(sent.status, "sent");
	assert.equal((await json(`${pathFor(b)}/emails/${sent.id}`)).folder_id, "sent");
	await call("mark_email_read", { mailboxId: b, emailId: original.id, read: true });
	await call("move_email", { mailboxId: b, emailId: original.id, folderId: "archive" });
	assert.equal((await json(`/api/v1/workspace/emails?folder=archive&domain=${domainB}`)).emails[0].id, original.id);
	const folder = await post(`${pathFor(b)}/folders`, { name: "Projects" });
	await call("move_email", { mailboxId: b, emailId: original.id, folderId: folder.id });
	const folderPath = `${pathFor(b)}/folders/${folder.id}`;
	const archivedMessage = `${pathFor(b)}/emails/${original.id}`;
	await json(folderPath, { method: "PUT", body: JSON.stringify({ name: "Done" }) });
	await post(`${archivedMessage}/move`, { folderId: "trash" }, 200);
	await post(`${archivedMessage}/move`, { folderId: "trash" }, 200);
	assert.equal((await json(`${pathFor(b)}/emails?folder=trash`)).totalCount, 1);
	assert.deepEqual(await post(`${archivedMessage}/recover`, {}, 200), { folderId: folder.id });
	assert.equal((await json(archivedMessage)).read, true);
	assert.equal((await fetchLocal(`${archivedMessage}?trashOnly=true`, { method: "DELETE" })).status, 404);
	await post(`${archivedMessage}/recover`, {}, 404);
	await post(`${archivedMessage}/move`, { folderId: "trash" }, 200);
	assert.equal((await fetchLocal(folderPath, { method: "DELETE" })).status, 204);
	assert.deepEqual(await post(`${archivedMessage}/recover`, {}, 200), { folderId: "inbox" });
	const draftPath = `${pathFor(b)}/emails/${draft.id}`;
	await post(`${draftPath}/move`, { folderId: "trash" }, 200);
	assert.deepEqual(await post(`${draftPath}/recover`, {}, 200), { folderId: "draft" });
	assert.equal((await json(draftPath)).body, storedDraft.body);
	const wrongOrigin = await fetchLocal("/mcp", { method: "POST", headers: { Origin: "https://untrusted.example", ...bearer } });
	assert.equal(wrongOrigin.status, 403);
	assert.equal((await fetchLocal(`/api/auth/mcp-tokens/${token.id}`, { method: "DELETE" })).status, 204);
	assert.equal((await fetch(`${base}/mcp`, { method: "POST", headers: bearer })).status, 401);
	// Configure forwarding for an existing inbox without replacing its profile or aliasing the address.
	const forwardingPath = `${pathFor(b)}/forwarding`;
	const updateForwarding = (body, status = 200) => json(forwardingPath, { method: "PUT", body: JSON.stringify(body) }, status);
	const settingsBefore = (await json(pathFor(b))).settings;
	await updateForwarding({ enabled: true }, 400);
	await updateForwarding({ enabled: true, targets: [b.toUpperCase()] }, 400);
	await post("/api/v1/routing", { domain: domainB, matchType: "exact", localPart: b.split("@")[0], action: "forward", forwardTo: ["backup@outside.test"] }, 409);
	const newForwarding = await updateForwarding({ enabled: true, targets: [" Backup@outside.test ", "backup@outside.test"] });
	assert.deepEqual(newForwarding, { enabled: true, targets: ["backup@outside.test"], keepCopy: true });
	assert.deepEqual((await json(pathFor(b))).settings, { ...settingsBefore, forwarding: newForwarding });
	const beforeCopy = (await json(`${pathFor(b)}/emails?folder=inbox`)).totalCount;
	const beforeRelay = relayed.length;
	await deliver(b, "Subject: Inbox plus forwarding\r\n\r\nKeep this too");
	assert.equal((await json(`${pathFor(b)}/emails?folder=inbox`)).totalCount, beforeCopy + 1);
	assert.equal(relayed.length, beforeRelay + 1);
	assert.deepEqual(relayed.at(-1).to, ["backup@outside.test"]);
	await updateForwarding({ ...newForwarding, enabled: false });
	await deliver(b, "Subject: In inbox only\r\n\r\nForwarding turned off");
	assert.equal((await json(`${pathFor(b)}/emails?folder=inbox`)).totalCount, beforeCopy + 2);
	assert.equal(relayed.length, beforeRelay + 1);

	assert.equal((await fetchLocal("/api/auth/logout", { method: "POST" })).status, 204);
	assert.equal((await fetchLocal("/api/v1/mailboxes")).status, 401);
});
