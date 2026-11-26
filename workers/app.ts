// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file.
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { DurableObject } from "cloudflare:workers";
import { createRequestHandler, type ServerBuild } from "react-router";
import * as build from "../build/server/index.js";
import { createApp } from "../server/app";
import { receiveEmail } from "../server/index";
import { loadPushKeys } from "../server/push";
import { webhookOrigins } from "../server/webhooks";
import type { Mailbox, Env } from "../server/types";
import { cloudflareMail } from "./cloudflare-mail";
import { dohResolver } from "./dns";
import { R2Store } from "./storage";
import type { Bindings } from "./types";

export { MailboxDO } from "./durableObject";
export { WorkspaceDO } from "./workspace";
// Retain export names from the original deployment's migration history.
export class EmailAgent extends DurableObject {}
export class EmailMCP extends DurableObject {}

const render = createRequestHandler(build as unknown as ServerBuild, "production");
const app = createApp(render);

function environment(bindings: Bindings, ctx: ExecutionContext, requestIp?: string): Env {
	const ws = bindings.WORKSPACE.getByName("workspace");
	return {
		PUSH_KEYS: loadPushKeys(bindings.WEB_PUSH_VAPID),
		PUSH_DEVICES: {
			save: (...args) => ws.pushSave(...args),
			list: (...args) => ws.pushList(...args),
			rows: (...args) => ws.pushRows(...args),
			remove: (...args) => ws.pushRemove(...args),
			removeForSession: (...args) => ws.pushRemoveForSession(...args),
			clear: () => ws.pushClear(),
		},
		waitUntil: (job) => ctx.waitUntil(job),
		WEBHOOKS: {
			list: (...args) => ws.webhookList(...args),
			create: (...args) => ws.webhookCreate(...args),
			get: (...args) => ws.webhookGet(...args),
			forRecipient: (...args) => ws.webhookForRecipient(...args),
			setEnabled: (...args) => ws.webhookSetEnabled(...args),
			delete: (...args) => ws.webhookDelete(...args),
			claim: (...args) => ws.webhookClaim(...args),
			record: (...args) => ws.webhookRecord(...args),
		},
		WEBHOOK_ALLOWED_ORIGINS: webhookOrigins(bindings.WEBHOOK_ALLOWED_ORIGINS),
		AUTH: {
			configured: (...args) => ws.authConfigured(...args),
			canSetup: (...args) => ws.authCanSetup(...args),
			allowAttempt: (...args) => ws.authAllowAttempt(...args),
			initialize: (...args) => ws.authInitialize(...args),
			verify: (...args) => ws.authVerify(...args),
			changePassword: (...args) => ws.authChangePassword(...args),
			createSession: (...args) => ws.authCreateSession(...args),
			sessionEmail: (...args) => ws.authSessionEmail(...args),
			deleteSession: (...args) => ws.authDeleteSession(...args),
			createToken: (...args) => ws.authCreateToken(...args),
			listTokens: (...args) => ws.authListTokens(...args),
			revokeToken: (...args) => ws.authRevokeToken(...args),
			verifyToken: (...args) => ws.authVerifyToken(...args),
		},
		DOMAINS: {
			names: (...args) => ws.domainsNames(...args),
			list: (...args) => ws.domainsList(...args),
			get: (...args) => ws.domainsGet(...args),
			create: (...args) => ws.domainsCreate(...args),
			update: (...args) => ws.domainsUpdate(...args),
			delete: (...args) => ws.domainsDelete(...args),
		},
		ROUTING: {
			list: (...args) => ws.routingList(...args),
			listForMailbox: (...args) => ws.routingListForMailbox(...args),
			get: (...args) => ws.routingGet(...args),
			findByAddress: (...args) => ws.routingFindByAddress(...args),
			create: (...args) => ws.routingCreate(...args),
			update: (...args) => ws.routingUpdate(...args),
			delete: (...args) => ws.routingDelete(...args),
		},
		STORE: new R2Store(bindings.BUCKET),
		MAILBOX: { get: (address) => bindings.MAILBOX.getByName(address) as unknown as Mailbox },
		DNS: dohResolver(),
		SEND_EMAIL: bindings.EMAIL && (({ attachments, ...message }) => bindings.EMAIL!.send({
			...message,
			attachments: attachments?.map(({ disposition, contentId, ...file }): EmailAttachment =>
				disposition === "inline" && contentId ? { ...file, disposition, contentId } : { ...file, disposition: "attachment" }),
		})),
		CLOUDFLARE_MAIL: bindings.CLOUDFLARE_TOKEN && bindings.CLOUDFLARE_WORKER_NAME ?
			cloudflareMail(bindings.CLOUDFLARE_TOKEN, bindings.CLOUDFLARE_WORKER_NAME, bindings.CLOUDFLARE_ACCOUNT_ID) : undefined,
		CLOUDFLARE_TOKEN: bindings.CLOUDFLARE_TOKEN,
		platform: "cloudflare",
		SMTP_TLS: false,
		SMTP_INBOUND_PORT: 0,
		MAIL_HOSTNAME: "",
		EMAIL_ADDRESSES: typeof bindings.EMAIL_ADDRESSES === "string" ? bindings.EMAIL_ADDRESSES.split(",") : bindings.EMAIL_ADDRESSES,
		MCP_ALLOW_SEND: bindings.MCP_ALLOW_SEND,
		APP_URL: bindings.APP_URL ? new URL(bindings.APP_URL) : undefined,
		requestIp,
	};
}

export default {
	fetch(request: Request, bindings: Bindings, ctx: ExecutionContext) {
		return app.fetch(request, environment(bindings, ctx, request.headers.get("CF-Connecting-IP") || undefined), ctx);
	},
	async email(message: ForwardableEmailMessage, bindings: Bindings, ctx: ExecutionContext) {
		const marker = bindings.CLOUDFLARE_WORKER_NAME ?? "agentic-inbox";
		await receiveEmail({
			to: message.to, raw: message.raw, rawSize: message.rawSize,
			setReject: (reason) => message.setReject(reason),
			forwardedAlready: message.headers.get("X-Agentic-Inbox-Forwarded-By") === marker,
			forward: (destination) => message.forward(destination, new Headers({ "X-Agentic-Inbox-Forwarded-By": marker })),
		}, environment(bindings, ctx));
	},
};
