// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { Dialog } from "@base-ui/react/dialog";
import { Banner, Input, Text } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { FloppyDiskIcon, PaperPlaneTiltIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { DeleteDialog } from "./AppDialog";
import { useComposeForm } from "~/hooks/useComposeForm";
import { useMailbox } from "~/queries/mailboxes";
import RichTextEditor from "./RichTextEditor";
import ComposeAttachments from "./ComposeAttachments";
import SearchSelect, { textChoices } from "./SearchSelect";

export default function ComposeEmail({ mailboxId, onClose }: { mailboxId: string; onClose: () => void }) {
	const { isSuccess } = useMailbox(mailboxId);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const [dirty, setDirty] = useState(false);

	const {
		fromAddress,
		setFromAddress,
		availableSenders,
		to,
		setTo,
		cc,
		setCc,
		bcc,
		setBcc,
		showCcBcc,
		setShowCcBcc,
		subject,
		setSubject,
		body,
		setBody,
		files,
		changeFiles,
		setError,
		error,
		isSavingDraft,
		isSending,
		formTitle,
		handleSaveDraft,
		handleSend,
	} = useComposeForm(mailboxId, true);

	function requestClose() {
		if (isSending || isSavingDraft) return;
		if (dirty) setConfirmDiscard(true);
		else onClose();
	}

	return (
		<Dialog.Root
			open
			onOpenChange={(open) => { if (!open && !confirmDiscard) requestClose(); }}
		>
			<Dialog.Portal>
			<Dialog.Backdrop className="compose-backdrop" />
			<Dialog.Popup className="compose-dialog">
				<header className="compose-header"><Dialog.Title className="text-lg font-semibold">{formTitle}</Dialog.Title>
					<button className="mail-icon-button" type="button" onClick={requestClose} disabled={isSending || isSavingDraft} aria-label="Close compose"><XIcon size={22} /></button>
				</header>
				<form onChange={() => setDirty(true)} onSubmit={(e) => handleSend(e, onClose)} className="flex min-h-0 flex-1 flex-col">
					<div className="compose-scroll space-y-4">
					{availableSenders.length > 1 ? (
						<SearchSelect label="Send from address" showLabel value={fromAddress} options={textChoices(availableSenders)}
							searchPlaceholder="Search sender addresses…" onChange={(value) => { setDirty(true); setFromAddress(value); }} />
					) : (
						<p className="text-sm text-kumo-subtle">From <strong className="text-kumo-strong">{mailboxId}</strong></p>
					)}
					{error && <Banner variant="error" text={error} />}
					<div className="flex items-center gap-2">
						<div className="flex-1">
							<Input
								label="To"
								type="text"
								placeholder="name@example.com"
								inputMode="email" autoCapitalize="none" autoCorrect="off"
								size="sm"
								value={to}
								onChange={(e) => setTo(e.target.value)}
								required
							/>
						</div>
						{!showCcBcc && (
							<button
								type="button"
								onClick={() => setShowCcBcc(true)}
								className="shrink-0 text-xs text-kumo-link hover:text-kumo-link-hover font-medium mt-5"
							>
								CC / BCC
							</button>
						)}
					</div>
					{showCcBcc && (
						<Input
							label="CC"
							type="text" inputMode="email" autoCapitalize="none" autoCorrect="off"
							size="sm"
							value={cc}
							onChange={(e) => setCc(e.target.value)}
							placeholder="Separate multiple addresses with commas"
						/>
					)}
					{showCcBcc && (
						<Input
							label="BCC"
							type="text" inputMode="email" autoCapitalize="none" autoCorrect="off"
							size="sm"
							value={bcc}
							onChange={(e) => setBcc(e.target.value)}
							placeholder="Separate multiple addresses with commas"
						/>
					)}
					<Input
						label="Subject"
						type="text"
						placeholder="Email subject"
						size="sm"
						value={subject}
						onChange={(e) => setSubject(e.target.value)}
						required
					/>
					<div>
						<Text size="sm" DANGEROUS_className="font-medium mb-1.5 block">
							Message
						</Text>
						<RichTextEditor value={body} onChange={(value) => { setDirty(true); setBody(value); }} />
					</div>
					<ComposeAttachments files={files} onChange={(value) => { setDirty(true); changeFiles(value); }} onError={setError} disabled={isSending || isSavingDraft} />
					</div>
					<div className="compose-footer">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={requestClose}
							disabled={isSending || isSavingDraft}
						>
							Discard
						</Button>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								loading={isSavingDraft}
								disabled={!isSuccess || isSending}
								icon={<FloppyDiskIcon size={14} />}
								onClick={async () => { if (await handleSaveDraft()) setDirty(false); }}
							>
								{isSavingDraft ? "Saving..." : "Save as Draft"}
							</Button>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								loading={isSending}
								disabled={!isSuccess || isSavingDraft || isSending}
								icon={<PaperPlaneTiltIcon size={14} />}
							>
								{isSending ? "Sending..." : "Send"}
							</Button>
						</div>
					</div>
				</form>
				{confirmDiscard && <DeleteDialog draft onClose={() => setConfirmDiscard(false)} onConfirm={onClose} />}
			</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
