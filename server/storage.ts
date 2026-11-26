import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { MailboxStore } from "./mail-store";
import { SQLiteStore } from "./sqlite";
import type { MailboxMetadata } from "./types";

const hashKey = (key: string | Uint8Array) => createHash("sha256").update(key).digest("hex");
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

export class Mailboxes {
	private readonly instances = new Map<string, MailboxStore>();
	constructor(private readonly directory: string) { mkdirSync(directory, { recursive: true, mode: 0o700 }); }
	get(address: string) {
		let mailbox = this.instances.get(address);
		if (!mailbox) {
			mailbox = new MailboxStore(new SQLiteStore(join(this.directory, `${hashKey(address)}.sqlite`)));
			this.instances.set(address, mailbox);
		}
		return mailbox;
	}
}

export class BlobStore {
	constructor(private readonly directory: string, private readonly catalog: DatabaseSync) {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		catalog.exec("CREATE TABLE IF NOT EXISTS mailbox_profiles (key TEXT PRIMARY KEY, value TEXT NOT NULL, name TEXT)");
	}
	async listMailboxes() {
		return (this.catalog.prepare("SELECT key, name, json_extract(value, '$.disposable') = 1 AS disposable FROM mailbox_profiles ORDER BY key").all() as { key: string; name: string | null; disposable: number | null }[])
			.map(({ key, name, disposable }) => ({ key, customMetadata: { name: name ?? undefined, disposable: disposable ? "true" : undefined } }));
	}
	async head(key: string) { return key.startsWith("mailboxes/") && !!this.catalog.prepare("SELECT 1 FROM mailbox_profiles WHERE key = ?").get(key); }
	async get(key: string) {
		if (key.startsWith("mailboxes/")) {
			const row = this.catalog.prepare("SELECT value FROM mailbox_profiles WHERE key = ?").get(key) as { value: string } | undefined;
			return row ? { json: async <T>() => JSON.parse(row.value) as T, body: null, etag: hashKey(row.value) } : null;
		}
		try {
			const data = await readFile(join(this.directory, hashKey(key)));
			return { body: new Uint8Array(data), etag: hashKey(data), json: async <T>() => JSON.parse(data.toString("utf8")) as T };
		} catch (error) { if (missing(error)) return null; throw error; }
	}
	async put(key: string, value: string | Uint8Array | ArrayBuffer, options?: { onlyIf?: { etagDoesNotMatch?: "*"; etagMatches?: string }; customMetadata?: MailboxMetadata }) {
		if (key.startsWith("mailboxes/")) {
			if (typeof value !== "string") throw new Error("Invalid mailbox profile");
			const name = options?.customMetadata?.name ?? null;
			const etag = options?.onlyIf?.etagMatches;
			if (etag && etag !== "*") {
				const current = this.catalog.prepare("SELECT value FROM mailbox_profiles WHERE key = ?").get(key) as { value: string } | undefined;
				if (!current || hashKey(current.value) !== etag) return false;
				return !!this.catalog.prepare("UPDATE mailbox_profiles SET value = ?, name = ? WHERE key = ? AND value = ?")
					.run(value, name, key, current.value).changes;
			}
			const result = etag
				? this.catalog.prepare("UPDATE mailbox_profiles SET value = ?, name = ? WHERE key = ?").run(value, name, key)
				: this.catalog.prepare("INSERT INTO mailbox_profiles (key, value, name) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING").run(key, value, name);
			return !!result.changes;
		}
		const path = join(this.directory, hashKey(key));
		const temporary = `${path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, value instanceof ArrayBuffer ? new Uint8Array(value) : value, { mode: 0o600 });
			await rename(temporary, path);
		} finally { await rm(temporary, { force: true }).catch(() => {}); }
		return true;
	}
	async delete(keys: string | string[]) {
		for (const key of typeof keys === "string" ? [keys] : keys) {
			if (key.startsWith("mailboxes/")) this.catalog.prepare("DELETE FROM mailbox_profiles WHERE key = ?").run(key);
			else await rm(join(this.directory, hashKey(key)), { force: true });
		}
	}
}
