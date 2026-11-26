export interface MailWebhook {
	id: string;
	recipient: string;
	origin: string;
	enabled: boolean;
	lastAttempt: { at: string; status: number | null; event: "mail.received" | "webhook.test" } | null;
}

export interface MailWebhookEvent {
	id: string;
	type: "mail.received" | "webhook.test";
	version: 1;
	occurredAt: string;
	recipient: string;
	mailboxId: string | null;
	messageId: string | null;
}
