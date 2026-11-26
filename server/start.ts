import { getRequestListener } from "@hono/node-server";
import express from "express";
import { Resolver } from "node:dns/promises";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { resolve, join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequestHandler, type ServerBuild } from "react-router";
import { createApp } from "./app";
import { AuthStore } from "./auth";
import { Domains, hostName } from "./domains";
import { sendEmail, smtpTransport } from "./email-sender";
import { loadPushKeys, PushStore } from "./push";
import { RoutingStore } from "./routing";
import { webhookOrigins, WebhookStore } from "./webhooks";
import { listenForMail } from "./smtp";
import { SQLiteStore } from "./sqlite";
import { BlobStore, Mailboxes } from "./storage";
import type { Env } from "./types";

if (existsSync(".env")) process.loadEnvFile(".env");
const dev = process.argv.includes("--dev");
const option = (name: string) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const portNumber = (value: string) => {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${value}`);
	return port;
};
const port = portNumber(option("--port") || process.env.PORT || "3000");
const host = option("--host") || process.env.HOST || "127.0.0.1";
const directory = resolve(process.env.DATA_DIR || "./data");
for (const publicPath of ["public", "build"]) {
	const fromPublic = relative(resolve(publicPath), directory);
	if (!isAbsolute(fromPublic) && fromPublic !== ".." && !fromPublic.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
		throw new Error("DATA_DIR cannot be inside public or build");
	}
}
const appUrl = process.env.APP_URL ? new URL(process.env.APP_URL) : undefined;
if (appUrl && (!/^https?:$/.test(appUrl.protocol) || appUrl.pathname !== "/" || appUrl.search || appUrl.hash || appUrl.username || appUrl.password)) throw new Error("APP_URL must be a plain HTTP(S) origin");
const smtpPort = portNumber(process.env.SMTP_INBOUND_PORT || "0");
const smtpTls = process.env.SMTP_TLS_KEY && process.env.SMTP_TLS_CERT ? { key: process.env.SMTP_TLS_KEY, cert: process.env.SMTP_TLS_CERT } : undefined;
if (Boolean(process.env.SMTP_TLS_KEY) !== Boolean(process.env.SMTP_TLS_CERT)) throw new Error("Provide both SMTP_TLS_KEY and SMTP_TLS_CERT, or neither");
const mailHostname = process.env.MAIL_HOSTNAME ? hostName.parse(process.env.MAIL_HOSTNAME) : "";
if (process.env.SETUP_CODE && process.env.SETUP_CODE.length < 20) throw new Error("SETUP_CODE must be at least 20 characters");
process.umask(0o077);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const catalog = new SQLiteStore(join(directory, "workspace.sqlite"));
const auth = new AuthStore(catalog.db, process.env.SETUP_CODE);
const relay = smtpTransport(process.env.SMTP_URL);
const pushKeys = loadPushKeys(process.env.WEB_PUSH_VAPID);
if (process.env.WEB_PUSH_VAPID && !pushKeys) console.warn("Invalid WEB_PUSH_VAPID configuration; push notifications are disabled");
const env: Env = {
	AUTH: auth,
	PUSH_KEYS: pushKeys,
	PUSH_DEVICES: new PushStore(catalog.db),
	WEBHOOKS: new WebhookStore(catalog.db),
	WEBHOOK_ALLOWED_ORIGINS: webhookOrigins(process.env.WEBHOOK_ALLOWED_ORIGINS),
	DNS: new Resolver({ timeout: 1800, tries: 1 }),
	DOMAINS: new Domains(catalog.db, process.env.DOMAINS, mailHostname),
	ROUTING: new RoutingStore(catalog.db),
	STORE: new BlobStore(join(directory, "blobs"), catalog.db),
	MAILBOX: new Mailboxes(join(directory, "mailboxes")),
	SEND_EMAIL: relay && ((message) => sendEmail(relay, message)),
	EMAIL_ADDRESSES: process.env.EMAIL_ADDRESSES?.split(","),
	MCP_ALLOW_SEND: process.env.MCP_ALLOW_SEND,
	MAIL_HOSTNAME: mailHostname,
	SMTP_TLS: !!smtpTls && smtpPort > 0,
	SMTP_INBOUND_PORT: smtpPort,
	CLOUDFLARE_TOKEN: process.env.CLOUDFLARE_TOKEN,
	INBOUND_WEBHOOK_SECRET: process.env.INBOUND_WEBHOOK_SECRET,
	APP_URL: appUrl,
};

const http = express();
http.disable("x-powered-by");
const server = createServer(http);
server.requestTimeout = 45_000;
server.headersTimeout = 15_000;

let loadBuild: () => Promise<ServerBuild>;
if (dev) {
	const { createServer: createVite } = await import("vite");
	const vite = await createVite({ appType: "custom", server: { middlewareMode: true, hmr: { server }, cors: false, allowedHosts: appUrl ? [appUrl.hostname] : [],
		fs: { deny: [".env", ".env.*", ".dev.vars*", "*.{crt,pem}", "**/.git/**", "**/.wrangler/**", "**/data/**", "**/server/**", "**/workers/**", "**/*.sqlite{,-shm,-wal}", `${directory.replaceAll("\\", "/")}/**`] },
	} });
	http.use((req, res, next) => {
		if (req.path.startsWith("/api/") || ["/mcp", "/healthz", "/.well-known/mta-sts.txt"].includes(req.path)) return next();
		return vite.middlewares(req, res, next);
	});
	loadBuild = () => vite.ssrLoadModule("virtual:react-router/server-build") as Promise<ServerBuild>;
} else {
	const client = resolve("build/client");
	http.use("/assets", express.static(join(client, "assets"), { immutable: true, maxAge: "1y", index: false }));
	http.use(express.static(client, { index: false, redirect: false, maxAge: "1h" }));
	const build = await import(pathToFileURL(resolve("build/server/index.js")).href) as ServerBuild;
	loadBuild = () => Promise.resolve(build);
}

const render = createRequestHandler(loadBuild, dev ? "development" : "production");
const app = createApp(render);
http.use(getRequestListener((request, { incoming }) => {
	const forwarded = process.env.TRUST_PROXY === "1" ? request.headers.get("X-Forwarded-For")?.split(",").at(-1)?.trim() : undefined;
	// Construct a native Fetch Request so middleware and MCP can clone or wrap its body.
	const hasBody = request.method !== "GET" && request.method !== "HEAD" &&
		(Number(request.headers.get("content-length")) > 0 || !!request.headers.get("transfer-encoding"));
	const init: RequestInit & { duplex: "half" } = {
		method: request.method, headers: request.headers, signal: request.signal, duplex: "half",
		body: hasBody ? request.body : undefined,
	};
	return app.fetch(new Request(request.url, init), { ...env, requestIp: forwarded && isIP(forwarded) ? forwarded : incoming.socket.remoteAddress });
}, { overrideGlobalObjects: false }));

const smtp = smtpPort > 0 ? await listenForMail(env, smtpPort, process.env.SMTP_INBOUND_HOST || host, smtpTls) : undefined;
await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(port, host, done); });
const listening = server.address();
console.log(`NeoMail is ready at ${appUrl?.origin || `http://${host}:${typeof listening === "object" && listening ? listening.port : port}`}`);
if (!auth.configured()) console.log(process.env.SETUP_CODE
	? "Open /setup and use the setup code configured in SETUP_CODE."
	: `First time setup: open /setup and enter this one-time code: ${auth.setupCode}`);
if (smtp) console.log(`Inbound SMTP listening on port ${smtpPort}${smtpTls ? " with STARTTLS" : ""}`);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
	smtp?.close();
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 5000).unref();
});
