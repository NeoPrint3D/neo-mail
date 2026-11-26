import { Dialog } from "@base-ui/react/dialog";
import { TrashIcon, XIcon } from "@phosphor-icons/react";
import type { FormEventHandler, ReactNode, RefObject } from "react";

export default function AppDialog({ title, description, icon, children, actions, onClose, onSubmit, busy, wide, initialFocus, returnFocus }: {
	title: string;
	description: ReactNode;
	icon: ReactNode;
	children?: ReactNode;
	actions?: ReactNode;
	onClose: () => void;
	onSubmit?: FormEventHandler<HTMLFormElement>;
	busy?: boolean;
	wide?: boolean;
	initialFocus?: RefObject<HTMLElement | null>;
	returnFocus?: RefObject<HTMLElement | null>;
}) {
	const content = <>
		{children && <div className="app-dialog-body">{children}</div>}
		<footer className="app-dialog-footer">
			<Dialog.Close className="mail-button" disabled={busy}>{actions ? "Cancel" : "Close"}</Dialog.Close>
			{actions}
		</footer>
	</>;
	return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
		<Dialog.Portal>
			<Dialog.Backdrop className="app-dialog-backdrop" />
			<Dialog.Popup className={`app-dialog${wide ? " app-dialog-wide" : ""}`} finalFocus={returnFocus}
				initialFocus={(method) => initialFocus?.current && method !== "touch" ? initialFocus.current : true}>
				<header className="app-dialog-header">
					<div className="app-dialog-mark" aria-hidden="true">{icon}</div>
					<div className="min-w-0 flex-1">
						<Dialog.Title className="app-dialog-title">{title}</Dialog.Title>
						<Dialog.Description className="app-dialog-description">{description}</Dialog.Description>
					</div>
					<Dialog.Close className="mail-icon-button" aria-label="Close dialog" disabled={busy}><XIcon size={20} /></Dialog.Close>
				</header>
				{onSubmit ? <form className="app-dialog-form" onSubmit={(event) => {
					event.preventDefault(); event.stopPropagation(); onSubmit(event);
				}}>{content}</form> : content}
			</Dialog.Popup>
		</Dialog.Portal>
	</Dialog.Root>;
}

export function DeleteDialog({ draft, count = 1, busy, onClose, onConfirm }: { draft?: boolean; count?: number; busy?: boolean; onClose: () => void; onConfirm: () => void }) {
	return <AppDialog title={draft ? "Discard this draft?" : count > 1 ? `Permanently delete ${count} messages?` : "Permanently delete this message?"}
		description={draft ? "This draft will be removed from your mailbox." : count > 1 ? "These messages and their attachments will be removed. This can’t be undone." : "The message and its attachments will be removed. This can’t be undone."}
		icon={<TrashIcon size={24} weight="duotone" />} busy={busy} onClose={onClose}
		actions={<button type="button" className="mail-button danger" disabled={busy} onClick={onConfirm}>{busy ? "Removing…" : draft ? "Discard draft" : "Delete permanently"}</button>} />;
}
