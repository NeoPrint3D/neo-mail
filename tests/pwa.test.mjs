import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const read = (path) => readFile(new URL(`../public/${path}`, import.meta.url), "utf8");

test("PWA manifest and icons provide standalone iOS and installable web app metadata", async () => {
	const manifest = JSON.parse(await read("manifest.webmanifest"));
	assert.equal(manifest.name, "NeoMail");
	assert.equal(manifest.short_name, "NeoMail");
	assert.equal(manifest.id, "/");
	assert.equal(manifest.display, "standalone");
	assert.equal(manifest.start_url, "/");
	assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
	assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
	for (const path of ["icons/inbox-192.png", "icons/inbox-512.png", "icons/inbox-maskable-512.png", "apple-touch-icon.png"]) {
		assert.ok((await stat(new URL(`../public/${path}`, import.meta.url))).size > 1000, `${path} exists`);
	}
	const root = await readFile(new URL("../app/root.tsx", import.meta.url), "utf8");
	assert.match(root, /apple-mobile-web-app-capable/);
	assert.match(root, /apple-mobile-web-app-status-bar-style/);
	assert.match(root, /viewport-fit=cover/);
});

test("service worker caches only public assets and falls back on offline navigation", async () => {
	const origin = "https://inbox.example";
	const listener = {};
	const stored = new Map();
	const cache = { match: async (request) => stored.get(request.url), put: async (request, response) => stored.set(request.url, response) };
	let offline = false;
	let storageUnavailable = false;
	let contentType = "text/javascript";
	let cacheControl = "public";
	let redirected = false;
	const offlinePage = new Response(await read("offline.html"));
	runInNewContext(await read("service-worker.js"), {
		URL, Response,
		self: { location: { origin }, addEventListener: (name, callback) => { listener[name] = callback; } },
		caches: { open: async () => { if (storageUnavailable) throw new Error("quota"); return cache; }, match: async () => offlinePage.clone() },
		fetch: async () => {
			if (offline) throw new Error("offline");
			return { ok: true, type: "basic", redirected, headers: new Headers({ "content-type": contentType, "cache-control": cacheControl }), clone: () => new Response("script") };
		},
	});
	const request = (path, mode = "same-origin", method = "GET") => {
		let response;
		listener.fetch({ request: { url: origin + path, mode, method }, respondWith: (promise) => { response = promise; } });
		return response;
	};
	assert.equal(request("/api/v1/mailboxes"), undefined);
	assert.equal(request("/api/v1/mailboxes/a/emails/1/attachments/b"), undefined);
	assert.equal(request("/api/v1/mailboxes/a/drafts", "same-origin", "POST"), undefined);
	assert.equal(request("/assets/client-12345678.js?private=1"), undefined);
	await request("/assets/client-12345678.js");
	assert.equal(stored.size, 1);
	contentType = "text/html; charset=utf-8";
	await request("/mailbox/a/emails/inbox", "navigate");
	await request("/assets/missing-12345678.js");
	contentType = "text/javascript";
	cacheControl = "private, no-store";
	await request("/assets/private-12345678.js");
	cacheControl = "public";
	redirected = true;
	await request("/assets/redirected-12345678.js");
	assert.equal(stored.size, 1);
	storageUnavailable = true;
	assert.equal((await request("/assets/new-12345678.js")).ok, true);
	storageUnavailable = false;
	offline = true;
	assert.equal(await (await request("/assets/client-12345678.js")).text(), "script");
	assert.match(await (await request("/", "navigate")).text(), /Your messages aren't stored for offline access/);
});

test("Web Push shows private mail and test notifications; taps open only the inbox origin", async () => {
	const origin = "https://inbox.example";
	const listener = {}, notices = [], opened = [];
	let windows = [], focused = 0, closed = 0;
	runInNewContext(await read("service-worker.js"), { URL, self: {
		location: { origin },
		addEventListener: (name, callback) => { listener[name] = callback; },
		registration: { showNotification: async (...args) => notices.push(args) },
		clients: { matchAll: async () => windows, openWindow: async (url) => opened.push(url) },
	} });
	function dispatch(name, event) {
		let result;
		listener[name]({ ...event, waitUntil: (job) => { result = job; } });
		return result;
	}
	await dispatch("push", { data: { json: () => ({ kind: "mail", subject: "Confidential", url: "https://wrong.example/" }) } });
	await dispatch("push", { data: { json: () => ({ kind: "test" }) } });
	await dispatch("push", { data: { json: () => { throw new Error(); } } });
	assert.deepEqual(notices.map(([title, options]) => [title, options.body, options.tag]), [
		["NeoMail", "You have new mail.", "neomail-mail"],
		["NeoMail", "This is a test notification.", "neomail-test"],
	]);
	const notification = { close: () => { closed++; }, data: { url: "https://wrong.example/" } };
	await dispatch("notificationclick", { notification });
	assert.deepEqual(opened, [`${origin}/`]);
	windows = [{ url: `${origin}/`, focus: async () => { focused++; } }];
	await dispatch("notificationclick", { notification });
	assert.equal(opened.length, 1);
	assert.equal(focused, 1);
	assert.equal(closed, 2);
});
