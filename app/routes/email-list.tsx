// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { Pagination, Tooltip, useKumoToastManager } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { DeleteDialog } from "~/components/AppDialog";
import {
	ArchiveIcon,
	ArrowBendUpLeftIcon,
	ArrowsClockwiseIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FileIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TrashIcon,
	TrayIcon,
	WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { formatListDate } from "shared/dates";
import { Folders } from "shared/folders";
import MailboxSplitView from "~/components/MailboxSplitView";
import TrashActions from "~/components/TrashActions";
import { PhoneComposeButton } from "~/components/WorkspaceFrame";
import MessageAvatar from "~/components/MessageAvatar";
import { usePullToRefresh } from "~/hooks/usePullToRefresh";
import { useUIStore } from "~/hooks/useUIStore";
import { getSnippetText } from "~/lib/utils";
import {
	useEmail,
	useEmails,
	useMarkThreadRead,
	useMoveEmail,
	useUpdateEmail,
} from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

const FOLDER_EMPTY_STATES: Record<
	string,
	{
		icon: React.ReactNode;
		title: string;
		description: string;
		showCompose?: boolean;
	}
> = {
	[Folders.INBOX]: {
		icon: <TrayIcon size={44} weight="thin" className="text-kumo-subtle" />,
		title: "Your inbox is empty",
		description: "New emails will appear here when they arrive. Send an email to get the conversation started.",
		showCompose: true,
	},
	[Folders.SENT]: {
		icon: <PaperPlaneTiltIcon size={44} weight="thin" className="text-kumo-subtle" />,
		title: "No sent emails",
		description: "Emails you send will show up here.",
		showCompose: true,
	},
	[Folders.DRAFT]: {
		icon: <FileIcon size={44} weight="thin" className="text-kumo-subtle" />,
		title: "No drafts",
		description: "Emails you're still working on will be saved here.",
		showCompose: true,
	},
	[Folders.ARCHIVE]: {
		icon: <ArchiveIcon size={44} weight="thin" className="text-kumo-subtle" />,
		title: "Archive is empty",
		description: "Move emails here to keep your inbox clean without deleting them.",
	},
	[Folders.SPAM]: {
		icon: <WarningOctagonIcon size={44} weight="thin" className="text-kumo-subtle" />,
		title: "No spam",
		description: "Messages marked as spam will appear here.",
	},
	[Folders.TRASH]: {
		icon: <TrashIcon size={44} weight="thin" className="text-kumo-subtle" />,
		title: "Trash is empty",
		description: "Deleted emails will appear here. You can restore them or permanently delete them.",
	},
};

function EmailListSkeleton() {
	return (
		<div className="animate-pulse divide-y divide-kumo-line">
			{Array.from({ length: 8 }).map((_, i) => (
				<div key={i} className="flex items-center gap-3 px-4 py-3">
					<div className="h-4 w-4 rounded bg-kumo-fill" />
					<div className="h-4 w-4 rounded bg-kumo-fill" />
					<div className="h-3 w-28 rounded bg-kumo-fill" />
					<div className="h-3 flex-1 rounded bg-kumo-fill" />
					<div className="h-3 w-14 rounded bg-kumo-fill" />
				</div>
			))}
		</div>
	);
}

function FolderEmptyState({
	folder,
	onCompose,
}: {
	folder?: string;
	onCompose: () => void;
}) {
	const config = (folder && FOLDER_EMPTY_STATES[folder]) || {
		icon: <EnvelopeSimpleIcon size={44} weight="thin" className="text-kumo-subtle" />,
		title: "No emails",
		description: "This folder is empty.",
	};

	return (
		<div className="flex flex-col items-center justify-center px-6 py-24 text-center">
			<div className="mb-4">{config.icon}</div>
			<h3 className="mb-1.5 text-base font-semibold text-kumo-default">{config.title}</h3>
			<p className="mb-5 max-w-xs text-sm text-kumo-subtle">{config.description}</p>
			{"showCompose" in config && config.showCompose && (
				<Button variant="primary" size="sm" icon={<PencilSimpleIcon size={16} />} onClick={onCompose}>
					Compose
				</Button>
			)}
		</div>
	);
}

export default function EmailListRoute() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();
	const {
		selectedEmailId,
		isComposing,
		selectEmail,
		closePanel,
		startCompose,
	} = useUIStore();
	const [page, setPage] = useState(1);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [bulkBusy, setBulkBusy] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<Email[]>([]);
	const inTrash = folder === Folders.TRASH;
	const { data: mailbox } = useMailbox(mailboxId);
	const showUnread = !!mailbox && !mailbox.disposable;
	const [searchParams, setSearchParams] = useSearchParams();
	const linkedMessage = searchParams.get("message");
	const { state } = useLocation();
	const navigate = useNavigate();

	function leaveMessage() {
		closePanel();
		if (!linkedMessage) return;
		if (state?.mailReader === "workspace" || state?.mailReader === "folder") { void navigate(-1); return; }
		const next = new URLSearchParams(searchParams);
		next.delete("message");
		setSearchParams(next, { replace: true, preventScrollReset: true });
	}

	const toast = useKumoToastManager();
	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();
	const markThreadRead = useMarkThreadRead();
	const moveEmail = useMoveEmail();
	const { data: linkedEmail } = useEmail(mailboxId, linkedMessage || undefined);
	const lastOpenedLink = useRef("");

	const params = useMemo(
		() => ({
			folder: folder || "",
			page: String(page),
			limit: String(PAGE_SIZE),
		}),
		[folder, page],
	);

	const { data: emailData, isFetching: isRefreshing, fetchStatus, isError, refetch } = useEmails(mailboxId, params, { refetchInterval: 30_000 });
	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;

	const { data: folders = [] } = useFolders(mailboxId);
	const folderName = useMemo(() => {
		const found = folders.find((f) => f.id === folder);
		if (found) return found.name;
		return folder ? folder.charAt(0).toUpperCase() + folder.slice(1) : "Inbox";
	}, [folders, folder]);

	const isPanelOpen = selectedEmailId !== null || isComposing;
	const prevFolderRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		const folderChanged = prevFolderRef.current !== `${mailboxId}/${folder}`;
		prevFolderRef.current = `${mailboxId}/${folder}`;

		if (folderChanged) {
			closePanel();
			setPage(1);
			setSelected(new Set());
			setPendingDelete([]);
		}
	}, [mailboxId, folder, closePanel]);

	useEffect(() => {
		if (inTrash && emailData && !isRefreshing) setPage((current) => Math.min(current, Math.max(1, Math.ceil(totalCount / PAGE_SIZE))));
	}, [inTrash, emailData, isRefreshing, totalCount]);

	useEffect(() => {
		lastOpenedLink.current = "";
		if (linkedMessage && mailboxId) selectEmail(linkedMessage);
		else closePanel();
	}, [linkedMessage, mailboxId, folder, selectEmail, closePanel]);

	const { mutate: markLinkedRead } = updateEmail;
	useEffect(() => {
		if (!showUnread || !mailboxId || !linkedEmail || linkedEmail.id !== linkedMessage || selectedEmailId !== linkedMessage) return;
		const key = `${mailboxId}/${linkedEmail.id}`;
		if (lastOpenedLink.current === key) return;
		lastOpenedLink.current = key;
		if (!linkedEmail.read && linkedEmail.folder_id !== Folders.DRAFT && linkedEmail.folder_id !== Folders.TRASH) markLinkedRead({ mailboxId, id: linkedEmail.id, data: { read: true } });
	}, [showUnread, mailboxId, linkedEmail, linkedMessage, selectedEmailId, markLinkedRead]);

	const toggleStar = (e: React.MouseEvent, email: Email) => {
		e.preventDefault();
		e.stopPropagation();
		if (mailboxId) {
			updateEmail.mutate({
				mailboxId,
				id: email.id,
				data: { starred: !email.starred },
			});
		}
	};

	const handleDelete = (e: React.MouseEvent, emailId: string) => {
		e.preventDefault();
		e.stopPropagation();
		if (!mailboxId) return;
		const onSuccess = () => { if (selectedEmailId === emailId) closePanel(); };
		moveEmail.mutate({ mailboxId, id: emailId, folderId: Folders.TRASH }, { onSuccess });
	};

	const handleRefresh = () => {
		if (mailboxId) {
			queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
			queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
		}
	};

	const hasUnread = (email: Email): boolean => {
		if (!showUnread) return false;
		if (email.thread_unread_count !== undefined) return email.thread_unread_count > 0;
		return !email.read;
	};

	const handleRowClick = (email: Email) => {
		selectEmail(email.id);
		const next = new URLSearchParams(searchParams);
		next.set("message", email.id);
		setSearchParams(next, { state: { mailReader: linkedMessage ? state?.mailReader : "folder" }, replace: !!linkedMessage, preventScrollReset: true });
		if (!inTrash && mailboxId && hasUnread(email)) {
			if (email.thread_id && email.thread_count && email.thread_count > 1) {
				markThreadRead.mutate({ mailboxId, threadId: email.thread_id });
			} else {
				updateEmail.mutate({ mailboxId, id: email.id, data: { read: true } });
			}
		}
	};

	const formatParticipants = (email: Email): string => {
		if (email.participants) {
			const names = email.participants
				.split(",")
				.map((p) => p.trim().split("@")[0])
				.filter((name, idx, arr) => arr.indexOf(name) === idx);
			if (names.length <= 3) return names.join(", ");
			return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
		}
		return email.sender.split("@")[0];
	};

	const selectedRows = emails.filter((email) => selected.has(email.id));
	const pull = usePullToRefresh(handleRefresh, isRefreshing || bulkBusy || !!selectedRows.length);
	const toggleSelection = (id: string, checked: boolean) => setSelected((prev) => {
		const next = new Set(prev);
		if (checked) next.add(id); else next.delete(id);
		return next;
	});
	const allSelected = emails.length > 0 && selectedRows.length === emails.length;

	async function runBulk(operation: (email: Email) => Promise<unknown>, label: string, rows = selectedRows) {
		if (!mailboxId || bulkBusy || !rows.length) return;
		setBulkBusy(true);
		const updated = new Set<string>();
		try {
			for (let i = 0; i < rows.length; i += 6) {
				const batch = rows.slice(i, i + 6);
				const results = await Promise.allSettled(batch.map(operation));
				results.forEach((result, idx) => {
					if (result.status === "fulfilled") updated.add(batch[idx].id);
				});
			}
			setSelected((current) => new Set([...current].filter((id) => !updated.has(id))));
			if (selectedEmailId && updated.has(selectedEmailId)) closePanel();
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] }),
				queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) }),
				queryClient.invalidateQueries({ queryKey: ["workspace-mail"] }),
			]);
			const failed = rows.length - updated.size;
			if (failed) toast.add({ title: `${failed} of ${rows.length} messages could not be updated`, variant: "error" });
			else toast.add({ title: label });
		} finally {
			setBulkBusy(false);
		}
	}

	function recover(rows: Email[]) {
		if (!mailboxId) return;
		void runBulk((row) => api.recoverEmail(mailboxId, row.id), rows.length === 1 ? "Message recovered" : `${rows.length} messages recovered`, rows);
	}

	async function confirmDelete() {
		if (!mailboxId || bulkBusy || !pendingDelete.length) return;
		await runBulk((row) => api.deleteEmail(mailboxId, row.id, true),
			pendingDelete.length === 1 ? "Message permanently deleted" : `${pendingDelete.length} messages permanently deleted`, pendingDelete);
		setPendingDelete([]);
	}

	return (
		<MailboxSplitView selectedEmailId={selectedEmailId ?? (isComposing ? null : linkedMessage)} isComposing={isComposing} onBack={leaveMessage}>
			{inTrash && pendingDelete.length > 0 && <DeleteDialog count={pendingDelete.length} busy={bulkBusy} onClose={() => setPendingDelete([])} onConfirm={() => void confirmDelete()} />}
			<div className="mail-inbox-heading phone-inbox-heading border-b border-kumo-line">
				<div className="min-w-0">
					<h1 className="truncate text-lg font-semibold text-kumo-default">{folderName}</h1>
					<p className="truncate text-xs text-kumo-subtle">
						{totalCount > 0 ? `${totalCount} ${inTrash ? "message" : "conversation"}${totalCount !== 1 ? "s" : ""}` : mailboxId}
					</p>
				</div>
				<div className="flex shrink-0 items-center">
					<Tooltip content={isRefreshing ? "Refreshing..." : "Refresh"} side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<ArrowsClockwiseIcon size={18} className={isRefreshing ? "animate-spin" : ""} />}
							onClick={handleRefresh}
							disabled={isRefreshing}
							className="phone-refresh" aria-label="Refresh"
						/>
					</Tooltip>
					<PhoneComposeButton />
				</div>
			</div>

			{emails.length > 0 && (
				<div className={`mail-list-toolbar phone-folder-toolbar${selectedRows.length ? " has-selection" : ""}${inTrash && selectedRows.length ? " trash-selection-toolbar" : ""}`}>
					<label className="flex items-center gap-2 text-xs text-kumo-subtle">
						<input
							type="checkbox"
							className="workspace-check"
							checked={allSelected}
							disabled={bulkBusy}
							aria-label="Select all messages on this page"
							onChange={() => setSelected(allSelected ? new Set() : new Set(emails.map((email) => email.id)))}
						/>
						{selectedRows.length ? `${selectedRows.length} selected` : `${emails.length} shown`}
					</label>
					{selectedRows.length > 0 && !inTrash && <button type="button" className="clear-mail-selection" aria-label="Clear selection" onClick={() => setSelected(new Set())}>Clear</button>}
					{selectedRows.length > 0 && mailboxId && (inTrash
						? <TrashActions disabled={bulkBusy} onRecover={() => recover(selectedRows)} onDelete={() => setPendingDelete(selectedRows)} />
						: <div className="flex flex-wrap items-center gap-1">
							{showUnread && <><Button
								variant="secondary"
								size="xs"
								disabled={bulkBusy}
								icon={<EnvelopeOpenIcon size={14} />}
								onClick={() => void runBulk((e) => api.updateEmail(mailboxId, e.id, { read: true }), "Marked read")}
							>
								Read
							</Button>
							<Button
								variant="secondary"
								size="xs"
								disabled={bulkBusy}
								onClick={() => void runBulk((e) => api.updateEmail(mailboxId, e.id, { read: false }), "Marked unread")}
							>
								Unread
							</Button></>}
							{folder !== Folders.ARCHIVE && (
								<Button
									variant="secondary"
									size="xs"
									disabled={bulkBusy}
									icon={<ArchiveIcon size={14} />}
									onClick={() => void runBulk((e) => api.moveEmail(mailboxId, e.id, Folders.ARCHIVE), "Archived")}
								>
									Archive
								</Button>
							)}
							<Button variant="secondary" size="xs" disabled={bulkBusy} icon={<TrashIcon size={14} />}
								onClick={() => void runBulk((e) => api.moveEmail(mailboxId, e.id, Folders.TRASH), "Moved to trash")}>
								Trash
							</Button>
						</div>
					)}
				</div>
			)}

			<div className="flex-1 overflow-y-auto phone-mail-scroll" {...pull}>
				{fetchStatus === "paused" && !emails.length ? <p className="px-5 py-12 text-center text-sm text-kumo-subtle" role="status">Reconnect to load this folder.</p>
				: isError && !emails.length ? <div className="space-y-3 px-5 py-12 text-center" role="alert"><p>Could not load this folder.</p><button className="mail-button" type="button" onClick={() => void refetch()}>Try again</button></div>
				: isRefreshing && emails.length === 0 ? (
					<EmailListSkeleton />
				) : emails.length > 0 ? (
					<div className="divide-y divide-kumo-line">
						{emails.map((email) => {
							const isSelected = selectedEmailId === email.id;
							const isChecked = selected.has(email.id);
							const unread = hasUnread(email);
							const snippet = getSnippetText(email.snippet);
							return (
								<div
									key={email.id}
									className={`mail-message-row phone-folder-row phone-list-row group ${unread ? "unread" : ""} ${isSelected || isChecked ? "selected" : ""}`}
								>
									<MessageAvatar sender={email.sender} label={`Select ${email.subject || "(No subject)"}`} checked={isChecked} disabled={bulkBusy} onToggle={() => toggleSelection(email.id, !isChecked)} />
									<input
										type="checkbox"
										className="workspace-check"
										checked={isChecked}
										disabled={bulkBusy}
										aria-label={`Select ${email.subject || "(No subject)"}`}
										onClick={(e) => e.stopPropagation()}
										onChange={(e) => toggleSelection(email.id, e.target.checked)}
									/>

									{!inTrash && <button
										type="button"
										className={`mail-icon-button mail-star ${email.starred ? "starred" : ""}`}
										aria-label={email.starred ? "Unstar" : "Star"}
										aria-pressed={email.starred}
										onClick={(e) => toggleStar(e, email)}
									>
										<StarIcon size={16} weight={email.starred ? "fill" : "regular"} />
									</button>}

									<button type="button" data-mail-pull className="phone-folder-summary min-w-0 flex-1 py-1.5 pl-1 text-left" onClick={() => handleRowClick(email)}
										aria-label={`${unread ? "Unread: " : ""}${email.subject || "(No subject)"} — ${formatParticipants(email)}`}>
										<span className="flex items-center gap-2">
											{unread && <span role="img" aria-label="Unread" className="workspace-unread size-1.5 shrink-0 rounded-full" />}
											<span className={`truncate text-sm ${unread ? "font-bold text-kumo-default" : "text-kumo-strong"}`}>
												{formatParticipants(email)}
											</span>
											{(email.thread_count ?? 1) > 1 && (
												<span className="mail-label shrink-0">{email.thread_count}</span>
											)}
											{email.has_draft && (
												<span className="shrink-0 text-xs font-medium text-kumo-danger">Draft</span>
											)}
											{showUnread && email.needs_reply && !email.has_draft && (
												<Tooltip content="Needs reply" asChild>
													<span className="shrink-0 text-kumo-warning">
														<ArrowBendUpLeftIcon size={14} weight="bold" />
													</span>
												</Tooltip>
											)}
											<time className="ml-auto shrink-0 text-xs text-kumo-subtle" dateTime={email.date}>
												{formatListDate(email.date)}
											</time>
										</span>
										<span className={`phone-folder-subject mt-0.5 block truncate text-sm ${isPanelOpen ? "text-xs" : ""}`}>
											<span className={unread ? "font-semibold text-kumo-default" : "text-kumo-strong"}>
												{email.subject || "(No subject)"}
											</span>
											{snippet && <span className="mail-snippet font-normal"><span className="desktop-snippet-separator"> — </span>{snippet}</span>}
										</span>
									</button>

									{inTrash ? <TrashActions compact disabled={bulkBusy} onRecover={() => recover([email])} onDelete={() => setPendingDelete([email])} /> :
									<div className="desktop-row-actions hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
										{showUnread && <Tooltip content={email.read ? "Mark unread" : "Mark read"} asChild>
											<Button
												variant="ghost"
												shape="square"
												size="sm"
												icon={email.read ? <EnvelopeSimpleIcon size={14} /> : <EnvelopeOpenIcon size={14} />}
												onClick={(e) => {
													e.stopPropagation();
													if (mailboxId) {
														updateEmail.mutate({
															mailboxId,
															id: email.id,
															data: { read: !email.read },
														});
													}
												}}
												aria-label={email.read ? "Mark unread" : "Mark read"}
											/>
										</Tooltip>}
										<Tooltip content="Move to trash" asChild>
											<Button
												variant="ghost"
												shape="square"
												size="sm"
												icon={<TrashIcon size={14} />}
												onClick={(e) => handleDelete(e, email.id)}
												aria-label="Move to trash"
											/>
										</Tooltip>
									</div>}
								</div>
							);
						})}
					</div>
				) : (
					<FolderEmptyState folder={folder} onCompose={() => startCompose()} />
				)}
			</div>

			{totalCount > PAGE_SIZE && (
				<div className="flex shrink-0 justify-center border-t border-kumo-line py-3">
					<Pagination page={page} setPage={setPage} perPage={PAGE_SIZE} totalCount={totalCount} />
				</div>
			)}
		</MailboxSplitView>
	);
}
