// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import nodemailer, { type Transporter } from "nodemailer";
import type { SendEmailParams } from "./types";

export function smtpTransport(config?: string) {
	if (!config) return undefined;
	const url = new URL(config);
	if (!['smtp:', 'smtps:'].includes(url.protocol) || !url.hostname) throw new Error("SMTP_URL must be a valid smtp:// or smtps:// URL");
	const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	return nodemailer.createTransport({
		host: url.hostname.replace(/^\[|\]$/g, ""),
		port: Number(url.port || (url.protocol === "smtps:" ? 465 : 587)),
		secure: url.protocol === "smtps:",
		requireTLS: !local && url.protocol === "smtp:",
		auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
		connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
		// Attachments and email HTML are never loaded from arbitrary URLs or local paths.
		disableFileAccess: true, disableUrlAccess: true,
	});
}

export async function sendEmail(relay: Transporter | undefined, message: SendEmailParams): Promise<{ messageId: string }> {
	if (!relay) throw new Error("SMTP_URL is not configured");
	const info = await relay.sendMail({
		...message,
		from: typeof message.from === "string" ? message.from : { name: message.from.name, address: message.from.email },
		attachments: message.attachments?.map((file) => ({
			filename: file.filename, content: Buffer.from(file.content, "base64"), contentType: file.type,
			contentDisposition: file.disposition, cid: file.contentId,
		})),
	});
	return { messageId: info.messageId };
}
