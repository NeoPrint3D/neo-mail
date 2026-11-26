export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface OutgoingAttachment {
	filename: string;
	type: string;
	content: string;
	disposition: "attachment" | "inline";
	contentId?: string;
}
