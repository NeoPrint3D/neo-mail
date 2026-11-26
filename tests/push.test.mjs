import assert from "node:assert/strict";
import { createECDH, createPublicKey, randomBytes, verify } from "node:crypto";
import { test } from "node:test";
import { receiveEmail } from "../server/index.ts";
import { deliverPush, loadPushKeys, PushStore, pushEndpoint, pushSubscription } from "../server/push.ts";
import { SQLiteStore } from "../server/sqlite.ts";

const makePair = () => {
	const ecdh = createECDH("prime256v1");
	const publicKey = ecdh.generateKeys().toString("base64url");
	const scalar = ecdh.getPrivateKey();
	return { publicKey, privateKey: Buffer.concat([Buffer.alloc(32 - scalar.length), scalar]).toString("base64url") };
};
const vapid = { ...makePair(), subject: "https://inbox.example.test" };
const makeSubscription = (endpoint = "https://web.push.apple.com/fixture") => ({ endpoint, expirationTime: null,
	keys: { p256dh: makePair().publicKey, auth: randomBytes(16).toString("base64url") } });

function store(t) {
	const { db } = new SQLiteStore(":memory:");
	t.after(() => db.close());
	return new PushStore(db);
}

test("Web Push accepts browser subscriptions and rejects other hosts and malformed keys", () => {
	assert.deepEqual(loadPushKeys(JSON.stringify(vapid)), vapid);
	assert.equal(loadPushKeys(JSON.stringify({ ...vapid, privateKey: "invalid" })), undefined);
	assert.equal(loadPushKeys("bad-json"), undefined);
	for (const endpoint of ["https://web.push.apple.com/device", "https://fcm.googleapis.com/fcm/send/device", "https://updates.push.services.mozilla.com/wpush/v2/device"])
		assert.ok(pushSubscription.safeParse(makeSubscription(endpoint)).success);
	for (const endpoint of ["http://web.push.apple.com/device", "https://web.push.apple.com.evil.test/device", "https://web.push.apple.com@internal.test/a", "https://127.0.0.1/device", "https://fcm.googleapis.com/unrelated", "https://web.push.apple.com:99/device"])
		assert.equal(pushEndpoint.safeParse(endpoint).success, false);
	const sub = makeSubscription();
	assert.equal(pushSubscription.safeParse({ ...sub, keys: { ...sub.keys, auth: "not-a-key" } }).success, false);
});

test("Web Push device storage exposes only safe metadata, caps registrations and revokes by device or session", (t) => {
	const devices = store(t);
	const key = vapid.publicKey;
	const sub = makeSubscription();
	const device = devices.save(sub, "iPhone", key, "old-session");
	assert.deepEqual(Object.keys(device), ["id", "label", "createdAt"]);
	assert.deepEqual(devices.list(key), [device]);
	assert.deepEqual(devices.list("older-key"), []);
	assert.equal(devices.save({ ...sub, expirationTime: Date.now() - 1 }, "Expired", key, "old-session"), null);
	assert.equal(devices.save(sub, "iPhone", key, "new-session").id, device.id);
	for (let i = 0; i < 15; i++) assert.ok(devices.save(makeSubscription(`https://web.push.apple.com/id${i}`), "Other", key, "others"));
	assert.equal(devices.save(makeSubscription("https://web.push.apple.com/overflow"), "Extra", key, "new-session"), null);
	devices.removeForSession("old-session");
	assert.equal(devices.list(key).length, 16);
	devices.removeForSession("new-session");
	assert.equal(devices.list(key).length, 15);
	devices.clear();
	assert.deepEqual(devices.list(), []);
});

test("new inbox mail triggers encrypted Web Push after storage, but disposable and forward-only receipts stay quiet", async (t) => {
	const devices = store(t);
	const sub = makeSubscription();
	devices.save(sub, "iPhone", vapid.publicKey, "session");
	const jobs = [], local = [], external = [];
	let requests = 0, status = 201;
	t.mock.method(globalThis, "fetch", async (url, init) => {
		requests++;
		assert.equal(url, sub.endpoint);
		assert.equal(init.redirect, "manual");
		assert.equal(init.headers["content-encoding"], "aes128gcm");
		assert.equal(init.body.byteLength, 4096);
		assert.ok(!Buffer.from(init.body).includes("Private subject"));
		const [, token, pub] = init.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
		assert.equal(pub, vapid.publicKey);
		const [header, claims, signature] = token.split(".");
		assert.equal(JSON.parse(Buffer.from(claims, "base64url")).aud, new URL(url).origin);
		const key = Buffer.from(pub, "base64url");
		const jwk = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: key.subarray(1, 33).toString("base64url"), y: key.subarray(33).toString("base64url") } });
		assert.equal(verify("sha256", Buffer.from(`${header}.${claims}`), { key: jwk, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")), true);
		return new Response(null, { status });
	});
	const env = {
		PUSH_KEYS: vapid, PUSH_DEVICES: devices, waitUntil: (job) => jobs.push(job),
		DOMAINS: { names: () => ["mail.test"] }, ROUTING: { findByAddress: () => null },
		STORE: { head: async () => true, get: async (path) => ({ json: async () => path.includes("codes@") ? { disposable: true }
			: path.includes("relay@") ? { forwarding: { enabled: true, keepCopy: false, targets: ["relay@example.net"] } } : {} }) },
		MAILBOX: { get: (mailbox) => ({ findThreadByMessageIds: () => null, findThreadBySubject: () => null, createEmail: () => local.push(mailbox) }) },
	};
	async function receive(to) {
		const raw = new TextEncoder().encode(`From: private@example.net\r\nTo: ${to}\r\nSubject: Private subject\r\n\r\nPrivate message`);
		await receiveEmail({ to, raw: new Blob([raw]).stream(), rawSize: raw.length, setReject: assert.fail, forward: async (to) => external.push(to) }, env);
		await Promise.all(jobs.splice(0));
	}
	await receive("normal@mail.test");
	assert.equal(requests, 1);
	await receive("codes@mail.test");
	await receive("relay@mail.test");
	assert.equal(requests, 1);
	assert.deepEqual(local, ["normal@mail.test", "codes@mail.test"]);
	assert.deepEqual(external, ["relay@example.net"]);
	// Retain the subscription on transient failures; prune it when the provider says it expired.
	const [row] = devices.rows(vapid.publicKey);
	status = 302;
	assert.equal(await deliverPush(env, row, "test"), "failed");
	assert.equal(devices.list().length, 1);
	status = 410;
	assert.equal(await deliverPush(env, row, "test"), "expired");
	assert.deepEqual(devices.list(), []);
});
