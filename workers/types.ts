// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.
import type { MailboxDO } from "./durableObject";
import type { WorkspaceDO } from "./workspace";

export interface Bindings {
	BUCKET: R2Bucket;
	MAILBOX: DurableObjectNamespace<MailboxDO>;
	WORKSPACE: DurableObjectNamespace<WorkspaceDO>;
	EMAIL?: SendEmail;
	APP_URL?: string;
	SETUP_CODE?: string;
	WEB_PUSH_VAPID?: string;
	CLOUDFLARE_TOKEN?: string;
	CLOUDFLARE_WORKER_NAME?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	DOMAINS?: string;
	EMAIL_ADDRESSES?: string | string[];
	MCP_ALLOW_SEND?: string;
}
