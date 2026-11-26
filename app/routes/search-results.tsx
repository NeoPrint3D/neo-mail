// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { Badge, Loader, Pagination, Tooltip } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import MailboxSplitView from "~/components/MailboxSplitView";
import MessageAvatar from "~/components/MessageAvatar";
import { formatListDate, getSnippetText } from "~/lib/utils";
import { useUpdateEmail } from "~/queries/emails";
import { useSearchEmails, SEARCH_PAGE_SIZE } from "~/queries/search";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";
import type { Email } from "~/types";

function highlightTerms(text: string, query: string): React.ReactNode {
	if (!query || !text) return text;
	const freeText = query.replace(/\b(?:from|to|subject|in|is|has|before|after):"[^"]*"/gi, "").replace(/\b(?:from|to|subject|in|is|has|before|after):\S+/gi, "").trim();
	if (!freeText) return text;
	try {
		const escaped = freeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(`(${escaped})`, "gi");
		const parts = text.split(regex);
		if (parts.length === 1) return text;
		// Use case-insensitive string comparison instead of regex.test() with g flag,
		// which has stateful lastIndex causing alternating true/false results.
		const lowerEscaped = escaped.toLowerCase();
		return parts.map((part, i) => part.toLowerCase() === lowerEscaped ? <mark key={i} className="bg-kumo-warning-muted text-kumo-default rounded-sm px-0.5">{part}</mark> : part);
	} catch { return text; }
}

