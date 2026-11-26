import { readFileSync } from "node:fs";
import { SMTPServer } from "smtp-server";
import { receiveEmail } from "./index";
import { normalizeAddress } from "./lib/domains";
import { resolveInboundRecipient } from "./routing";
import type { Env } from "./types";

const MAX_SIZE = 25 * 1024 * 1024;
const smtpError = (code: number, message: string) => Object.assign(new Error(message), { responseCode: code });

export async function listenForMail(env: Env, port: number, host: string, tls?: { key: string; cert: string }) {
	const server = new SMTPServer({
		name: env.MAIL_HOSTNAME || "inbox.local",
		key: tls && readFileSync(tls.key), cert: tls && readFileSync(tls.cert),
		disabledCommands: tls ? ["AUTH", "XCLIENT", "XFORWARD"] : ["AUTH", "STARTTLS", "XCLIENT", "XFORWARD"],
		authOptional: true, size: MAX_SIZE, maxClients: 50, socketTimeout: 30_000, disableReverseLookup: true,
		onRcptTo(address, session, callback) {
			if (session.envelope.rcptTo.length >= 25) return callback(smtpError(452, "Too many recipients"));
			const to = normalizeAddress(address.address);
			resolveInboundRecipient(env, to).then(
				(plan) => callback(plan.accept ? null : smtpError(550, plan.reason || "Mailbox unavailable")),
				() => callback(smtpError(451, "Mailbox temporarily unavailable")),
			);
		},
		onData(stream, session, callback) {
			void (async () => {
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const incoming of stream) {
					const chunk = Buffer.from(incoming);
					size += chunk.length;
					if (size <= MAX_SIZE) chunks.push(chunk);
				}
				if (size > MAX_SIZE || stream.sizeExceeded) throw smtpError(552, "Message exceeds size limit");
				const raw = Buffer.concat(chunks);
				for (const to of new Set(session.envelope.rcptTo.map((recipient) => normalizeAddress(recipient.address)))) {
					await receiveEmail({ to, raw: new ReadableStream({ start(c) { c.enqueue(raw); c.close(); } }), rawSize: size,
						setReject: (reason) => { throw smtpError(550, reason); } }, env);
				}
			})().then(() => callback(null), (error) => {
				if (error?.responseCode) return callback(error);
				console.error("Inbound message could not be stored", error);
				return callback(smtpError(451, "Message could not be stored; retry later"));
			});
		},
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => { server.removeListener("error", reject); resolve(); });
	});
	server.on("error", (error) => console.error("SMTP listener error", error));
	return server;
}
