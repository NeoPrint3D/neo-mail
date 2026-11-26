// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { Banner, Input } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { FloppyDiskIcon, PaperPlaneTiltIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";
import { DeleteDialog } from "./AppDialog";
import { useComposeForm } from "~/hooks/useComposeForm";
import RichTextEditor from "./RichTextEditor";
import ComposeAttachments from "./ComposeAttachments";
import SearchSelect, { textChoices } from "./SearchSelect";

export default function ComposePanel({ onSend }: { onSend?: () => void }) {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const [dirty, setDirty] = useState(false);
	const [confirmDiscard, setConfirmDiscard] = useState(false);

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
		closeCompose,
		closePanel,
	} = useComposeForm(mailboxId);

	const requestClose = () => { if (dirty) setConfirmDiscard(true); else closeCompose(); };
	return (
		<div className="flex flex-col h-full bg-kumo-base">
			<div className="compose-header">
				<h2 className="text-base font-semibold text-kumo-default">
					{formTitle}
				</h2>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<XIcon size={18} />}
						onClick={requestClose}
						disabled={isSending || isSavingDraft}
						aria-label="Close compose"
					/>
				</div>
			</div>

			<form
				onChange={() => setDirty(true)} onSubmit={(e) => handleSend(e, onSend ?? closePanel)}
				className="flex flex-col flex-1 min-h-0"
			>
				<div className="compose-scroll p-4 md:p-6 space-y-4">
					{error && <Banner variant="error" text={error} />}

					<div className="space-y-3">
						{availableSenders.length > 1 && (
							<div className="flex items-center gap-2">
								<div className="min-w-0 flex-1">
									<SearchSelect label="Send from address" showLabel value={fromAddress} options={textChoices(availableSenders)}
										searchPlaceholder="Search sender addresses…" onChange={(value) => { setDirty(true); setFromAddress(value); }} />
								</div>
							</div>
						)}
						<div className="flex items-center gap-2">
							<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
								To
							</label>
							<div className="flex-1 flex items-center gap-2 min-w-0">
								<Input
									type="text"
									placeholder="name@example.com"
									aria-label="To" inputMode="email" autoCapitalize="none" autoCorrect="off"
									size="sm"
									value={to}
									onChange={(e) => setTo(e.target.value)}
									required
								/>
								{!showCcBcc && (
									<button
										type="button"
										onClick={() => setShowCcBcc(true)}
										className="shrink-0 text-xs text-kumo-link hover:text-kumo-link-hover font-medium"
									>
										CC / BCC
									</button>
								)}
							</div>
						</div>

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
									CC
								</label>
								<div className="flex-1">
									<Input
										type="text"
										size="sm"
										aria-label="CC" inputMode="email" autoCapitalize="none" autoCorrect="off"
										value={cc}
										onChange={(e) => setCc(e.target.value)}
										placeholder="Separate multiple addresses with commas"
									/>
								</div>
							</div>
						)}

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
									BCC
								</label>
								<div className="flex-1">
									<Input
										type="text"
										size="sm"
										aria-label="BCC" inputMode="email" autoCapitalize="none" autoCorrect="off"
										value={bcc}
										onChange={(e) => setBcc(e.target.value)}
										placeholder="Separate multiple addresses with commas"
									/>
								</div>
							</div>
						)}

						<div className="flex items-center gap-2">
							<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
								Subject
							</label>
							<div className="flex-1">
								<Input
									type="text"
									placeholder="Email subject"
									size="sm"
									aria-label="Subject"
									value={subject}
									onChange={(e) => setSubject(e.target.value)}
									required
								/>
							</div>
						</div>
					</div>

					<div className="border border-kumo-line rounded-md overflow-hidden bg-kumo-base">
						<RichTextEditor
							value={body}
							onChange={(value) => { setDirty(true); setBody(value); }}
						/>
					</div>
					<ComposeAttachments files={files} onChange={(value) => { setDirty(true); changeFiles(value); }} onError={setError} disabled={isSending || isSavingDraft} />
				</div>

				{/* Footer actions */}
				<div className="compose-footer">
					<div className="flex w-full items-center justify-between gap-2">
						<Button type="button" variant="ghost" size="sm" onClick={requestClose} disabled={isSending || isSavingDraft}>
							Discard
						</Button>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								loading={isSavingDraft}
								disabled={isSending}
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
								disabled={isSavingDraft || isSending}
								icon={<PaperPlaneTiltIcon size={14} />}
							>
								{isSending ? "Sending..." : "Send"}
							</Button>
						</div>
					</div>
				</div>
			</form>
			{confirmDiscard && <DeleteDialog draft onClose={() => setConfirmDiscard(false)} onConfirm={closeCompose} />}
		</div>
	);
}
