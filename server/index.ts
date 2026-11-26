// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import PostalMime from "postal-mime";
import { z } from "zod";
import { removeAttachmentBlobs, storeAttachments, type StoredAttachment } from "./lib/attachments";
import { deliverEmail } from "./lib/delivery";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildThreadingHeaders,
	listMailboxes,
	mailboxDisposition,
} from "./lib/email-helpers";
import { AttachmentListSchema, SendEmailRequestSchema } from "./lib/schemas";
import { handleReplyEmail, handleForwardEmail } from "./routes/reply-forward";
import { notifyInbox } from "./push";
import { notifyWebhooks } from "./webhooks";
import { Folders } from "../shared/folders";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";
import { addressDomain, canRouteAddress, mailConfig, normalizeAddress } from "./lib/domains";
import { forwardInboundEmail, resolveInboundRecipient } from "./routing";
import { WorkspaceQuery, listWorkspaceMail } from "./lib/workspace";

type AppContext = Context<MailboxContext>;

// -- Request body schemas (kept for validation) ---------------------

export const MailboxSettings = z.object({
	fromName: z.string().trim().max(120).optional(),
	signature: z.object({ enabled: z.boolean(), text: z.string().max(8000), html: z.string().max(16000).optional() }).optional(),
	forwarding: z.object({
		enabled: z.boolean(),
		targets: z.array(z.string().trim().toLowerCase().email("Enter a valid forwarding email address").max(254)).max(10).default([]),
		keepCopy: z.boolean().default(true),
		email: z.string().optional(),
	}).optional(),
});
const CreateMailboxBody = z.object({
	email: z.string().trim().email().max(254).refine((address) => !/[/%]/.test(address), "Address contains unsupported characters"),
	name: z.string().trim().min(1).max(120),
	disposable: z.boolean().default(false),
	settings: MailboxSettings.optional(),
});
type MailboxProfile = z.infer<typeof MailboxSettings> & { disposable?: boolean };
const disposableReservationKey = (email: string) => `disposable-mailboxes/${email}.json`;

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: z.string().optional(),
	body: z.string(),
	in_reply_to: z.string().optional(),
	thread_id: z.string().optional(),
	draft_id: z.string().uuid().optional(),
	attachments: AttachmentListSchema.optional(),
});

// -- Helpers --------------------------------------------------------

