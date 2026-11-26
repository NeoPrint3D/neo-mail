// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { Tooltip } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { useEffect, useRef, useState } from "react";
import {
	ArrowBendUpLeftIcon,
	ArrowBendUpRightIcon,
	ArrowLeftIcon,
	ChatCircleIcon,
	CodeIcon,
	DotsThreeIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FolderSimpleIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import AppDialog from "~/components/AppDialog";
import TrashActions from "~/components/TrashActions";
import type { Folder, Email } from "~/types";

interface EmailPanelToolbarProps {
	email: Email;
	mailboxId?: string;
	isDraftFolder: boolean;
	inTrash: boolean;
	trashBusy: boolean;
	onRecover: () => void;
	isSending: boolean;
	moveToFolders: Folder[];
	lastReceivedMessage?: Email;
	onBack: () => void;
	onSendDraft: () => void;
	onEditDraft: () => void;
	onReply: () => void;
	onReplyAll: () => void;
	onForward: () => void;
	onToggleStar: () => void;
	onToggleRead?: () => void;
	onMove: (folderId: string) => void;
	onViewSource: () => void;
	onDelete: () => void;
}

export default function EmailPanelToolbar({
	email,
	mailboxId,
	isDraftFolder,
	inTrash,
	trashBusy,
	onRecover,
	isSending,
	moveToFolders,
	onBack,
	onSendDraft,
	onEditDraft,
	onReply,
	onReplyAll,
	onForward,
	onToggleStar,
	onToggleRead,
	onMove,
	onViewSource,
	onDelete,
}: EmailPanelToolbarProps) {
	const [sheet, setSheet] = useState<"actions" | "folders" | null>(null);
	if (inTrash) return <div className="reader-trash-tools flex shrink-0 flex-wrap items-center gap-2 border-b border-kumo-line px-3 py-2 md:px-4">
		<Button variant="ghost" shape="square" size="sm" icon={<ArrowLeftIcon size={18} />} onClick={onBack} aria-label="Back to list" />
		<TrashActions disabled={trashBusy} onRecover={onRecover} onDelete={onDelete} />
	</div>;

	function run(action: () => void) { setSheet(null); action(); }

	return (<>
		<div className="mobile-reader-tools" role="group" aria-label="Message actions">
			<button type="button" className="reader-back" onClick={onBack} aria-label="Back to list"><ArrowLeftIcon size={21} />Back</button>
			{isDraftFolder ? <>
				<button className="mail-button" type="button" onClick={onEditDraft} disabled={isSending}>Edit</button>
				<button className="mail-button primary" type="button" onClick={onSendDraft} disabled={isSending}>{isSending ? "Sending…" : "Send"}</button>
			</> : <>
				<button className="mail-icon-button" type="button" onClick={onReply} aria-label="Reply"><ArrowBendUpLeftIcon size={21} /></button>
				<button className="mail-icon-button" type="button" onClick={onDelete} aria-label="Move to trash"><TrashIcon size={21} /></button>
			</>}
			<button className="mail-icon-button" type="button" onClick={() => setSheet("actions")} aria-label="More message actions" aria-haspopup="dialog"><DotsThreeIcon size={25} weight="bold" /></button>
		</div>
		{sheet && <AppDialog title={sheet === "folders" ? "Move to folder" : "Message actions"} description={email.subject || "(No subject)"}
			icon={sheet === "folders" ? <FolderSimpleIcon size={22} /> : <DotsThreeIcon size={24} weight="bold" />} onClose={() => setSheet(null)}>
			<div className="reader-action-list">
				{sheet === "folders" ? moveToFolders.map((folder) => <button key={folder.id} className="mail-nav-link" type="button" onClick={() => run(() => onMove(folder.id))}><FolderSimpleIcon size={19} />{folder.name}</button>) : <>
					{!isDraftFolder && <>
						<button className="mail-nav-link" type="button" onClick={() => run(onReplyAll)}><ChatCircleIcon size={19} />Reply all</button>
						<button className="mail-nav-link" type="button" onClick={() => run(onForward)}><ArrowBendUpRightIcon size={19} />Forward</button>
					</>}
					<button className="mail-nav-link" type="button" onClick={() => run(onToggleStar)}><StarIcon size={19} />{email.starred ? "Unstar" : "Star"}</button>
					{onToggleRead && <button className="mail-nav-link" type="button" onClick={() => run(onToggleRead)}><EnvelopeSimpleIcon size={19} />{email.read ? "Mark as unread" : "Mark as read"}</button>}
					{!!moveToFolders.length && <button className="mail-nav-link" type="button" onClick={() => setSheet("folders")}><FolderSimpleIcon size={19} />Move to folder</button>}
					<button className="mail-nav-link" type="button" onClick={() => run(onViewSource)}><CodeIcon size={19} />View source</button>
					{isDraftFolder && <button className="mail-nav-link" type="button" onClick={() => run(onDelete)}><TrashIcon size={19} />Discard draft</button>}
				</>}
			</div>
		</AppDialog>}
		<div className="desktop-reader-tools flex items-center gap-1 px-3 py-2 border-b border-kumo-line shrink-0 md:px-4">
			<Button
				variant="ghost"
				shape="square"
				size="sm"
				icon={<ArrowLeftIcon size={18} />}
				onClick={onBack}
				aria-label="Back to list"
				className="md:hidden shrink-0"
			/>

			{isDraftFolder ? (
				<>
					<Button
						variant="primary"
						size="sm"
						icon={<PaperPlaneTiltIcon size={16} />}
						onClick={onSendDraft}
						loading={isSending}
					>
						{isSending ? "Sending..." : "Send"}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						icon={<PencilSimpleIcon size={16} />}
						onClick={onEditDraft}
					>
						Edit
					</Button>
				</>
			) : (
				<>
					<Tooltip content="Reply" side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<ArrowBendUpLeftIcon size={18} />}
							onClick={onReply}
							aria-label="Reply"
						/>
					</Tooltip>
					<Tooltip content="Reply All" side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<ChatCircleIcon size={18} />}
							onClick={onReplyAll}
							aria-label="Reply All"
						/>
					</Tooltip>
					<Tooltip content="Forward" side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<ArrowBendUpRightIcon size={18} />}
							onClick={onForward}
							aria-label="Forward"
						/>
					</Tooltip>
				</>
			)}

			<div className="h-5 w-px bg-kumo-fill mx-0.5" />

			<Tooltip content={email.starred ? "Unstar" : "Star"} side="bottom" asChild>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={
						<StarIcon
							size={18}
							weight={email.starred ? "fill" : "regular"}
							className={email.starred ? "text-kumo-warning" : ""}
						/>
					}
					onClick={onToggleStar}
					aria-label={email.starred ? "Unstar" : "Star"}
				/>
			</Tooltip>

			{onToggleRead && <Tooltip content={email.read ? "Mark as unread" : "Mark as read"} side="bottom" asChild>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={email.read ? <EnvelopeSimpleIcon size={18} /> : <EnvelopeOpenIcon size={18} />}
					onClick={onToggleRead}
					aria-label={email.read ? "Mark as unread" : "Mark as read"}
				/>
			</Tooltip>}

			<MoveToFolderMenu folders={moveToFolders} onMove={onMove} />

			<div className="ml-auto flex items-center gap-0.5">
				<Tooltip content="View source" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<CodeIcon size={18} />}
						onClick={onViewSource}
						aria-label="View source"
					/>
				</Tooltip>
				<Tooltip content="Delete" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<TrashIcon size={18} />}
						onClick={onDelete}
						aria-label="Delete"
					/>
				</Tooltip>
				<Tooltip content="Close" side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<XIcon size={18} />}
						onClick={onBack}
						aria-label="Close"
						className="hidden md:inline-flex"
					/>
				</Tooltip>
			</div>
		</div>
	</>);
}

function MoveToFolderMenu({ folders, onMove }: { folders: Folder[]; onMove: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	return (
		<div ref={ref} className="relative">
			<Tooltip content="Move to folder" side="bottom" asChild>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={<FolderSimpleIcon size={18} />}
					onClick={() => setOpen((o) => !o)}
					aria-label="Move to folder"
				/>
			</Tooltip>
			{open && (
				<div className="absolute top-full left-0 z-50 mt-1 min-w-[160px] rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
					<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">Move to</div>
					<div className="h-px bg-kumo-line my-1" />
					{folders.map((f) => (
						<button
							key={f.id}
							type="button"
							className="w-full text-left px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors"
							onClick={() => { onMove(f.id); setOpen(false); }}
						>
							{f.name}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
