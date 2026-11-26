import type { OutgoingAttachment } from "shared/attachments";
import api from "~/services/api";
import type { Attachment } from "~/types";

export type ComposeAttachment = File | Attachment;
export const attachmentName = (attachment: ComposeAttachment) => "id" in attachment ? attachment.filename : attachment.name;

function encode(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error("Could not read an attachment"));
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.readAsDataURL(blob);
	});
}

export async function encodeComposeAttachments(mailboxId: string, draftId: string | undefined, attachments: ComposeAttachment[]): Promise<OutgoingAttachment[]> {
	const files: OutgoingAttachment[] = [];
	for (const attachment of attachments) {
		if ("id" in attachment && !draftId) throw new Error("Draft attachment source is missing");
		const blob = "id" in attachment ? await api.getAttachment(mailboxId, draftId!, attachment.id) : attachment;
		files.push({ filename: attachmentName(attachment), type: blob.type || "application/octet-stream", content: await encode(blob),
			disposition: "id" in attachment && attachment.disposition === "inline" ? "inline" : "attachment",
			contentId: "id" in attachment ? attachment.content_id || undefined : undefined });
	}
	return files;
}