export default function SearchResultsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const { data: mailbox, isPending: mailboxPending } = useMailbox(mailboxId);
	const [searchParams, setSearchParams] = useSearchParams();
	const navigate = useNavigate();
	const { state } = useLocation();
	const linkedMessage = !mailbox?.disposable ? searchParams.get("message") : null;
	const { selectedEmailId, isComposing, selectEmail, closePanel } = useUIStore();
	const updateEmail = useUpdateEmail();
	const urlQuery = searchParams.get("q") || "";
	const [page, setPage] = useState(1);
	const searchKey = useMemo(
		() => `${mailboxId ?? ""}::${urlQuery}`,
		[mailboxId, urlQuery],
	);
	const prevSearchKeyRef = useRef(searchKey);
	const searchChanged = prevSearchKeyRef.current !== searchKey;
	const currentPage = searchChanged ? 1 : page;

	useEffect(() => {
		if (!searchChanged) {
			return;
		}

		prevSearchKeyRef.current = searchKey;
		setPage(1);
	}, [searchChanged, searchKey]);

	useEffect(() => {
		if (linkedMessage) selectEmail(linkedMessage);
		else closePanel();
	}, [linkedMessage, searchKey, selectEmail, closePanel]);

	function leaveMessage() {
		closePanel();
		if (!linkedMessage) return;
		if (state?.mailReader === "search") { void navigate(-1); return; }
		const next = new URLSearchParams(searchParams);
		next.delete("message");
		setSearchParams(next, { replace: true, preventScrollReset: true });
	}

	const { data: searchData, isLoading, fetchStatus, isError, refetch } = useSearchEmails(
		mailbox && !mailbox.disposable ? mailboxId : undefined,
		urlQuery,
		currentPage,
	);
	const results = searchData?.results ?? [];
	const totalCount = searchData?.totalCount ?? 0;
	const isPanelOpen = selectedEmailId !== null || isComposing;

	if (mailbox?.disposable) return <Navigate replace to={`/mailbox/${encodeURIComponent(mailbox.id)}/emails/inbox`} />;

	const handleRowClick = (email: Email) => {
		selectEmail(email.id);
		const next = new URLSearchParams(searchParams);
		next.set("message", email.id);
		setSearchParams(next, { state: { mailReader: linkedMessage ? state?.mailReader : "search" }, replace: !!linkedMessage, preventScrollReset: true });
		if (!email.read && mailboxId && email.folder_id !== "trash") updateEmail.mutate({ mailboxId, id: email.id, data: { read: true } });
	};
	const folderDisplayName = (name: string | null | undefined): string => { if (!name) return ""; const map: Record<string, string> = { inbox: "Inbox", sent: "Sent", draft: "Drafts", archive: "Archive", trash: "Trash" }; return map[name.toLowerCase()] || name; };

	return (
		<MailboxSplitView
			selectedEmailId={selectedEmailId ?? (isComposing ? null : linkedMessage)}
			isComposing={isComposing}
			onBack={leaveMessage}
		>
			<>
				<div className="flex items-center gap-2 px-4 py-3.5 border-b border-kumo-line shrink-0 md:px-5">
					<Tooltip content="Back to inbox" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ArrowLeftIcon size={18} />} onClick={() => navigate(`/mailbox/${mailboxId}/emails/inbox`)} aria-label="Back to inbox" /></Tooltip>
					<div className="min-w-0 flex-1"><h1 className="text-lg font-semibold text-kumo-default truncate">Search Results</h1>{!isLoading && <span className="text-sm text-kumo-subtle">{totalCount} result{totalCount !== 1 ? "s" : ""}{urlQuery ? ` for "${urlQuery}"` : ""}</span>}</div>
				</div>
				<div className="flex-1 overflow-y-auto">
					{fetchStatus === "paused" ? <p className="px-5 py-12 text-center text-sm text-kumo-subtle" role="status">Reconnect to search this mailbox.</p>
						: isError ? <div className="space-y-3 px-5 py-12 text-center" role="alert"><p>Search could not load.</p><button className="mail-button" type="button" onClick={() => void refetch()}>Try again</button></div>
						: isLoading || mailboxPending ? <div className="flex justify-center py-16"><Loader size="lg" /></div> : results.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
							<div className="mb-4"><MagnifyingGlassIcon size={48} weight="thin" className="text-kumo-subtle" /></div>
							<h3 className="text-base font-semibold text-kumo-default mb-1.5">No results found</h3>
							<p className="text-sm text-kumo-subtle max-w-xs">{urlQuery ? `Nothing matched "${urlQuery}". Try different keywords or check your spelling.` : "Enter a search term to find emails by subject, sender, or content."}</p>
							{urlQuery && <p className="text-xs text-kumo-subtle mt-3 max-w-sm">Tip: Use operators like <code className="bg-kumo-tint px-1 rounded">from:name</code>, <code className="bg-kumo-tint px-1 rounded">is:unread</code>, <code className="bg-kumo-tint px-1 rounded">has:attachment</code>, <code className="bg-kumo-tint px-1 rounded">before:2025-01-01</code></p>}
						</div>
					) : (
						<div>{results.map((email) => {
							const isSelected = selectedEmailId === email.id;
							const snippet = getSnippetText(email.snippet, 120);
							const folderName = (email as Email & { folder_name?: string }).folder_name;
							return (
								<div key={email.id} role="button" tabIndex={0} onClick={() => handleRowClick(email)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(email); } }} className={`phone-search-result group flex items-center gap-3 w-full text-left cursor-pointer transition-colors border-b border-kumo-line px-4 py-2.5 md:px-5 md:py-3 ${isPanelOpen ? "md:px-4 md:py-2.5" : ""} ${isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"}`}>
									<MessageAvatar sender={email.sender} />
									<div className="search-result-unread w-2.5 shrink-0 flex justify-center">{!email.read && <div className="h-2 w-2 rounded-full bg-kumo-brand" />}</div>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2"><span className={`truncate text-sm ${!email.read ? "font-semibold text-kumo-default" : "text-kumo-strong"}`}>{highlightTerms(email.sender.split("@")[0], urlQuery)}</span>{folderName && <Badge variant="outline">{folderDisplayName(folderName)}</Badge>}<span className="text-sm text-kumo-subtle shrink-0 ml-auto">{formatListDate(email.date)}</span></div>
										<div className={`truncate text-sm mt-0.5 ${!email.read ? "font-medium text-kumo-default" : "text-kumo-subtle"}`}>{highlightTerms(email.subject, urlQuery)}</div>
										{snippet && <div className="truncate text-xs text-kumo-subtle mt-0.5">{highlightTerms(snippet, urlQuery)}</div>}
									</div>
								</div>
							);
						})}</div>
					)}
				</div>
				{totalCount > SEARCH_PAGE_SIZE && <div className="flex justify-center py-3 border-t border-kumo-line shrink-0"><Pagination page={currentPage} setPage={setPage} perPage={SEARCH_PAGE_SIZE} totalCount={totalCount} /></div>}
			</>
		</MailboxSplitView>
	);
}
