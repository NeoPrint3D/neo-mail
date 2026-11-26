import { z } from "zod";
import { Folders } from "../../shared/folders";
import { parseSearchQuery } from "../../shared/search";
import { getMailboxStub, listMailboxes } from "./email-helpers";
import type { Env } from "../types";

const Cursor = z.object({ date: z.string().max(40), id: z.string().min(1).max(128), mailboxId: z.string().email().max(254) });
const cursorInput = z.string().max(1024).transform((value, ctx) => {
	try { return Cursor.parse(JSON.parse(atob(value))); } catch {
		ctx.addIssue({ code: "custom", message: "Invalid workspace cursor" });
		return z.NEVER;
	}
});

export const WorkspaceQuery = z.object({
	domain: z.string().trim().toLowerCase().max(253).optional(),
	mailboxId: z.string().trim().toLowerCase().email().max(254).optional(),
	folder: z.enum([Folders.INBOX, Folders.SENT, Folders.DRAFT, Folders.ARCHIVE, Folders.SPAM, Folders.TRASH]).optional(),
	view: z.enum(["unread", "starred"]).optional(),
	q: z.string().trim().max(500).default(""),
	limit: z.coerce.number().int().min(1).max(50).default(25),
	cursor: cursorInput.optional(),
});

const descending = (a: string, b: string) => a === b ? 0 : a > b ? -1 : 1;

export async function listWorkspaceMail(env: Env, options: z.output<typeof WorkspaceQuery>, allowed?: ReadonlySet<string>) {
	const { domain, mailboxId, folder, view, q, limit, cursor } = options;
	const filters = parseSearchQuery(q);
	filters.folder = folder === Folders.TRASH ? folder : filters.folder || folder || (!q && !view ? Folders.INBOX : undefined);
	if (view === "unread") filters.is_read = false;
	if (view === "starred") filters.is_starred = true;
	const mailboxes = (await listMailboxes(env.STORE)).filter((mailbox) =>
		!mailbox.disposable && (!allowed || allowed.has(mailbox.id)) && (!domain || mailbox.domain === domain) && (!mailboxId || mailbox.id === mailboxId));

	const readMailbox = async (mailbox: (typeof mailboxes)[number]) => {
		const rows = await getMailboxStub(env, mailbox.id).searchEmails({
			...filters,
			limit: limit + 1,
			before: cursor && { date: cursor.date, id: cursor.id, inclusive: mailbox.id < cursor.mailboxId },
		});
		return rows.map((row) => ({ ...row, mailboxId: mailbox.id, mailboxName: mailbox.name, domain: mailbox.domain }));
	};
	// Limit simultaneous RPCs and retained rows. A failed mailbox fails the page so
	// that a continuation never skips unseen results from an unavailable mailbox.
	let merged: Awaited<ReturnType<typeof readMailbox>> = [];
	for (let i = 0; i < mailboxes.length; i += 12) {
		const batch = await Promise.all(mailboxes.slice(i, i + 12).map(readMailbox));
		merged = merged.concat(...batch).sort((a, b) =>
			descending(a.date, b.date) || descending(a.id, b.id) || descending(a.mailboxId, b.mailboxId)).slice(0, limit + 1);
	}
	const emails = merged.slice(0, limit);
	const tail = emails.at(-1);
	const nextCursor = merged.length > limit && tail
		? btoa(JSON.stringify({ date: tail.date, id: tail.id, mailboxId: tail.mailboxId }))
		: null;
	return { emails, nextCursor, mailboxCount: mailboxes.length };
}
