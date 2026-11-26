import { Dialog, Input, useKumoToastManager } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { FolderIcon } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { Folders } from "shared/folders";
import { useCreateFolder, useDeleteFolder, useFolders, useUpdateFolder } from "~/queries/folders";
import type { Folder } from "~/types";

type Action = { type: "add" } | { type: "rename" | "remove"; folder: Folder };

export default function FolderSettings({ mailboxId }: { mailboxId: string }) {
	const folders = useFolders(mailboxId);
	const create = useCreateFolder();
	const rename = useUpdateFolder();
	const remove = useDeleteFolder();
	const toast = useKumoToastManager();
	const [action, setAction] = useState<Action | null>(null);
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const busy = create.isPending || rename.isPending || remove.isPending;
	const custom = folders.data?.filter((folder) => !(Object.values(Folders) as string[]).includes(folder.id)) || [];

	function edit(next: Action) { setAction(next); setError(""); setName(next.type === "rename" ? next.folder.name : ""); }
	async function submit(event: FormEvent) {
		event.preventDefault(); if (!action || busy) return;
		try {
			if (action.type === "remove") await remove.mutateAsync({ mailboxId, id: action.folder.id });
			else if (action.type === "rename") await rename.mutateAsync({ mailboxId, id: action.folder.id, name: name.trim() });
			else await create.mutateAsync({ mailboxId, name: name.trim() });
			toast.add({ title: action.type === "remove" ? "Folder removed" : "Folder saved" }); setAction(null);
		} catch (err) { setError(err instanceof Error ? err.message : "Could not update folder"); }
	}
	return <section className="mt-6 overflow-hidden rounded-xl border border-kumo-line bg-kumo-base" aria-label="Custom folders">
		<div className="flex flex-wrap items-center justify-between gap-2 p-5"><h2 className="font-semibold">Custom folders</h2><Button variant="secondary" size="sm" onClick={() => edit({ type: "add" })}>New folder</Button></div>
		{custom.length ? <ul className="divide-y divide-kumo-line border-t border-kumo-line">{custom.map((folder) => <li key={folder.id} className="flex flex-wrap items-center gap-2 px-5 py-2">
			<FolderIcon size={16} className="shrink-0" /><span className="min-w-20 flex-1 break-words text-sm">{folder.name}</span>
			<Button variant="ghost" size="sm" aria-label={`Rename ${folder.name}`} onClick={() => edit({ type: "rename", folder })}>Rename</Button>
			<Button variant="ghost" size="sm" aria-label={`Remove ${folder.name}`} onClick={() => edit({ type: "remove", folder })}>Remove</Button>
		</li>)}</ul> : <p className="border-t border-kumo-line px-5 py-3 text-sm text-kumo-subtle">{folders.isPending ? "Loading folders…" : folders.isError ? "Could not load folders." : "No custom folders yet."}</p>}
		<Dialog.Root open={!!action} onOpenChange={(open) => { if (!open && !busy) setAction(null); }}>
			<Dialog className="settings-dialog space-y-3 p-6" size="sm">
				<Dialog.Title className="font-semibold">{action?.type === "remove" ? "Remove folder?" : action?.type === "rename" ? "Rename folder" : "New folder"}</Dialog.Title>
				<form onSubmit={submit} className="space-y-4">
					{error && <p role="alert" className="text-sm">{error}</p>}
					{action?.type === "remove" ? <Dialog.Description className="text-sm text-kumo-subtle">Messages in <strong>{action.folder.name}</strong> will move back to Inbox.</Dialog.Description>
						: <Input label="Folder name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} required />}
					<div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => setAction(null)}>Cancel</Button>
						<Button type="submit" variant={action?.type === "remove" ? "destructive" : "primary"} loading={busy} disabled={action?.type !== "remove" && !name.trim()}>{action?.type === "remove" ? "Remove folder" : "Save folder"}</Button></div>
				</form>
			</Dialog>
		</Dialog.Root>
	</section>;
}
