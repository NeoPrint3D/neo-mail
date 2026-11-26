import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("Cloudflare Worker: first-run auth, multi-domain mail, forwarding, R2, and scoped MCP", { timeout: 90_000 }, async (t) => {
	const socket = createServer().listen(0, "127.0.0.1");
	await once(socket, "listening");
	const { port } = socket.address();
	await new Promise((resolve) => socket.close(resolve));
	const base = `http://127.0.0.1:${port}`;
	const state = await mkdtemp(join(tmpdir(), "agentic-worker-"));
	const code = "local-worker-test-setup-code";
	const envFile = join(state, "test.env");
	const vapid = spawnSync(process.execPath, ["scripts/generate-push-keys.mjs", "https://inbox.example.test"], { encoding: "utf8" });
	assert.equal(vapid.status, 0);
	const { publicKey } = JSON.parse(vapid.stdout);
	await writeFile(envFile, `SETUP_CODE=${code}\nMCP_ALLOW_SEND=true\nWEB_PUSH_VAPID=${vapid.stdout.trim()}\n`, { mode: 0o600 });
	const child = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--config", "wrangler.jsonc", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", state, "--env-file", envFile], {
		env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "true", CLOUDFLARE_INCLUDE_PROCESS_ENV: "false", WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"],
	});
	let log = "";
	for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { log = (log + chunk).slice(-12000); });
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) {
			const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
		}
		await rm(state, { recursive: true, force: true });
	});
	let alive = false;
	for (let i = 0; i < 100 && child.exitCode === null; i++) {
		try { alive = (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })).ok; if (alive) break; } catch {}
		await sleep(200);
	}
	assert.ok(alive, log);
	let cookie = "";
	const http = (path, { headers, ...init } = {}) => fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(10000), ...init,
		headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...headers } });
	const json = async (path, status = 200, data, method = data === undefined ? "GET" : "POST") => {
		const res = await http(path, { method, headers: { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
		const value = await res.text();
		assert.equal(res.status, status, `${method} ${path}: ${value}\n${log}`);
		return value ? JSON.parse(value) : undefined;
	};
	assert.equal((await http("/")).headers.get("Location"), "/setup");
	const setupHtml = await (await http("/setup")).text();
	assert.match(setupHtml, /Set up your account/);
	assert.match(setupHtml, /Setup code/);
	assert.match(setupHtml, /data-mode="dark"/);
	const asset = setupHtml.match(/href="(\/assets\/[^" ]+\.css)"/)[1];
	assert.equal((await http(asset)).status, 200);
	assert.equal((await http("/api/v1/mailboxes")).status, 401);
	assert.equal((await http("/api/auth/push")).status, 401);
	assert.equal((await http("/api/v1/webhooks")).status, 401);
	const credentials = { email: "owner@example.test", password: "worker-test-password-2026" };
	await json("/api/auth/setup", 401, { ...credentials, code: "wrong" });
	assert.equal((await http("/api/auth/setup", { method: "POST", headers: { Origin: "https://unrelated.example" } })).status, 403);
	const setup = await http("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...credentials, code }) });
	const cookieVal = setup.headers.get("Set-Cookie");
	assert.equal(setup.status, 201, await setup.text());
	assert.match(cookieVal, /HttpOnly; SameSite=Lax/);
	cookie = cookieVal.split(";")[0];
	assert.equal((await http("/setup")).headers.get("Location"), "/");
	await json("/api/auth/setup", 409, { ...credentials, code });
	assert.equal((await json("/api/auth/session")).email, credentials.email);
	assert.equal((await json("/api/v1/config")).platform, "cloudflare");

	const a = "support@first.test", b = "jobs@second.test", codes = "codes@first.test";
	const mb = (id) => `/api/v1/mailboxes/${encodeURIComponent(id)}`;
	for (const [domain, email, name] of [["first.test", a, "Support"], ["second.test", b, "Jobs"]]) {
		await json("/api/v1/domains", 201, { domain });
		await json("/api/v1/mailboxes", 201, { email, name });
	}
	await json("/api/v1/mailboxes", 409, { email: a, name: "Duplicate" });
	await json(mb(a), 200, { settings: { fromName: "Support team" } }, "PUT");
	assert.equal((await json("/api/v1/mailboxes")).find((box) => box.id === a).name, "Support team");
	assert.match(await (await http("/domains")).text(), /Domains &amp; DNS/);
	assert.equal((await json("/api/v1/mailboxes", 201, { email: codes, name: "Codes", disposable: true })).disposable, true);
	assert.equal((await json(mb(codes), 200, { settings: { fromName: "Verification Codes" } }, "PUT")).disposable, true);
	assert.equal((await json("/api/v1/mailboxes")).find((box) => box.id === codes).disposable, true);

	const folder = await json(`${mb(a)}/folders`, 201, { name: "Projects" });
	assert.equal(folder.name, "Projects");
	const alias = "help@first.test";
	await json("/api/v1/routing", 201, { domain: "first.test", matchType: "exact", localPart: "help", action: "mailbox", deliverTo: a, forwardTo: ["external@example.net"] });
	await json("/api/v1/routing", 201, { domain: "second.test", matchType: "catch_all", action: "forward", forwardTo: ["one@example.net", "two@example.net"] });
	const inbound = (to, subject, headers = "", content = "Plain body", format = "text") => {
		const from = "customer@example.net";
		return http(`/cdn-cgi/local/email?${new URLSearchParams({ from, to, format })}`, {
			method: "POST", headers: { "Content-Type": "text/plain" },
			body: `From: Customer <${from}>\r\nTo: visible@example.net\r\nMessage-ID: <${crypto.randomUUID()}@example.net>\r\nSubject: ${subject}\r\n${headers}\r\n${content}\r\n`,
		});
	};
	const rawMultipart = [`--fixture`, "Content-Type: text/plain", "", "Example body", "--fixture", "Content-Type: text/plain", 'Content-Disposition: attachment; filename="note.txt"', "Content-Transfer-Encoding: base64", "", "SGVsbG8gYXR0YWNobWVudA==", "--fixture--"].join("\r\n");
	const withAttachment = await inbound(alias, "Alias delivery", 'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="fixture"\r\n', rawMultipart);
	assert.ok(withAttachment.ok, `${await withAttachment.text()}\n${log}`);
	assert.ok((await inbound(b, "Second domain")).ok);
	assert.ok((await inbound(codes, "One-time verification", "", "Fixture code 123456")).ok);
	assert.ok((await inbound("catch@second.test", "Forward to two addresses")).ok);
	const rejected = await inbound("unknown@first.test", "Do not store");
	assert.match(await rejected.text(), /Mailbox unavailable/i);
	const workspace = await json("/api/v1/workspace/emails");
	assert.equal(workspace.mailboxCount, 2);
	assert.equal(workspace.emails.length, 2);
	const [message] = (await json(`${mb(a)}/emails?folder=inbox`)).emails;
	assert.equal(message.subject, "Alias delivery");
	const full = await json(`${mb(a)}/emails/${message.id}`);
	assert.equal(full.recipient, "visible@example.net");
	assert.equal(full.attachments[0].filename, "note.txt");
	assert.equal(await (await http(`${mb(a)}/emails/${message.id}/attachments/${full.attachments[0].id}`)).text(), "Hello attachment");
	assert.equal((await json(`${mb(b)}/emails?folder=inbox`)).emails.length, 1);
	const [codeMail] = (await json(`${mb(codes)}/emails?folder=inbox`)).emails;
	assert.equal(codeMail.subject, "One-time verification");
	assert.match((await json(`${mb(codes)}/emails/${codeMail.id}`)).body, /123456/);
	assert.equal((await json(`${mb(codes)}/folders`)).find(({ id }) => id === "inbox").unreadCount, 0);
	assert.deepEqual(await json(`${mb(codes)}/search?query=verification`), { emails: [], totalCount: 0 });
	assert.equal((await json("/api/v1/workspace/emails?q=verification")).emails.length, 0);
	assert.equal((await json("/api/v1/workspace/emails?view=unread")).emails.some(({ mailboxId }) => mailboxId === codes), false);
	assert.equal((await json(`/api/v1/workspace/emails?mailboxId=${codes}`)).mailboxCount, 0);

	// Native forwarding and local storage both happen for an existing inbox, not its domain catch-all.
	const forwardPath = `${mb(b)}/forwarding`;
	const targets = ["jobs-copy@example.net", "jobs-audit@example.net"];
	await json(forwardPath, 400, { enabled: true, targets: [a] }, "PUT");
	const saved = await json(forwardPath, 200, { enabled: true, targets }, "PUT");
	assert.deepEqual(saved, { enabled: true, targets, keepCopy: true });
	assert.equal((await json(mb(b))).settings.fromName, "Jobs");
	assert.deepEqual((await json(mb(b))).settings.forwarding, saved);
	const forwarded = await inbound(b, "Store and forward existing inbox mail", "", "Keep this message", "json");
	assert.ok(forwarded.ok);
	assert.deepEqual((await forwarded.json()).forwards.map(({ recipient }) => recipient), targets);
	const jobsInbox = (await json(`${mb(b)}/emails?folder=inbox`)).emails;
	assert.equal(jobsInbox.length, 2);
	assert.ok(jobsInbox.some(({ subject }) => subject === "Store and forward existing inbox mail"));
	await json(forwardPath, 200, { ...saved, enabled: false }, "PUT");

	// Outbound webhooks: list eligible sources, validate destination, toggle, and delete.
	const hooksBefore = await json("/api/v1/webhooks");
	assert.deepEqual(hooksBefore.webhooks, []);
	assert.ok(hooksBefore.sources.includes(a));
	assert.ok(hooksBefore.sources.includes(alias));
	assert.ok(!hooksBefore.sources.some((src) => src.startsWith("*@")));
	await json("/api/v1/webhooks", 400, { recipient: alias, endpoint: "https://unapproved.example.test/hook" });
	await json("/api/v1/webhooks", 400, { recipient: "missing@first.test", endpoint: "https://hooks.zapier.com/hooks/catch/1/a" });
	assert.equal((await http("/api/v1/webhooks", { method: "POST", headers: { Origin: "https://unrelated.example" }, body: "{}" })).status, 403);
	const createdHook = await json("/api/v1/webhooks", 201, { recipient: alias, endpoint: "https://hooks.zapier.com/hooks/catch/123/abc/" });
	assert.ok(createdHook.secret);
	assert.equal(createdHook.webhook.origin, "https://hooks.zapier.com");
	assert.equal((await json("/api/v1/webhooks")).webhooks.length, 1);
	await json(`/api/v1/webhooks/${createdHook.webhook.id}`, 204, { enabled: false }, "PUT");
	assert.equal((await json("/api/v1/webhooks")).webhooks[0].enabled, false);
	await json(`/api/v1/webhooks/${createdHook.webhook.id}`, 204, undefined, "DELETE");
	assert.deepEqual((await json("/api/v1/webhooks")).webhooks, []);

	const outgoing = await json(`${mb(a)}/emails`, 201, { from: { name: "Help", email: alias }, to: ["one@example.net"], bcc: "hidden@example.net", subject: "Outbound fixture", text: "Hello", attachments: [
		{ filename: "note.txt", type: "text/plain", disposition: "attachment", content: "SGVsbG8=" },
	] });
	const sentPath = `${mb(a)}/emails/${outgoing.id}`;
	assert.equal((await json(sentPath)).folder_id, "sent");
	await json(`${sentPath}/move`, 200, { folderId: "trash" });
	assert.deepEqual((await json("/api/v1/workspace/emails?folder=trash")).emails.map((row) => row.id), [outgoing.id]);
	assert.deepEqual(await json(`${sentPath}/recover`, 200, {}, "POST"), { folderId: "sent" });
	await json(`${sentPath}?trashOnly=true`, 404, undefined, "DELETE");
	const sentFile = (await json(sentPath)).attachments[0];
	assert.equal(await (await http(`${sentPath}/attachments/${sentFile.id}`)).text(), "Hello");
	await json(`${sentPath}/move`, 200, { folderId: "trash" });
	await json(`${sentPath}?trashOnly=true`, 204, undefined, "DELETE");
	await json(sentPath, 404);
	await json(`${sentPath}/attachments/${sentFile.id}`, 404);

	const read = await json("/api/auth/mcp-tokens", 201, { name: "Support reader", mailboxes: [a], permission: "read" });
	await json("/api/auth/mcp-tokens", 400, { name: "Jobs agent", mailboxes: [b], permission: "manage" });
	await json("/api/auth/mcp-tokens", 400, { name: "No disposable access", mailboxes: [codes], permission: "read" });
	await json("/api/auth/mcp-tokens", 400, { name: "Invalid admin scope", mailboxes: [a], permission: "admin" });
	const admin = await json("/api/auth/mcp-tokens", 201, { name: "Workspace operator", mailboxes: null, permission: "admin" });
	const sender = await json("/api/auth/mcp-tokens", 201, { name: "Jobs sender", mailboxes: [b], permission: "send" });
	const connect = async (token) => {
		const client = new Client({ name: "worker-test", version: "1.0.0" });
		await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
		t.after(() => client.close());
		return client;
	};
	const call = async (client, name, args, isError = false) => {
		const result = await client.callTool({ name, arguments: args });
		assert.equal(!!result.isError, isError, JSON.stringify(result));
		const content = result.content[0].text;
		try { return JSON.parse(content); }
		catch (error) { if (isError) return { error: content }; throw error; }
	};
	const reader = await connect(read.token), operator = await connect(admin.token), sendClient = await connect(sender.token);
	const toolNames = async (client) => (await client.listTools()).tools.map(({ name }) => name);
	assert.ok(!(await toolNames(reader)).some((name) => ["create_draft", "list_routing_rules", "send_email", "create_mailbox", "create_folder", "recover_email"].includes(name)));
	assert.ok((await toolNames(sendClient)).includes("send_email"));
	assert.ok(!(await toolNames(sendClient)).some((name) => ["create_mailbox", "create_routing_rule", "delete_email"].includes(name)));
	const adminTools = await toolNames(operator);
	for (const name of ["create_mailbox", "create_domain", "create_routing_rule", "send_email", "send_forward", "delete_email"]) assert.ok(adminTools.includes(name), name);
	assert.ok(!adminTools.some((name) => /password|create.*token|revoke.*token/.test(name)));
	assert.deepEqual((await call(reader, "list_mailboxes", {})).map((box) => box.id), [a]);
	assert.deepEqual((await call(reader, "list_domains", {})).map((row) => row.domain), ["first.test"]);
	assert.deepEqual((await call(reader, "search_workspace", {})).emails.map((row) => row.mailboxId), [a]);
	const file = await call(reader, "get_attachment", { mailboxId: a, emailId: message.id, attachmentId: full.attachments[0].id });
	assert.equal(Buffer.from(file.content, "base64").toString(), "Hello attachment");
	await call(reader, "get_email", { mailboxId: b, emailId: message.id }, true);
	const draft = await call(sendClient, "create_draft", { mailboxId: b, to: "recipient@example.net", subject: "Human review", bodyHtml: "<p>Review</p>" });
	assert.equal(draft.status, "draft");
	assert.equal((await json(`${mb(b)}/emails/${draft.id}`)).subject, "Human review");
	await call(sendClient, "create_draft", { mailboxId: a, subject: "Denied", bodyHtml: "<p>Denied</p>" }, true);
	await call(sendClient, "create_folder", { mailboxId: a, name: "Denied" }, true);
	const folderByAgent = await call(sendClient, "create_folder", { mailboxId: b, name: "Processed" });
	await call(sendClient, "set_email_star", { mailboxId: b, emailId: draft.id, starred: true });
	await call(sendClient, "move_email", { mailboxId: b, emailId: draft.id, folderId: "trash" });
	assert.deepEqual(await call(sendClient, "recover_email", { mailboxId: b, emailId: draft.id }), { folderId: "draft" });
	await call(sendClient, "delete_folder", { mailboxId: b, folderId: folderByAgent.id, confirmed: true });

	assert.ok(!(await call(operator, "list_mailboxes", {})).some(({ id }) => id === codes));
	assert.deepEqual((await call(operator, "search_workspace", { q: "verification" })).emails, []);
	await call(operator, "list_emails", { mailboxId: codes }, true);
	await call(operator, "get_email", { mailboxId: codes, emailId: codeMail.id }, true);
	await call(operator, "search_emails", { mailboxId: codes, query: "verification" }, true);
	await call(operator, "update_mailbox_settings", { mailboxId: codes, settings: { fromName: "Not allowed" }, confirmed: true }, true);
	await call(operator, "disconnect_mailbox", { mailboxId: codes, confirmed: true }, true);
	await json(mb(codes), 204, undefined, "DELETE");
	assert.equal((await call(operator, "create_mailbox", { email: codes })).disposable, true);
	assert.equal((await json(`${mb(codes)}/emails?folder=inbox`)).totalCount, 1);
	await call(operator, "get_email", { mailboxId: codes, emailId: codeMail.id }, true);

	const c = "billing@third.test";
	await call(operator, "create_mailbox", { email: c }, true); // registered domains only
	await call(operator, "create_domain", { domain: "third.test" });
	assert.equal((await call(operator, "create_mailbox", { email: c, name: "Billing" })).id, c);
	assert.equal((await call(operator, "get_mailbox", { mailboxId: c })).name, "Billing");
	const forwarding = { enabled: true, targets: ["backup@example.net", "accounting@example.net"], keepCopy: true };
	assert.deepEqual((await call(operator, "update_mailbox_settings", { mailboxId: c, settings: { forwarding }, confirmed: true })).settings.forwarding, forwarding);
	const ruleInput = { domain: "third.test", matchType: "exact", localPart: "invoice", action: "mailbox", deliverTo: c, forwardTo: ["one@example.net", "two@example.net"] };
	await call(operator, "create_routing_rule", { rule: ruleInput }, true); // no confirmation
	const adminRule = await call(operator, "create_routing_rule", { rule: ruleInput, confirmed: true });
	assert.deepEqual(adminRule.forwardTo, ruleInput.forwardTo);
	await call(operator, "delete_routing_rule", { ruleId: adminRule.id, confirmed: true });

	const outbound = { mailboxId: c, to: ["one@example.net", "two@example.net"], cc: "copy@example.net", subject: "MCP send fixture", text: "Hello from the test" };
	await call(operator, "send_email", outbound, true);
	await call(sendClient, "send_email", { ...outbound, confirmed: true }, true); // only b
	await call(operator, "send_email", { ...outbound, from: "other@third.test", confirmed: true }, true);
	const viaMcp = await call(operator, "send_email", { ...outbound, confirmed: true });
	assert.equal(viaMcp.status, "sent");
	const viaMcpPath = `${mb(c)}/emails/${viaMcp.id}`;
	const delivered = await json(viaMcpPath);
	assert.equal(delivered.recipient, "one@example.net, two@example.net");
	assert.equal(delivered.cc, "copy@example.net");
	await call(operator, "delete_email", { mailboxId: c, emailId: viaMcp.id, confirmed: true }, true); // Trash only
	await call(operator, "move_email", { mailboxId: c, emailId: viaMcp.id, folderId: "trash" });
	await call(operator, "delete_email", { mailboxId: c, emailId: viaMcp.id, confirmed: true });
	await json(viaMcpPath, 404);
	assert.equal((await fetch(`${base}/api/auth/mcp-tokens`, { headers: { Authorization: `Bearer ${admin.token}` } })).status, 401);
	await call(operator, "disconnect_mailbox", { mailboxId: c, confirmed: true });
	await call(operator, "remove_domain", { domain: "third.test", confirmed: true });
	assert.equal((await fetch(`${base}/api/v1/mailboxes`, { headers: { Authorization: `Bearer ${read.token}` } })).status, 401);
	assert.equal((await http("/mcp", { method: "POST" })).status, 401);
	await json(`/api/auth/mcp-tokens/${read.id}`, 204, undefined, "DELETE");
	assert.equal((await fetch(`${base}/mcp`, { headers: { Authorization: `Bearer ${read.token}` } })).status, 401);
	const pushPath = "/api/auth/push";
	assert.deepEqual(await json(pushPath), { publicKey, devices: [] });
	const subscription = { endpoint: "https://web.push.apple.com/fixture", expirationTime: null, keys: {
		p256dh: publicKey, auth: Buffer.alloc(16).toString("base64url"),
	} };
	await json(pushPath, 400, { label: "Untrusted", subscription: { ...subscription, endpoint: "https://local.test/service" } }, "PUT");
	assert.equal((await http(pushPath, { method: "PUT", headers: { Origin: "https://unrelated.example" } })).status, 403);
	const phone = await json(pushPath, 200, { label: "iPhone", subscription }, "PUT");
	assert.deepEqual((await json(pushPath)).devices, [phone]);
	assert.equal(Object.keys(phone).length, 3);
	await json(`${pushPath}/${phone.id}`, 204, undefined, "DELETE");
	assert.deepEqual((await json(pushPath)).devices, []);
	await json(pushPath, 200, { label: "iPhone", subscription }, "PUT");
	await json("/api/auth/logout", 204, undefined, "POST");
	cookie = "";
	assert.equal((await http("/")).headers.get("Location"), "/login");
	assert.equal((await http("/setup")).headers.get("Location"), "/login");
	const loginAgain = await http("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials) });
	assert.equal(loginAgain.status, 200);
	cookie = loginAgain.headers.get("Set-Cookie").split(";")[0];
	assert.deepEqual((await json(pushPath)).devices, []);
});
