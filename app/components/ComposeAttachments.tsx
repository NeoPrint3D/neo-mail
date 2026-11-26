import { PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_COUNT } from "shared/attachments";
import { attachmentName, type ComposeAttachment } from "~/lib/compose-attachments";
import { formatBytes } from "~/lib/utils";

export default function ComposeAttachments({ files, onChange, onError, disabled }: {
	files: ComposeAttachment[]; onChange: (files: ComposeAttachment[]) => void; onError: (error: string | null) => void; disabled?: boolean;
}) {
	return <div className="space-y-2">
		{files.length > 0 && <ul aria-label="Attachments" className="flex flex-wrap gap-2">
			{files.map((file, index) => <li key={"id" in file ? file.id : `${file.name}/${index}`} className="flex max-w-full items-center gap-2 rounded-lg border border-kumo-line bg-kumo-recessed pl-2 text-xs">
				<PaperclipIcon className="shrink-0" /><span className="truncate" title={attachmentName(file)}>{attachmentName(file)}</span>
				<span className="shrink-0 text-kumo-subtle">{formatBytes(file.size)}</span>
				<button type="button" disabled={disabled} aria-label={`Remove ${attachmentName(file)}`} className="shrink-0 rounded-r-lg p-2 hover:bg-kumo-fill" onClick={() => onChange(files.filter((_, i) => i !== index))}><XIcon /></button>
			</li>)}
		</ul>}
		<label className="inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-kumo-tint focus-within:ring-2 focus-within:ring-kumo-ring">
			<PaperclipIcon size={16} /> Attach files
			<input type="file" multiple className="sr-only" disabled={disabled} onChange={(e) => {
				const added = Array.from(e.currentTarget.files || []);
				e.currentTarget.value = "";
				const next = [...files, ...added];
				if (next.length > MAX_ATTACHMENT_COUNT || next.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_BYTES) {
					onError("Attach up to 10 files, totaling 15 MiB or less."); return;
				}
				onError(null); onChange(next);
			}} />
		</label>
	</div>;
}