function slugify(text: string) { // can return "" for non-alphanumeric input
	return text.toString().toLowerCase()
		.replace(/\s+/g, "-").replace(/[^\w-]+/g, "")
		.replace(/--+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function boolQuery(c: AppContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

// -- App & middleware -----------------------------------------------

const app = new Hono<MailboxContext>();
app.onError((error, c) => {
	if (error instanceof z.ZodError) return c.json({ error: error.issues[0]?.message || "Invalid request" }, 400);
	if (error instanceof SyntaxError) return c.json({ error: "Invalid JSON" }, 400);
	console.error("API request failed", error);
	return c.json({ error: "Could not complete the request" }, 500);
});
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", async (c) => c.json({ ...await mailConfig(c.env), platform: c.env.platform, mcpAllowSend: c.env.MCP_ALLOW_SEND === "true" && !!c.env.SEND_EMAIL, smtpAvailable: !!c.env.SEND_EMAIL }));

app.get("/api/v1/workspace/emails", async (c) => {
	return c.json(await listWorkspaceMail(c.env, WorkspaceQuery.parse(c.req.query())));
});

// -- Mailboxes ------------------------------------------------------

app.get("/api/v1/mailboxes", async (c) => {
	return c.json(await listMailboxes(c.env.STORE));
});

app.post("/api/v1/mailboxes", async (c) => {
	const { name, settings, disposable: requestedDisposable, email: rawEmail } = CreateMailboxBody.parse(await c.req.json());
	const email = normalizeAddress(rawEmail);
	const domain = addressDomain(email);
	const config = await mailConfig(c.env);
	if (!config.domains.includes(domain)) return c.json({ error: "Add this domain in Domains & DNS before creating an inbox" }, 403);
	if (!canRouteAddress(email, config)) return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
	if (await c.env.ROUTING.findByAddress(email)) return c.json({ error: "This address is already assigned to an Email Routing rule" }, 409);
	// Disconnection retains mail. Reconnecting a disposable address must not expose its old messages.
	const disposable = requestedDisposable || !!await c.env.STORE.get(disposableReservationKey(email));
	const finalSettings = { ...settings, fromName: settings?.fromName || name };
	if (c.env.platform && finalSettings.forwarding?.enabled && (finalSettings.forwarding.targets ?? []).some((target) => config.domains.includes(addressDomain(target)))) return c.json({ error: "Choose external addresses for forwarding" }, 400);
	const created = await c.env.STORE.put(`mailboxes/${email}.json`, JSON.stringify({ ...finalSettings, disposable }), {
		onlyIf: { etagDoesNotMatch: "*" }, customMetadata: { name: finalSettings.fromName, disposable: String(disposable) },
	});
	if (!created) return c.json({ error: "Mailbox already exists" }, 409);
	return c.json({ id: email, email, domain, name: finalSettings.fromName, disposable, settings: finalSettings }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const obj = await c.env.STORE.get(`mailboxes/${mailboxId}.json`);
	if (!obj) return c.json({ error: "Not found" }, 404);
	const { disposable = false, ...settings } = await obj.json<MailboxProfile>();
	const aliases = await c.env.ROUTING.listForMailbox(mailboxId);
	return c.json({ id: mailboxId, name: settings.fromName || mailboxId.split("@")[0], email: mailboxId, domain: addressDomain(mailboxId), disposable, settings, aliases });
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const { settings } = z.object({ settings: MailboxSettings }).parse(await c.req.json());
	const name = settings.fromName || mailboxId.split("@")[0];
	if (c.env.platform && settings.forwarding?.enabled) {
		const domains = await c.env.DOMAINS.names();
		if ([...(settings.forwarding.targets ?? []), ...(settings.forwarding.email ? [settings.forwarding.email] : [])].some((target) => domains.includes(addressDomain(target)))) return c.json({ error: "Choose external addresses for forwarding" }, 400);
	}
	const disposable = await mailboxDisposition(c.env.STORE, mailboxId);
	if (disposable === null) return c.json({ error: "Not found" }, 404);
	const updated = await c.env.STORE.put(`mailboxes/${mailboxId}.json`, JSON.stringify({ ...settings, disposable }), {
		onlyIf: { etagMatches: "*" }, customMetadata: { name, disposable: String(disposable) },
	});
	if (!updated) return c.json({ error: "Not found" }, 404);
	const aliases = await c.env.ROUTING.listForMailbox(mailboxId);
	return c.json({ id: mailboxId, name, email: mailboxId, domain: addressDomain(mailboxId), disposable, settings, aliases });
});

// Email Routing edits this same profile, without replacing identity or signature.
const InboxForwarding = MailboxSettings.shape.forwarding.unwrap().omit({ email: true });
app.put("/api/v1/mailboxes/:mailboxId/forwarding", async (c) => {
	const mailboxId = c.req.param("mailboxId");
	const parsed = InboxForwarding.parse(await c.req.json());
	const targets = [...new Set(parsed.targets)];
	if (parsed.enabled) {
		if (!targets.length) return c.json({ error: "Add at least one forwarding destination" }, 400);
		if (targets.includes(mailboxId)) return c.json({ error: "An inbox cannot forward to itself" }, 400);
		if (c.env.platform) {
			const domains = await c.env.DOMAINS.names();
			if (targets.some((target) => domains.includes(addressDomain(target)))) return c.json({ error: "Choose external addresses for forwarding" }, 400);
		}
	}
	const key = `mailboxes/${mailboxId}.json`;
	const obj = await c.env.STORE.get(key);
	if (!obj) return c.json({ error: "Mailbox not found" }, 404);
	const profile = await obj.json<MailboxProfile>();
	const forwarding = { ...parsed, targets };
	const updated = await c.env.STORE.put(key, JSON.stringify({ ...profile, forwarding }), {
		onlyIf: { etagMatches: obj.etag },
		customMetadata: { name: profile.fromName || mailboxId.split("@")[0], disposable: String(profile.disposable === true) },
	});
	if (!updated) return c.json({ error: "This mailbox changed while saving. Reopen the forwarding editor and try again." }, 409);
	return c.json(forwarding);
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const key = `mailboxes/${mailboxId}.json`;
	const disposable = await mailboxDisposition(c.env.STORE, mailboxId);
	if (disposable === null) return c.json({ error: "Not found" }, 404);
	if (disposable) await c.env.STORE.put(disposableReservationKey(mailboxId), "{}", { onlyIf: { etagDoesNotMatch: "*" } });
	// Disconnect the address without removing its stored mail or attachments.
	await c.env.STORE.delete(key);
	return c.body(null, 204);
});

// -- Emails ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const threaded = boolQuery(c, "threaded");
	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const sortColumn = c.req.query("sortColumn") as any;
	const sortDirection = c.req.query("sortDirection") as "ASC" | "DESC" | undefined;
	const stub = c.var.mailboxStub;

	if (threaded && folder) {
		const emails = await (stub as any).getThreadedEmails({ folder, page, limit });
		const totalCount = await (stub as any).countThreadedEmails(folder);
		return c.json({ emails, totalCount });
	}
	const emails = await stub.getEmails({ folder, thread_id, page, limit, sortColumn, sortDirection });
	if (folder) {
		const totalCount = await stub.countEmails({ folder, thread_id });
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});

app.post("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, from, subject, html, text, in_reply_to, references, thread_id } = body;

	const aliases = (await c.env.ROUTING.listForMailbox(mailboxId)).filter((rule) => rule.enabled && rule.matchType === "exact").map((rule) => rule.address);

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId, aliases));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = c.var.mailboxStub;
	const rateLimitError = await stub.checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);
	const receipt = await deliverEmail(c.env, messageId, body, in_reply_to ? buildThreadingHeaders(in_reply_to, references || []) : undefined);
	if (!receipt) return c.json({ error: "Email service did not confirm acceptance. Check sending setup before retrying." }, 502);
	const wireId = receipt.providerMessageId || outgoingMessageId;

	await stub.createEmail(Folders.SENT, {
		id: messageId, subject, sender: fromEmail, recipient: toStr,
		cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
		bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
		date: new Date().toISOString(), body: html || text || "",
		in_reply_to: in_reply_to || null, email_references: references ? JSON.stringify(references) : null,
		thread_id: thread_id || in_reply_to || messageId, message_id: wireId,
		raw_headers: JSON.stringify([
			{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
			{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
			...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
			...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
			{ key: "subject", value: subject }, { key: "date", value: new Date().toISOString() },
			{ key: "message-id", value: `<${wireId}>` },
		]),
	}, receipt.stored);
	return c.json({ id: messageId, status: "sent" }, 201);
});

app.post("/api/v1/mailboxes/:mailboxId/drafts", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const { to, cc, bcc, subject, body, in_reply_to, thread_id, draft_id, attachments } = DraftBody.parse(await c.req.json());
	const stub = c.var.mailboxStub;
	const id = draft_id || crypto.randomUUID();
	const now = new Date().toISOString();
	const fields = {
		subject: subject || "", recipient: (to || "").toLowerCase(), cc: cc?.toLowerCase() || null,
		bcc: bcc?.toLowerCase() || null, body, in_reply_to: in_reply_to || null, thread_id: thread_id || in_reply_to || id,
	};
	const stored = attachments && await storeAttachments(c.env.STORE, id, attachments);
	try {
		if (draft_id) {
			const updated = await stub.updateDraft(id, fields, stored);
			if (!updated) {
				await removeAttachmentBlobs(c.env.STORE, id, stored ?? []);
				return c.json({ error: "Draft not found" }, 404);
			}
			await removeAttachmentBlobs(c.env.STORE, id, updated.removed);
		} else {
			await stub.createEmail(Folders.DRAFT, { ...fields, id, sender: mailboxId, date: now }, stored ?? []);
		}
	} catch (error) {
		await removeAttachmentBlobs(c.env.STORE, id, stored ?? []);
		throw error;
	}
	return c.json({ id, status: "draft", subject: fields.subject, recipient: fields.recipient, date: now, attachments: stored?.map((attachment) => ({
		id: attachment.id, filename: attachment.filename, size: attachment.size, mimetype: attachment.mimetype,
		content_id: attachment.content_id, disposition: attachment.disposition,
	})) }, draft_id ? 200 : 201);
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailboxStub.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const { read, starred } = z.object({ read: z.boolean().optional(), starred: z.boolean().optional() }).parse(await c.req.json());
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id")!, { read, starred });
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const trashOnly = boolQuery(c, "trashOnly") === true;
	const draftOnly = boolQuery(c, "draftOnly") === true;
	if (trashOnly && draftOnly) return c.json({ error: "Choose one required folder" }, 400);
	const attachments = await c.var.mailboxStub.deleteEmail(id, trashOnly ? Folders.TRASH : draftOnly ? Folders.DRAFT : undefined);
	if (attachments === null) return c.json({ error: trashOnly ? "Message is no longer in Trash" : draftOnly ? "Draft not found" : "Not found" }, 404);
	await removeAttachmentBlobs(c.env.STORE, id, attachments);
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const { folderId } = (await c.req.json()) as { folderId: string };
	const success = await c.var.mailboxStub.moveEmail(c.req.param("id")!, folderId);
	return success ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/recover", async (c: AppContext) => {
	const recovered = await c.var.mailboxStub.recoverEmail(c.req.param("id")!);
	return recovered ? c.json(recovered) : c.json({ error: "Message is no longer in Trash" }, 404);
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await (c.var.mailboxStub as any).getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- Reply / Forward ------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", handleForwardEmail);

// -- Folders --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	const disposable = await mailboxDisposition(c.env.STORE, c.req.param("mailboxId")!);
	const folders = await c.var.mailboxStub.getFolders();
	return c.json(disposable ? folders.map((folder) => ({ ...folder, unreadCount: 0 })) : folders);
});

