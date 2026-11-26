import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useKumoToastManager } from "@cloudflare/kumo";
import { queryKeys } from "~/queries/keys";
import { useMailbox } from "~/queries/mailboxes";
import api from "~/services/api";
import type { Mailbox } from "~/types";
import ForwardingAddresses, { forwardingAddresses } from "./ForwardingAddresses";

export default function InboxForwardingForm({ mailboxId, initialTargets, busy, setBusy, cloudflare, onClose }: {
	mailboxId: string;
	initialTargets: string[];
	busy: boolean;
	setBusy: (value: boolean) => void;
	cloudflare: boolean;
	onClose: () => void;
}) {
	const mailbox = useMailbox(mailboxId || undefined);
	if (!mailboxId) return <div className="flex justify-end"><button type="button" className="mail-button" onClick={onClose}>Cancel</button></div>;
	if (!mailbox.data) return <>
		{mailbox.isError ? <p className="form-error" role="alert">{mailbox.error.message}</p> : <p role="status" className="text-sm text-kumo-subtle">Loading forwarding settings…</p>}
		<div className="flex justify-end gap-2">
			<button type="button" className="mail-button" onClick={onClose}>Cancel</button>
			{mailbox.isError && <button type="button" className="mail-button" onClick={() => void mailbox.refetch()}>Retry</button>}
		</div>
	</>;
	return <Editor key={mailboxId} mailbox={mailbox.data} initialTargets={initialTargets} busy={busy} setBusy={setBusy} cloudflare={cloudflare} onClose={onClose} />;
}

function Editor({ mailbox, initialTargets, busy, setBusy, cloudflare, onClose }: {
	mailbox: Mailbox;
	initialTargets: string[];
	busy: boolean;
	setBusy: (value: boolean) => void;
	cloudflare: boolean;
	onClose: () => void;
}) {
	const current = mailbox.settings?.forwarding;
	const [enabled, setEnabled] = useState(current?.enabled ?? true);
	const [destinations, setDestinations] = useState(() => forwardingAddresses(current
		? [...(current.targets ?? []), ...(current.email ? [current.email] : [])] : initialTargets));
	const [keepCopy, setKeepCopy] = useState(current?.keepCopy ?? true);
	const [error, setError] = useState("");
	const cache = useQueryClient();
	const toast = useKumoToastManager();

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) return;
		setError("");
		const targets = forwardingAddresses(destinations);
		if (enabled && !targets.length) { setError("Add at least one forwarding destination."); return; }
		setBusy(true);
		try {
			const forwarding = await api.updateMailboxForwarding(mailbox.id, { enabled, targets, keepCopy });
			const key = queryKeys.mailboxes.detail(mailbox.id);
			cache.setQueryData<Mailbox>(key, (current) => current && ({ ...current, settings: { ...current.settings, forwarding } }));
			void cache.invalidateQueries({ queryKey: key });
			void cache.invalidateQueries({ queryKey: ["routing"] });
			toast.add({ title: enabled ? "Inbox forwarding saved" : "Inbox forwarding turned off" });
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save inbox forwarding");
		} finally {
			setBusy(false);
		}
	}

	return <form id="inbox-forwarding-form" onSubmit={submit} className="space-y-4">
		<div className="space-y-3 rounded-xl border border-kumo-line bg-kumo-recessed p-4">
			<p className="break-words text-sm">Forward new mail sent to <strong>{mailbox.email}</strong>. Messages already in this inbox aren’t affected.</p>
			<label className="flex items-center gap-2 text-sm">
				<input type="checkbox" className="workspace-check" checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} />
				Forward incoming mail
			</label>
			<ForwardingAddresses label="Forwarding destinations" value={destinations} onChange={setDestinations} disabled={busy || !enabled} description="Add up to 10 addresses, or paste a list." />
			<label className="flex items-center gap-2 text-sm">
				<input type="checkbox" className="workspace-check" checked={!enabled || keepCopy} disabled={busy || !enabled} onChange={(event) => setKeepCopy(event.target.checked)} />
				Keep a copy in this Inbox
			</label>
			{cloudflare && <p className="text-xs text-kumo-subtle">Cloudflare must verify each destination before it can receive forwarded mail. Use “Verify forwarding destinations” on this page.</p>}
		</div>
		{error && <p role="alert" className="form-error">{error}</p>}
		<div className="flex justify-end gap-2">
			<button type="button" className="mail-button" onClick={onClose} disabled={busy}>Cancel</button>
			<button type="submit" className="mail-button primary" disabled={busy}>{busy ? "Saving…" : "Save forwarding"}</button>
		</div>
	</form>;
}
