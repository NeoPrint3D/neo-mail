// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

/**
 * Shared types and Zod schemas for email data.
 *
 * Types (from email-types.ts): used by the agent, MCP server, and route
 * handlers to avoid `as any` casting.
 *
 * Zod schemas: used across route handlers to eliminate duplication.
 */
import { z } from "zod";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_COUNT } from "../../shared/attachments";

// ── TypeScript Interfaces ──────────────────────────────────────────

export interface EmailMetadata {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	read: boolean;
	starred: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	folder_id?: string | null;
	snippet?: string | null;
}

export interface EmailFull extends EmailMetadata {
	body?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

// ── Zod Schemas ────────────────────────────────────────────────────

const RecipientFieldSchema = z.union([
	z.string().email(),
	z.array(z.string().email()).min(1),
]);

export const ErrorResponseSchema = z.object({
	error: z.string(),
});

export const AttachmentListSchema = z.array(z.object({
	content: z.string().max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4)
		.regex(/^[A-Za-z0-9+/]*={0,2}$/, "Attachment must contain base64 data")
		.refine((value) => value.length % 4 === 0, "Attachment must contain base64 data"),
	filename: z.string().min(1).max(255),
	type: z.string().min(1).max(255),
	disposition: z.enum(["attachment", "inline"]),
	contentId: z.string().max(255).optional(),
})).max(MAX_ATTACHMENT_COUNT).refine((items) => items.reduce((total, item) =>
	total + item.content.length * 0.75 - (item.content.endsWith("==") ? 2 : item.content.endsWith("=") ? 1 : 0), 0) <= MAX_ATTACHMENT_BYTES,
	"Attachments must total 15 MiB or less");

export const SendEmailRequestSchema = z
	.object({
		to: RecipientFieldSchema,
		cc: RecipientFieldSchema.optional(),
		bcc: RecipientFieldSchema.optional(),
		from: z.union([
			z.string().email(),
			z.object({ email: z.string().email(), name: z.string() }),
		]),
		subject: z.string(),
		html: z.string().optional(),
		text: z.string().optional(),
		attachments: AttachmentListSchema.optional(),
		in_reply_to: z.string().optional(),
		references: z.array(z.string()).optional(),
		thread_id: z.string().optional(),
	})
	.refine((data) => data.html || data.text, {
		message: "Either 'html' or 'text' must be provided",
	});

export const SendEmailResponseSchema = z.object({
	id: z.string(),
	status: z.string(),
});
