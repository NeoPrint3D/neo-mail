// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

/**
 * Open a registered mailbox and attach its repository to the request.
 */
import { createMiddleware } from "hono/factory";
import type { Mailbox, Env } from "../types";

export type MailboxContext = {
	Bindings: Env;
	Variables: {
		mailboxStub: Mailbox;
	};
};

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
	const rawId = c.req.param("mailboxId");
	if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);
	const mailboxId = rawId;

	// Verify mailbox exists
	const key = `mailboxes/${mailboxId}.json`;
	const obj = await c.env.STORE.head(key);
	if (!obj) {
		return c.json({ error: "Not found" }, 404);
	}

	c.set("mailboxStub", c.env.MAILBOX.get(mailboxId));

	await next();
});
