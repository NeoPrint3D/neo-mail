import { Loader, useKumoToastManager } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { ArchiveIcon, ArrowsClockwiseIcon, ArrowUUpLeftIcon, EnvelopeOpenIcon, EnvelopeSimpleIcon, FunnelSimpleIcon, GlobeHemisphereWestIcon, PaperclipIcon, StarIcon, TrashIcon, TrayIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { formatListDate } from "shared/dates";
import { Folders } from "shared/folders";
import AppDialog, { DeleteDialog } from "~/components/AppDialog";
import MessageAvatar from "~/components/MessageAvatar";
import SwipeableMailRow from "~/components/SwipeableMailRow";
import { usePullToRefresh } from "~/hooks/usePullToRefresh";
import MailboxSelect from "~/components/MailboxSelect";
import TrashActions from "~/components/TrashActions";
import SearchSelect, { textChoices } from "~/components/SearchSelect";
import WorkspaceFrame, { PhoneComposeButton } from "~/components/WorkspaceFrame";
import { getSnippetText } from "~/lib/utils";
import { useConfig, useMailboxes } from "~/queries/mailboxes";
import api from "~/services/api";
import type { WorkspaceEmail } from "~/types";

const views = [
	{ id: "all", label: "Inbox" }, { id: "unread", label: "Unread" }, { id: "starred", label: "Starred" },
	{ id: "sent", label: "Sent" }, { id: "draft", label: "Drafts" }, { id: "archive", label: "Archive" }, { id: "spam", label: "Spam" }, { id: "trash", label: "Trash" },
];
const rowKey = (email: WorkspaceEmail) => `${email.mailboxId}/${email.id}`;
const actionLabels = { read: "Mark read", unread: "Mark unread", archive: "Archive", trash: "Move to trash" } as const;
type Action = keyof typeof actionLabels;

// Restore the actual scrolling list, not the document, when returning from a reader.
let returnScroll: { locationKey: string; top: number } | undefined;

export function meta() { return [{ title: "All inboxes · NeoMail" }]; }

function WorkspaceMail({ domain, mailboxId, view, q, hasMailboxes, heading, inbox }: {
	domain: string; mailboxId: string; view: string; q: string; hasMailboxes: boolean; heading: (refresh: ReactNode) => ReactNode; inbox: RefObject<HTMLDivElement | null>;
}) {
	const cache = useQueryClient();
	const { key: locationKey } = useLocation();
	const toast = useKumoToastManager();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<WorkspaceEmail[]>([]);
	const params = { ...(domain ? { domain } : {}), ...(mailboxId ? { mailboxId } : {}), ...(q ? { q } : {}),
		...(view === "unread" || view === "starred" ? { view, ...(view === "unread" && !q ? { folder: Folders.INBOX } : {}) }
			: view === "all" ? {} : { folder: view }) };
	const mail = useInfiniteQuery({
		queryKey: ["workspace-mail", params],
		queryFn: ({ pageParam, signal }) => api.listWorkspaceEmails(params, pageParam, signal),
		initialPageParam: null as string | null,
		refetchOnWindowFocus: true,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
	});
	const emails = [...new Map((mail.data?.pages.flatMap((page) => page.emails) || []).map((email) => [rowKey(email), email])).values()];
	const selectedEmails = emails.filter((email) => selected.has(rowKey(email)));
	const allSelected = !!emails.length && selectedEmails.length === emails.length;
	const trashSelected = selectedEmails.filter((row) => row.folder_id === Folders.TRASH).length;
	const trashOnlySelected = trashSelected > 0 && trashSelected === selectedEmails.length;
	const pull = usePullToRefresh(() => void mail.refetch(), busy || mail.isFetching || !!selectedEmails.length);
	const toggle = (key: string, checked: boolean) => setSelected((previous) => {
		const next = new Set(previous);
		if (checked) next.add(key); else next.delete(key);
		return next;
	});

	async function updateRows(rows: WorkspaceEmail[], operation: (row: WorkspaceEmail) => Promise<unknown>, label: string, clearSelection = true) {
		if (busy || !rows.length) return;
		setBusy(true);
		const failed: string[] = [];
		try {
			for (let i = 0; i < rows.length; i += 6) {
				const batch = rows.slice(i, i + 6);
				const results = await Promise.allSettled(batch.map(operation));
				results.forEach((result, index) => { if (result.status === "rejected") failed.push(rowKey(batch[index])); });
			}
			if (clearSelection) {
				const updated = new Set(rows.map(rowKey).filter((key) => !failed.includes(key)));
				setSelected((current) => new Set([...current].filter((key) => !updated.has(key))));
			}
			for (const mailboxId of new Set(rows.map((row) => row.mailboxId))) {
				void cache.invalidateQueries({ queryKey: ["emails", mailboxId] });
				void cache.invalidateQueries({ queryKey: ["folders", mailboxId] });
			}
			await cache.invalidateQueries({ queryKey: ["workspace-mail"] });
			if (failed.length) toast.add({ title: `${failed.length} of ${rows.length} messages could not be updated.`, variant: "error" });
			else toast.add({ title: label });
		} finally { setBusy(false); }
	}

	function apply(action: Action) {
		void updateRows(selectedEmails, (email) => action === "read" || action === "unread"
			? api.updateEmail(email.mailboxId, email.id, { read: action === "read" })
			: api.moveEmail(email.mailboxId, email.id, action), `${selectedEmails.length} messages updated`);
	}

	function recover(rows: WorkspaceEmail[]) {
		void updateRows(rows, (row) => api.recoverEmail(row.mailboxId, row.id), rows.length === 1 ? "Message recovered" : `${rows.length} messages recovered`);
	}

	async function confirmDelete() {
		if (busy || !pendingDelete.length) return;
		await updateRows(pendingDelete, (row) => api.deleteEmail(row.mailboxId, row.id, true),
			pendingDelete.length === 1 ? "Message permanently deleted" : `${pendingDelete.length} messages permanently deleted`);
		setPendingDelete([]);
	}

	const refresh = (className: string) => <Button className={className} variant="ghost" shape="square" size="sm" aria-label="Refresh messages" loading={mail.isRefetching} disabled={busy} onClick={() => mail.refetch()} icon={<ArrowsClockwiseIcon size={18} />} />;
	return <div className="mail-inbox phone-mail-scroll" ref={inbox} {...pull}>
		{heading(refresh("phone-refresh phone-heading-refresh"))}
		<section aria-label="Messages" className="mail-message-card">
		{pendingDelete.length > 0 && <DeleteDialog count={pendingDelete.length} busy={busy} onClose={() => setPendingDelete([])} onConfirm={() => void confirmDelete()} />}
		<div className={`mail-list-toolbar phone-list-toolbar${selectedEmails.length ? " has-selection" : ""}${trashOnlySelected ? " trash-selection-toolbar" : ""}`}>
			{emails.length > 0 && <label className="flex items-center gap-2 text-xs text-kumo-subtle">
				<input type="checkbox" className="workspace-check" checked={allSelected} disabled={busy}
					aria-label="Select all loaded messages" onChange={() => setSelected(allSelected ? new Set() : new Set(emails.map(rowKey)))} />
				{selectedEmails.length ? `${selectedEmails.length} selected` : `${emails.length} loaded`}
			</label>}
			{selectedEmails.length > 0 && !trashSelected && <button type="button" className="clear-mail-selection" aria-label="Clear selection" onClick={() => setSelected(new Set())}>Clear</button>}
			{selectedEmails.length > 0 && (trashOnlySelected
				? <TrashActions disabled={busy} onRecover={() => recover(selectedEmails)} onDelete={() => setPendingDelete(selectedEmails)} />
				: trashSelected > 0 ? <p className="text-xs text-kumo-subtle">Select Trash messages separately to recover or permanently delete them.</p>
				: <div className="flex flex-wrap gap-1">
					{(Object.entries(actionLabels) as [Action, string][]).map(([action, label]) =>
						<Button key={action} variant="secondary" size="xs" disabled={busy} onClick={() => apply(action)} icon={action === "archive" ? <ArchiveIcon size={14} /> : action === "read" ? <EnvelopeOpenIcon size={14} /> : undefined}>{label}</Button>)}
				</div>)}
			{!trashOnlySelected && refresh("ml-auto desktop-list-refresh")}
		</div>
		{mail.fetchStatus === "paused" && !emails.length ? <p className="px-5 py-12 text-center text-sm text-kumo-subtle" role="status">Reconnect to load this inbox.</p>
			: mail.isPending ? <div role="status" className="grid place-items-center py-20"><Loader size="lg" /><span className="sr-only">Loading messages</span></div>
			: mail.isError && !emails.length ? <div role="alert" className="space-y-3 px-6 py-12 text-center"><p>{mail.error.message}</p><Button variant="secondary" onClick={() => mail.refetch()}>Try again</Button></div>
			: !emails.length ? <div className="px-5 py-16 text-center">
				<div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-kumo-fill text-kumo-subtle">{view === Folders.TRASH ? <TrashIcon size={26} /> : <TrayIcon size={26} />}</div>
				<h2 className="text-base font-semibold">{!hasMailboxes ? "Create your first mailbox" : q ? "No messages match your search" : view === Folders.TRASH ? "Trash is empty" : "No messages in this view"}</h2>
				<p className="mt-1 text-sm text-kumo-subtle">{!hasMailboxes ? "Choose a domain and add an address to start receiving mail." : q ? "Try fewer terms or a different domain." : view === Folders.TRASH ? "Messages moved to Trash will appear here until you recover or permanently delete them." : "Try another view or switch to all domains."}</p>
				{!hasMailboxes && <Link className="mt-4 inline-block text-sm font-medium text-kumo-link" to="/mailboxes">Set up mailboxes →</Link>}
			</div> : <ul className="divide-y divide-kumo-line">
				{emails.map((email) => {
					const key = rowKey(email);
					const subject = email.subject || "(No subject)";
					const path = `/mailbox/${encodeURIComponent(email.mailboxId)}/emails/${encodeURIComponent(email.folder_id || Folders.INBOX)}?${new URLSearchParams({ message: email.id })}`;
					const inTrash = email.folder_id === Folders.TRASH;
					const isOutgoing = email.folder_id === Folders.SENT || email.folder_id === Folders.DRAFT;
					const unread = !email.read && !isOutgoing;
					const sender = isOutgoing ? `To: ${email.recipient || "No recipient"}` : email.sender || "Unknown sender";
					const snippet = getSnippetText(email.snippet, 180);
					return <SwipeableMailRow
						key={key}
						disabled={busy}
						className={`mail-message-row phone-list-row ${unread ? "unread" : ""} ${selected.has(key) ? "selected" : ""}`}
						leftAction={inTrash
							? { label: "Recover", icon: <ArrowUUpLeftIcon size={18} />, tone: "accent", onTrigger: () => recover([email]) }
							: !isOutgoing
								? { label: unread ? "Read" : "Unread", icon: unread ? <EnvelopeOpenIcon size={18} /> : <EnvelopeSimpleIcon size={18} />, tone: "accent", onTrigger: () => void updateRows([email], (row) => api.updateEmail(row.mailboxId, row.id, { read: unread }), unread ? "Marked read" : "Marked unread", false) }
								: email.folder_id !== Folders.ARCHIVE
									? { label: "Archive", icon: <ArchiveIcon size={18} />, tone: "accent", onTrigger: () => void updateRows([email], (row) => api.moveEmail(row.mailboxId, row.id, Folders.ARCHIVE), "Archived", false) }
									: undefined}
						rightAction={inTrash
							? { label: "Delete", icon: <TrashIcon size={18} />, tone: "danger", onTrigger: () => setPendingDelete([email]) }
							: { label: "Trash", icon: <TrashIcon size={18} />, tone: "danger", onTrigger: () => void updateRows([email], (row) => api.moveEmail(row.mailboxId, row.id, Folders.TRASH), "Moved to Trash", false) }}>
						<MessageAvatar sender={sender} label={`Select ${subject}`} checked={selected.has(key)} disabled={busy} onToggle={() => toggle(key, !selected.has(key))} />
						<input type="checkbox" className="workspace-check" checked={selected.has(key)} disabled={busy} aria-label={`Select ${subject} in ${email.mailboxId}`}
							onChange={(event) => toggle(key, event.target.checked)} />
						{!inTrash && <button type="button" className={`mail-icon-button mail-star ${email.starred ? "starred" : ""}`} disabled={busy} aria-label={email.starred ? `Unstar ${subject}` : `Star ${subject}`}
							aria-pressed={email.starred} onClick={() => void updateRows([email], (row) => api.updateEmail(row.mailboxId, row.id, { starred: !row.starred }), email.starred ? "Star removed" : "Message starred", false)}>
							<StarIcon size={17} weight={email.starred ? "fill" : "regular"} /></button>}
						<Link to={path} state={{ mailReader: "workspace" }} preventScrollReset onClick={(event) => {
							if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) returnScroll = { locationKey, top: event.currentTarget.closest(".mail-inbox")?.scrollTop ?? 0 };
						}} className="mail-message-link" aria-label={`${unread ? "Unread: " : ""}${subject} — ${sender} in ${email.mailboxId}`}>
							<span className="mail-sender" title={sender}>{sender}</span>
							<div className="mail-subject"><span>{subject}</span>{snippet && <span className="mail-snippet"><span className="desktop-snippet-separator"> — </span>{snippet}</span>}</div>
							<div className="mail-message-meta">
								{email.has_attachment && <PaperclipIcon className="shrink-0 text-kumo-subtle" size={15} aria-label="Attachment" />}
								<span className="mail-label truncate" title={email.mailboxId}>{email.mailboxId}</span>
								<time dateTime={email.date}>{email.date && formatListDate(email.date)}</time>
							</div>
						</Link>
						{inTrash && <TrashActions compact disabled={busy} onRecover={() => recover([email])} onDelete={() => setPendingDelete([email])} />}
					</SwipeableMailRow>;
				})}
			</ul>}
		{emails.length > 0 && (mail.hasNextPage || mail.isError) && <div className="border-t border-kumo-line p-3 text-center">
			{mail.isError && <p role="alert" className="mb-2 text-sm text-kumo-subtle">Could not refresh or load the next page.</p>}
			{mail.hasNextPage && <Button variant="secondary" disabled={busy || mail.isFetching} loading={mail.isFetchingNextPage} onClick={() => mail.fetchNextPage()}>Load more</Button>}
		</div>}
		</section>
	</div>;
}

