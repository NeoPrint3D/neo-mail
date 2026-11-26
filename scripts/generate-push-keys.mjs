import { createECDH } from "node:crypto";

const subject = process.argv[2];
try {
	const uri = new URL(subject);
	if (!((uri.protocol === "https:" && !uri.username && !uri.password) || (uri.protocol === "mailto:" && uri.pathname.includes("@")))) throw new Error();
} catch {
	console.error("Usage: bun run push:keys https://mail.example.com (or a mailto: contact)");
	process.exit(1);
}
const ecdh = createECDH("prime256v1");
const publicKey = ecdh.generateKeys().toString("base64url");
const scalar = ecdh.getPrivateKey();
const privateKey = Buffer.concat([Buffer.alloc(32 - scalar.length), scalar]).toString("base64url");
// Redirect stdout to secure storage; this value contains a private key.
process.stdout.write(JSON.stringify({ subject, publicKey, privateKey }) + "\n");
