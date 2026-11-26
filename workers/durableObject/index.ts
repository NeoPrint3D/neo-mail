// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file.
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { DurableObject } from "cloudflare:workers";
import { MailboxStore } from "../../server/mail-store";
import { storageAdapter } from "../sqlite";
import type { Bindings } from "../types";

export class MailboxDO extends DurableObject<Bindings> {
	private readonly mailbox: MailboxStore;

	constructor(ctx: DurableObjectState, env: Bindings) {
		super(ctx, env);
		this.mailbox = new MailboxStore(storageAdapter(ctx.storage));
	}

	getEmails(...args: Parameters<MailboxStore["getEmails"]>) { return this.mailbox.getEmails(...args); }
	countEmails(...args: Parameters<MailboxStore["countEmails"]>) { return this.mailbox.countEmails(...args); }
	getThreadedEmails(...args: Parameters<MailboxStore["getThreadedEmails"]>) { return this.mailbox.getThreadedEmails(...args); }
	countThreadedEmails(...args: Parameters<MailboxStore["countThreadedEmails"]>) { return this.mailbox.countThreadedEmails(...args); }
	getEmail(...args: Parameters<MailboxStore["getEmail"]>) { return this.mailbox.getEmail(...args); }
	getThreadEmails(...args: Parameters<MailboxStore["getThreadEmails"]>) { return this.mailbox.getThreadEmails(...args); }
	updateEmail(...args: Parameters<MailboxStore["updateEmail"]>) { return this.mailbox.updateEmail(...args); }
	updateDraft(...args: Parameters<MailboxStore["updateDraft"]>) { return this.mailbox.updateDraft(...args); }
	markThreadRead(...args: Parameters<MailboxStore["markThreadRead"]>) { return this.mailbox.markThreadRead(...args); }
	deleteEmail(...args: Parameters<MailboxStore["deleteEmail"]>) { return this.mailbox.deleteEmail(...args); }
	getAttachment(...args: Parameters<MailboxStore["getAttachment"]>) { return this.mailbox.getAttachment(...args); }
	getFolders(...args: Parameters<MailboxStore["getFolders"]>) { return this.mailbox.getFolders(...args); }
	createFolder(...args: Parameters<MailboxStore["createFolder"]>) { return this.mailbox.createFolder(...args); }
	updateFolder(...args: Parameters<MailboxStore["updateFolder"]>) { return this.mailbox.updateFolder(...args); }
	deleteFolder(...args: Parameters<MailboxStore["deleteFolder"]>) { return this.mailbox.deleteFolder(...args); }
	moveEmail(...args: Parameters<MailboxStore["moveEmail"]>) { return this.mailbox.moveEmail(...args); }
	recoverEmail(...args: Parameters<MailboxStore["recoverEmail"]>) { return this.mailbox.recoverEmail(...args); }
	searchEmails(...args: Parameters<MailboxStore["searchEmails"]>) { return this.mailbox.searchEmails(...args); }
	countSearchResults(...args: Parameters<MailboxStore["countSearchResults"]>) { return this.mailbox.countSearchResults(...args); }
	findThreadByMessageIds(...args: Parameters<MailboxStore["findThreadByMessageIds"]>) { return this.mailbox.findThreadByMessageIds(...args); }
	findThreadBySubject(...args: Parameters<MailboxStore["findThreadBySubject"]>) { return this.mailbox.findThreadBySubject(...args); }
	checkSendRateLimit(...args: Parameters<MailboxStore["checkSendRateLimit"]>) { return this.mailbox.checkSendRateLimit(...args); }
	createEmail(...args: Parameters<MailboxStore["createEmail"]>) { return this.mailbox.createEmail(...args); }
}