export default function WorkspaceRoute() {
	const [params, setParams] = useSearchParams();
	const navigate = useNavigate();
	const { key } = useLocation();
	const inbox = useRef<HTMLDivElement>(null);
	const [filterOpen, setFilterOpen] = useState(false);
	useLayoutEffect(() => {
		if (returnScroll?.locationKey !== key || !inbox.current) return;
		inbox.current.scrollTop = returnScroll.top;
		returnScroll = undefined;
	}, [key]);
	const domain = params.get("domain") || "";
	const mailboxId = params.get("mailbox") || "";
	const view = views.find((item) => item.id === params.get("view"))?.id || "all";
	const q = params.get("q") || "";
	const { data: mailboxes = [], isSuccess: loaded } = useMailboxes();
	const { data: config } = useConfig();
	const domains = [...new Set([...(config?.domains ?? []), ...mailboxes.map((mailbox) => mailbox.domain), ...(domain ? [domain] : [])])].sort();
	const domainMailboxes = mailboxes.filter((mailbox) => !mailbox.disposable && (!domain || mailbox.domain === domain));
	const title = q ? "Search results" : view === "all" ? "Inbox" : views.find((item) => item.id === view)?.label || "Inbox";

	function change(key: string, value: string) {
		setParams((current) => {
			const next = new URLSearchParams(current);
			if (value) next.set(key, value); else next.delete(key);
			if (key === "domain") next.delete("mailbox");
			return next;
		});
	}
	function filters(labels: boolean) {
		return <>
			<div className="mail-domain-field">
				<SearchSelect options={[{ value: "", label: "All domains" }, ...textChoices(domains)]} value={domain} label={labels ? "Domain" : "Filter by domain"} showLabel={labels}
					searchPlaceholder="Search domains…" icon={<GlobeHemisphereWestIcon size={18} />} onChange={(value) => change("domain", value)} />
			</div>
			<div className="mail-mailbox-field">
				<MailboxSelect mailboxes={domainMailboxes} value={mailboxId} label={labels ? "Mailbox" : "Filter by mailbox"} showLabel={labels} allLabel="All mailboxes" allowCreate disabled={!loaded}
					preferredDomain={domain} onChange={(value) => change("mailbox", value)} onCreated={(mailbox) => {
						setFilterOpen(false);
						if (mailbox.disposable) { navigate(`/mailbox/${encodeURIComponent(mailbox.id)}/emails/inbox`); return; }
						setParams((current) => {
							const next = new URLSearchParams(current);
							if (domain && domain !== mailbox.domain) next.set("domain", mailbox.domain);
							next.set("mailbox", mailbox.id);
							return next;
						});
					}} />
			</div>
		</>;
	}
	return <WorkspaceFrame>
		<WorkspaceMail key={JSON.stringify([domain, mailboxId, view, q])} domain={domain} mailboxId={mailboxId} view={view} q={q} inbox={inbox} hasMailboxes={!loaded || mailboxes.length > 0}
			heading={(refresh) => <header className="mail-inbox-heading phone-inbox-heading">
				<div className="min-w-0"><h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
					<p className="mt-1 truncate text-xs text-kumo-subtle">{q ? `Matching “${q}”` : mailboxId || domain || "All inboxes"}</p></div>
				<div className="mail-inbox-filters flex min-w-0 flex-wrap items-center gap-2">{filters(false)}</div>
				<div className="phone-inbox-tools">
					<button type="button" className="phone-filter-button" onClick={() => setFilterOpen(true)} aria-haspopup="dialog" aria-label={domain || mailboxId ? "Filters active" : "Filters"}>
						<FunnelSimpleIcon size={20} weight={domain || mailboxId ? "fill" : "regular"} />Filters
					</button>
					{refresh}
					<PhoneComposeButton />
				</div>
			</header>} />
		{filterOpen && <AppDialog title="Filter mail" description="Narrow this view by domain or by mailbox." icon={<FunnelSimpleIcon size={23} />} onClose={() => setFilterOpen(false)}
			actions={<button className="mail-button primary" type="button" onClick={() => setFilterOpen(false)}>Done</button>}>
			<div className="space-y-3">{filters(true)}</div>
		</AppDialog>}
	</WorkspaceFrame>;
}
