// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { lazy, Suspense, type ReactNode } from "react";

const ComposePanel = lazy(() => import("~/components/ComposePanel"));
const EmailPanel = lazy(() => import("~/components/EmailPanel"));

interface MailboxSplitViewProps {
	selectedEmailId: string | null;
	isComposing: boolean;
	children: ReactNode;
	onBack?: () => void;
}

export default function MailboxSplitView({
	selectedEmailId,
	isComposing,
	children,
	onBack,
}: MailboxSplitViewProps) {
	const isPanelOpen = selectedEmailId !== null || isComposing;

	return (
		<div className={`flex h-full ${isPanelOpen ? "mail-detail-open" : ""}`}>
			<div
				className={`flex flex-col min-w-0 shrink-0 ${
					isPanelOpen
						? "mail-list-pane hidden md:flex md:w-[380px] md:border-r md:border-kumo-line"
						: "w-full"
				}`}
			>
				{children}
			</div>
			{isPanelOpen && (
				<div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full md:w-auto">
					<Suspense fallback={<div className="p-4 text-sm text-kumo-subtle" role="status">{onBack && <button className="mail-button mr-3" type="button" onClick={onBack}>Back</button>}{isComposing ? "Opening composer…" : "Opening message…"}</div>}>
						{isComposing ? <ComposePanel onSend={onBack} /> : selectedEmailId && <EmailPanel key={selectedEmailId} emailId={selectedEmailId} onBack={onBack} />}
					</Suspense>
				</div>
			)}
		</div>
	);
}
