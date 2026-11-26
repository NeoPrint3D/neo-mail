// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import type { Attachment, Email, Folder, ForwardingSettings, Mailbox, WorkspacePage } from "~/types";
import type { CloudflareMailStatus, ForwardingDestination } from "shared/cloudflare-mail";
import type { McpIssuablePermission, McpScope, McpToken } from "shared/mcp";
import type { OutgoingAttachment } from "shared/attachments";
import type { PushDevice, PushSettings } from "shared/push";
import type { MailWebhook } from "shared/webhooks";
import type { DomainConfig, DomainResult, DnsCheck, DnsRecord } from "shared/dns";
import type { CloudflareRoutingSyncResult, InboxForwardingRule, RoutingRule, RoutingRuleInput } from "shared/routing";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
	status: number;
	body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown>) {
		super((body.error as string) || `Request failed: ${status}`);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

async function request<T>(
	url: string,
	options: RequestInit = {},
	responseAsBlob = false,
): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	// Combine caller signal (e.g. TanStack Query abort) with our timeout signal
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;

	try {
		const res = await fetch(url, {
			...options,
			signal,
			headers: {
				"Content-Type": "application/json",
				...(options.headers as Record<string, string>),
			},
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login" && !url.startsWith("/api/auth/")) window.location.assign("/login");
			throw new ApiError(res.status, body as Record<string, unknown>);
		}

		if (res.status === 204) return undefined as T;

		const contentType = res.headers.get("content-type") ?? "";
		if (!responseAsBlob && contentType.includes("application/json")) {
			return res.json() as Promise<T>;
		}
		return res.blob() as unknown as T;
	} finally {
		clearTimeout(timeout);
	}
}

function get<T>(url: string, opts?: { params?: Record<string, string>; responseType?: string; signal?: AbortSignal }) {
	const query = opts?.params ? `?${new URLSearchParams(opts.params)}` : "";
	return request<T>(`${url}${query}`, {
		method: "GET",
		signal: opts?.signal,
		...(opts?.responseType === "blob" ? { headers: { Accept: "*/*" } } : {}),
	}, opts?.responseType === "blob");
}

function post<T>(url: string, body?: unknown, opts?: { signal?: AbortSignal }) {
	return request<T>(url, {
		method: "POST",
		signal: opts?.signal,
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function put<T>(url: string, body?: unknown) {
	return request<T>(url, {
		method: "PUT",
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function del<T>(url: string) {
	return request<T>(url, { method: "DELETE" });
}

// ---------- Typed response shapes ----------

interface EmailListResponse {
	emails: Email[];
	totalCount: number;
}

// ---------- API client ----------

export type { McpToken } from "shared/mcp";

const api = {
	getSession: () => get<{ email: string | null; setupRequired: boolean; setupAvailable: boolean }>("/api/auth/session"),
	signIn: (data: { email: string; password: string }) => post<{ email: string }>("/api/auth/login", data),
	setup: (data: { email: string; password: string; code: string }) => post<{ email: string }>("/api/auth/setup", data),
	signOut: (deviceId?: string) => post<void>("/api/auth/logout", { deviceId }),
	pushSettings: () => get<PushSettings>("/api/auth/push"),
	enablePush: (label: string, subscription: PushSubscriptionJSON) => put<PushDevice>("/api/auth/push", { label, subscription }),
	disablePush: (id: string) => del<void>(`/api/auth/push/${encodeURIComponent(id)}`),
	testPush: (id: string) => post<void>(`/api/auth/push/${encodeURIComponent(id)}/test`),
	changePassword: (data: { current: string; password: string }) => post<void>("/api/auth/password", data),
	listMcpTokens: () => get<McpToken[]>("/api/auth/mcp-tokens"),
	createMcpToken: (data: Pick<McpScope, "mailboxes"> & { name: string; permission: McpIssuablePermission }) => post<McpToken & { token: string }>("/api/auth/mcp-tokens", data),
	revokeMcpToken: (id: string) => del<void>(`/api/auth/mcp-tokens/${encodeURIComponent(id)}`),
	listDomains: () => get<{ domains: DomainResult[]; defaultMxHost: string; autoPublish: boolean; smtpTls: boolean; platform?: "cloudflare"; cloudflareConfigured: boolean }>("/api/v1/domains"),
	addDomain: (data: DomainConfig) => post<DomainResult>("/api/v1/domains", data),
	updateDomain: (data: DomainConfig) => put<DomainResult>(`/api/v1/domains/${encodeURIComponent(data.domain)}`, data),
	removeDomain: (domain: string) => del<void>(`/api/v1/domains/${encodeURIComponent(domain)}`),
	checkDns: (domain: string) => get<DnsCheck[]>(`/api/v1/domains/${encodeURIComponent(domain)}/check`),
	publishDns: (domain: string) => post<(DnsRecord & { state: "unchanged" | "conflict" | "created" | "error"; error?: string })[]>(`/api/v1/domains/${encodeURIComponent(domain)}/publish`, { confirmed: true }),
	cloudflareStatus: (domain: string) => get<CloudflareMailStatus>(`/api/v1/domains/${encodeURIComponent(domain)}/cloudflare`),
	connectCloudflare: (domain: string, action: "receive" | "send") => post<CloudflareMailStatus>(`/api/v1/domains/${encodeURIComponent(domain)}/cloudflare`, { action, confirmed: true }),
	forwardingDestinations: (domain: string) => get<ForwardingDestination[]>(`/api/v1/domains/${encodeURIComponent(domain)}/cloudflare/destinations`),
	verifyForwardingDestination: (domain: string, email: string) => post<ForwardingDestination>(`/api/v1/domains/${encodeURIComponent(domain)}/cloudflare/destinations`, { email }),
	listRouting: (domain?: string) => get<{
		rules: RoutingRule[];
		inboxForwarding: InboxForwardingRule[];
		platform?: "cloudflare";
		forwardingVerification: boolean;
		smtpInboundPort: number;
		smtpOutboundAvailable: boolean;
		cloudflareSyncAvailable: boolean;
		inboundWebhookEnabled: boolean;
	}>("/api/v1/routing", domain ? { params: { domain } } : undefined),
	createRoutingRule: (data: RoutingRuleInput) => post<RoutingRule>("/api/v1/routing", data),
	updateRoutingRule: (id: string, data: RoutingRuleInput) => put<RoutingRule>(`/api/v1/routing/${encodeURIComponent(id)}`, data),
	deleteRoutingRule: (id: string) => del<void>(`/api/v1/routing/${encodeURIComponent(id)}`),
	syncCloudflareRouting: (domain: string) => post<CloudflareRoutingSyncResult[]>("/api/v1/routing/sync-cloudflare", { domain, confirmed: true }),
	listWebhooks: () => get<{ webhooks: MailWebhook[]; sources: string[]; allowedOrigins: string[] }>("/api/v1/webhooks"),
	createWebhook: (data: { recipient: string; endpoint: string }) => post<{ webhook: MailWebhook; secret: string }>("/api/v1/webhooks", data),
	updateWebhook: (id: string, enabled: boolean) => put<void>(`/api/v1/webhooks/${encodeURIComponent(id)}`, { enabled }),
	deleteWebhook: (id: string) => del<void>(`/api/v1/webhooks/${encodeURIComponent(id)}`),
	testWebhook: (id: string) => post<{ status: number | null }>(`/api/v1/webhooks/${encodeURIComponent(id)}/test`),
	// Config
	getConfig: () =>
		get<{ domains: string[]; emailAddresses: string[]; mcpAllowSend: boolean; smtpAvailable: boolean; platform?: "cloudflare" }>("/api/v1/config"),
	listWorkspaceEmails: (params: Record<string, string>, cursor?: string | null, signal?: AbortSignal) =>
		get<WorkspacePage>("/api/v1/workspace/emails", { params: { ...params, ...(cursor ? { cursor } : {}) }, signal }),

	// Mailboxes
	listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
	createMailbox: (data: { email: string; name: string; disposable: boolean }) =>
		post<Mailbox>("/api/v1/mailboxes", data),
	getMailbox: (mailboxId: string) =>
		get<Mailbox>(`/api/v1/mailboxes/${mailboxId}`),
	updateMailbox: (mailboxId: string, settings: unknown) =>
		put<Mailbox>(`/api/v1/mailboxes/${mailboxId}`, { settings }),
	updateMailboxForwarding: (mailboxId: string, forwarding: Omit<ForwardingSettings, "email">) =>
		put<ForwardingSettings>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/forwarding`, forwarding),
	deleteMailbox: (mailboxId: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}`),

	// Emails
	listEmails: (mailboxId: string, params: Record<string, string>, opts?: { signal?: AbortSignal }) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/emails`, { params, signal: opts?.signal }),
	sendEmail: (mailboxId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email),
	getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
		get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
	updateEmail: (mailboxId: string, id: string, data: unknown) =>
		put<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, data),
	deleteEmail: (mailboxId: string, id: string, trashOnly = false) =>
		del<void>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/emails/${encodeURIComponent(id)}${trashOnly ? "?trashOnly=true" : ""}`),
	recoverEmail: (mailboxId: string, id: string) =>
		post<{ folderId: string }>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/emails/${encodeURIComponent(id)}/recover`),
	moveEmail: (mailboxId: string, id: string, folderId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/move`, { folderId }),
	getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
		get<Email[]>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}`, { signal: opts?.signal }),
	markThreadRead: (mailboxId: string, threadId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/read`),
	getAttachment: (mailboxId: string, emailId: string, attachmentId: string) =>
		get<Blob>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`, { responseType: "blob" }),
	saveDraft: (
		mailboxId: string,
		draft: {
			to?: string;
			cc?: string;
			bcc?: string;
			subject?: string;
			body: string;
			in_reply_to?: string;
			thread_id?: string;
			draft_id?: string;
			attachments?: OutgoingAttachment[];
		},
	) => post<{ id: string; attachments?: Attachment[] }>(`/api/v1/mailboxes/${mailboxId}/drafts`, draft),
	replyToEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email),
	forwardEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email),

	// Folders
	listFolders: (mailboxId: string) =>
		get<Folder[]>(`/api/v1/mailboxes/${mailboxId}/folders`),
	createFolder: (mailboxId: string, name: string) =>
		post<Folder>(`/api/v1/mailboxes/${mailboxId}/folders`, { name }),
	updateFolder: (mailboxId: string, id: string, name: string) =>
		put<Folder>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`, { name }),
	deleteFolder: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`),

	// Search
	searchEmails: (mailboxId: string, params: Record<string, string>) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/search`, { params }),
};

export default api;
