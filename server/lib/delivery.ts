import type { SendEmailParams } from "../types";
import { storeAttachments } from "./attachments";
import type { Env } from "../types";
import type { SendEmailRequestSchema } from "./schemas";
import type { z } from "zod";

export async function deliverEmail(env: Env, id: string, payload: z.infer<typeof SendEmailRequestSchema>, headers?: SendEmailParams["headers"]) {
	const { to, cc, bcc, from, subject, html, text, attachments } = payload;
	const stored = await storeAttachments(env.STORE, id, attachments);
	try {
		if (!env.SEND_EMAIL) throw new Error("Outbound email is not configured");
		const receipt = await env.SEND_EMAIL({
			to, cc, bcc, from, subject, html, text, headers,
			attachments: attachments?.map((att) => ({ ...att, disposition: att.disposition || "attachment" })),
		});
		return { stored, providerMessageId: receipt.messageId?.trim().replace(/^<|>$/g, "") };
	} catch (error) {
		console.error("Email provider did not confirm acceptance", error);
		if (stored.length) {
			await env.STORE.delete(stored.map((att) => `attachments/${id}/${att.id}/${att.filename}`))
				.catch((cleanup) => console.error("Could not clean up attachments after send failure", cleanup));
		}
		return null;
	}
}
