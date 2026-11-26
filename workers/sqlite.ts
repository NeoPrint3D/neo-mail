import type { MailSqlStorage } from "../server/sql-types";

/** Adapt Durable Object SQLite to the shared, synchronous SQL repository. */
export function storageAdapter(storage: DurableObjectStorage): MailSqlStorage {
	const sql = storage.sql as unknown as MailSqlStorage["sql"];
	const prepare = (query: string) => {
		const execute = (args: Parameters<typeof sql.exec> extends [string, ...infer P] ? P : never) => sql.exec(query, ...args);
		return {
			all: (...args: Parameters<typeof execute>[0]) => execute(args).toArray(),
			get: (...args: Parameters<typeof execute>[0]) => execute(args).toArray()[0],
			run: (...args: Parameters<typeof execute>[0]) => {
				const cursor = storage.sql.exec(query, ...args);
				cursor.toArray();
				return { changes: cursor.rowsWritten };
			},
		};
	};
	return { sql, db: { exec(query) { storage.sql.exec(query).toArray(); }, prepare }, transactionSync: (fn) => storage.transactionSync(fn) };
}
