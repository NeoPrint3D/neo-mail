import type { PushKeys, PushStore } from "./push";
import type { WebhookStore } from "./webhooks";
import type { AuthStore } from "./auth";
import type { Domains, DnsResolver } from "./domains";
import type { RoutingStore } from "./routing";
import type { MailboxStore } from "./mail-store";
import type { OutgoingAttachment } from "../shared/attachments";
import type { CloudflareMailStatus, ForwardingDestination } from "../shared/cloudflare-mail";

type Remote<T> = {
	[K in keyof T as T[K] extends (...args: infer _P) => unknown ? K : never]:
		T[K] extends (...args: infer P) => infer R ? (...args: P) => R | Promise<Awaited<R>> : never;
};

export type Mailbox = Pick<MailboxStore, Exclude<keyof MailboxStore, "db">>;
export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string;
	attachments?: OutgoingAttachment[];
	headers?: Record<string, string>;
}

export type MailboxMetadata = { name?: string; disposable?: string };

export interface BlobRepository {
	listMailboxes(): Promise<{ key: string; customMetadata?: MailboxMetadata }[]>;
	head(key: string): Promise<boolean>;
	get(key: string): Promise<{ body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer> | null; etag: string; json<T>(): Promise<T> } | null>;
	put(key: string, value: string | Uint8Array | ArrayBuffer, options?: {
		onlyIf?: { etagDoesNotMatch?: "*"; etagMatches?: string }; customMetadata?: MailboxMetadata;
	}): Promise<boolean>;
	delete(keys: string | string[]): Promise<void>;
}

export interface Env {
	AUTH: Remote<AuthStore>;
	PUSH_DEVICES?: Remote<PushStore>;
	PUSH_KEYS?: PushKeys;
	waitUntil?: (job: Promise<unknown>) => void;
	WEBHOOKS?: Remote<WebhookStore>;
	WEBHOOK_ALLOWED_ORIGINS?: string[];
	DOMAINS: Remote<Domains>;
	ROUTING: Remote<RoutingStore>;
	STORE: BlobRepository;
	MAILBOX: { get(address: string): Mailbox };
	DNS: DnsResolver;
	SEND_EMAIL?: (message: SendEmailParams) => Promise<{ messageId: string }>;
	CLOUDFLARE_MAIL?: {
		inspect(domain: string): Promise<CloudflareMailStatus>;
		enable(domain: string): Promise<CloudflareMailStatus>;
		enableSending(domain: string): Promise<CloudflareMailStatus>;
		destinations(domain: string): Promise<ForwardingDestination[]>;
		verifyDestination(domain: string, email: string): Promise<ForwardingDestination>;
	};
	platform?: "cloudflare";
	EMAIL_ADDRESSES?: string[];
	MCP_ALLOW_SEND?: string;
	MAIL_HOSTNAME: string;
	SMTP_TLS: boolean;
	SMTP_INBOUND_PORT: number;
	CLOUDFLARE_TOKEN?: string;
	INBOUND_WEBHOOK_SECRET?: string;
	APP_URL?: URL;
	requestIp?: string;
}
