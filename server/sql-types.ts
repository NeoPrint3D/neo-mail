import type { SQLInputValue } from "node:sqlite";

export interface SqlDatabase {
	exec(sql: string): void;
	prepare(sql: string): {
		all(...params: SQLInputValue[]): Record<string, unknown>[];
		get(...params: SQLInputValue[]): Record<string, unknown> | undefined;
		run(...params: SQLInputValue[]): { changes: number | bigint };
	};
}

export interface MailSqlStorage {
	readonly db: SqlDatabase;
	readonly sql: {
		exec<T = Record<string, unknown>>(query: string, ...params: SQLInputValue[]):
			IterableIterator<T> & { toArray(): T[]; raw(): { toArray(): unknown[][] } };
	};
	transactionSync<T>(run: () => T): T;
}