const FolderBody = z.object({ name: z.string().trim().min(1).max(120) });

app.post("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	const { name } = FolderBody.parse(await c.req.json());
	const slug = slugify(name);
	if (!slug) return c.json({ error: "Folder name must contain alphanumeric characters" }, 400);
	const f = await c.var.mailboxStub.createFolder(slug, name);
	return f ? c.json(f, 201) : c.json({ error: "Folder with this name already exists" }, 409);
});

app.put("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const { name } = FolderBody.parse(await c.req.json());
	const f = await c.var.mailboxStub.updateFolder(c.req.param("id")!, name);
	if (f === "duplicate") return c.json({ error: "Folder with this name already exists" }, 409);
	if (f === "missing") return c.json({ error: "Folder not found or cannot be renamed" }, 404);
	return c.json(f);
});

app.delete("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const ok = await c.var.mailboxStub.deleteFolder(c.req.param("id")!);
	return ok ? c.body(null, 204) : c.json({ error: "Folder not found or cannot be deleted" }, 400);
});

// -- Search ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	if (await mailboxDisposition(c.env.STORE, c.req.param("mailboxId")!)) return c.json({ emails: [], totalCount: 0 });
	const searchOpts: Record<string, unknown> = {
		query: c.req.query("query") || "", folder: c.req.query("folder"), from: c.req.query("from"),
		to: c.req.query("to"), subject: c.req.query("subject"), date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"), is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"), has_attachment: boolQuery(c, "has_attachment"),
	};
	const stub = c.var.mailboxStub as any;
	const emails = await stub.searchEmails({ ...searchOpts, page: intQuery(c, "page"), limit: intQuery(c, "limit") });
	const totalCount = await stub.countSearchResults(searchOpts);
	return c.json({ emails, totalCount });
});

