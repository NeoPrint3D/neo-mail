import type { BlobRepository } from "../server/types";

export class R2Store implements BlobRepository {
	constructor(private readonly bucket: R2Bucket) {}

	async listMailboxes() {
		const entries: Awaited<ReturnType<BlobRepository["listMailboxes"]>> = [];
		let cursor: string | undefined;
		do {
			const page = await this.bucket.list({ prefix: "mailboxes/", cursor, include: ["customMetadata"] });
			for (const { key, customMetadata } of page.objects) {
				if (/^mailboxes\/[^/]+\.json$/.test(key)) entries.push({ key, customMetadata });
			}
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
		return entries;
	}

	async head(key: string) { return !!await this.bucket.head(key); }
	get(key: string) { return this.bucket.get(key); }
	async put(...[key, value, options]: Parameters<BlobRepository["put"]>) {
		let onlyIf: Headers | undefined;
		if (options?.onlyIf?.etagDoesNotMatch) onlyIf = new Headers({ "If-None-Match": "*" });
		else if (options?.onlyIf?.etagMatches) {
			const etag = options.onlyIf.etagMatches;
			if (etag === "*") {
				const current = await this.bucket.head(key);
				if (!current) return false;
				onlyIf = new Headers({ "If-Match": current.httpEtag });
			} else {
				onlyIf = new Headers({ "If-Match": `"${etag}"` });
			}
		}
		return !!await this.bucket.put(key, value, { onlyIf, customMetadata: options?.customMetadata });
	}
	async delete(keys: string | string[]) {
		if (typeof keys === "string" || keys.length) await this.bucket.delete(keys);
	}
}