// -- Attachments ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", async (c: AppContext) => {
	const emailId = c.req.param("emailId")!;
	const attachmentId = c.req.param("attachmentId")!;
	const attachment = await c.var.mailboxStub.getAttachment(attachmentId);
	if (!attachment || attachment.email_id !== emailId) return c.json({ error: "Attachment not found" }, 404);
	const obj = await c.env.STORE.get(`attachments/${emailId}/${attachmentId}/${attachment.filename}`);
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);
	const headers = new Headers();
	headers.set("Content-Type", attachment.mimetype);
	const sanitized = attachment.filename.replace(/[\x00-\x1f"\\]/g, "_");
	headers.set("Content-Disposition", `attachment; filename="${sanitized}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
	return new Response(obj.body, { headers });
});

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE) throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) { reader.cancel(); throw new Error(`Stream exceeds declared size`); }
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

async function receiveEmail(event: { to: string; raw: ReadableStream<Uint8Array>; rawSize: number; setReject: (message: string) => void; forwardedAlready?: boolean; forward?: (address: string) => Promise<unknown> }, env: Env) {
	// The SMTP envelope is authoritative. To/Cc are display headers and may omit the mailbox (Bcc).
	const plan = await resolveInboundRecipient(env, event.to);
	if (!plan.accept) {
		event.setReject(plan.reason || "Mailbox unavailable");
		return;
	}
	if (event.rawSize > MAX_EMAIL_SIZE) { event.setReject("Message exceeds 25 MiB"); return; }
	async function forwardAll(forward: (address: string) => Promise<unknown>, addresses: string[]) {
		let delivered = 0;
		const errors: unknown[] = [];
		for (const address of addresses) {
			try { await forward(address); delivered++; }
			catch (error) { errors.push(error); }
		}
		if (!delivered && errors.length) throw new AggregateError(errors, "Could not forward incoming mail");
		if (errors.length) console.error(`Forwarding partially failed (${delivered}/${addresses.length} accepted)`, errors);
	}
	let targets = plan.forwardTo;
	if (event.forward && targets.length) {
		const localDomains = new Set(await env.DOMAINS.names());
		targets = event.forwardedAlready ? [] : targets.filter((target) => !localDomains.has(addressDomain(target)));
		if (!plan.deliverTo) {
			if (!targets.length) event.setReject("No external destination available for forwarding");
			else {
				await forwardAll(event.forward, targets);
				notifyWebhooks(env, plan.recipient);
			}
			return;
		}
	}
	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parsedEmail = await new PostalMime().parse(rawEmail);

	let storedLocally = false;
	if (plan.deliverTo && await env.STORE.head(`mailboxes/${plan.deliverTo}.json`)) {
		const targetMailboxId = plan.deliverTo;
		const allRecipients = (parsedEmail.to || []).flatMap((item) => item.address ? [normalizeAddress(item.address)] : []);
		const ccRecipients = (parsedEmail.cc || []).flatMap((item) => item.address ? [normalizeAddress(item.address)] : []);
		const bccRecipients = (parsedEmail.bcc || []).flatMap((item) => item.address ? [normalizeAddress(item.address)] : []);
		const messageId = crypto.randomUUID();
		const stub = env.MAILBOX.get(targetMailboxId);

		const attachmentData: StoredAttachment[] = [];
		if (parsedEmail.attachments) {
			for (const att of parsedEmail.attachments) {
				const attId = crypto.randomUUID();
				const filename = (att.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
				await env.STORE.put(`attachments/${messageId}/${attId}/${filename}`, att.content);
				attachmentData.push({ id: attId, email_id: messageId, filename, mimetype: att.mimeType,
					size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
					content_id: att.contentId || null, disposition: att.disposition || "attachment" });
			}
		}

		const extractMsgId = (s: string) => { const m = s.match(/<([^>]+)>/); return m ? m[1] : s.trim().split(/\s+/)[0]; };
		const inReplyTo = parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null;
		const emailReferences = parsedEmail.references ? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId) : [];
		const knownThreadId = await stub.findThreadByMessageIds([inReplyTo, ...emailReferences.slice().reverse()].filter((id): id is string => !!id));
		let threadId = knownThreadId || emailReferences[0] || inReplyTo || messageId;

		if (!inReplyTo && emailReferences.length === 0) {
			const subjectThread = await stub.findThreadBySubject(parsedEmail.subject || "", parsedEmail.from?.address || undefined);
			if (subjectThread) threadId = subjectThread;
		}

		const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;
		const headers = [
			...(parsedEmail.headers || []),
			...(plan.recipient !== targetMailboxId ? [{ key: "x-delivered-to", value: plan.recipient }] : []),
		];

		const originalBody = parsedEmail.html || parsedEmail.text || "";
		// SQLite-backed Durable Objects limit a single row to 2 MiB. Attachments
		// are separate R2 objects; cap unusually large HTML/header previews.
		const body = env.platform && originalBody.length > 350_000 ? `${originalBody.slice(0, 350_000)}\n\n[Message preview truncated]` : originalBody;
		const serializedHeaders = JSON.stringify(headers);
		await stub.createEmail(Folders.INBOX, {
			id: messageId, subject: parsedEmail.subject || "",
			sender: (parsedEmail.from?.address || "").toLowerCase(), recipient: allRecipients.join(", ") || plan.recipient,
			cc: ccRecipients.join(", ") || null, bcc: bccRecipients.join(", ") || null,
			date: new Date().toISOString(), // uses receive time, not the email's Date header
			body,
			in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
			thread_id: threadId, message_id: originalMessageId,
			raw_headers: env.platform && serializedHeaders.length > 70_000 ? JSON.stringify(headers.filter(({ key }) => ["from", "to", "subject", "date", "message-id"].includes(key)).map(({ key, value }) => ({ key, value: value.slice(0, 512) }))) : serializedHeaders,
		}, attachmentData);
		storedLocally = true;
		notifyInbox(env, targetMailboxId);
		notifyWebhooks(env, plan.recipient, targetMailboxId, messageId);
	}

	if (targets.length > 0) {
		try {
			if (event.forward) await forwardAll(event.forward, targets);
			else await forwardInboundEmail(env, plan.recipient, targets, parsedEmail);
			if (!storedLocally) notifyWebhooks(env, plan.recipient);
		} catch (error) {
			if (!plan.deliverTo) {
				throw error;
			}
			console.error(`Forwarding failed after local delivery for ${plan.recipient}:`, error);
		}
	}
}

export { app, receiveEmail };
