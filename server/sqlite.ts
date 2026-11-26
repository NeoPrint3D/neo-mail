import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export class SQLiteStore {
	readonly db: DatabaseSync;
	readonly sql: { exec: <T = Record<string, unknown>>(query: string, ...params: SQLInputValue[]) => IterableIterator<T> & { toArray: () => T[]; raw: () => { toArray: () => unknown[][] } } };
	private transactionDepth = 0;

	constructor(path: string) {
		this.db = new DatabaseSync(path);
		this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
		// The existing synchronous query layer uses positional cursors. Adapt it
		// to Node's SQLite statements without a Workers runtime or native npm addon.
		this.sql = { exec: <T>(query: string, ...params: SQLInputValue[]) => {
			const statement = this.db.prepare(query);
			statement.setReturnArrays(true);
			const values = statement.all(...params) as unknown as unknown[][];
			const columns = statement.columns().map((col) => col.name);
			const rows = () => values.map((row) => Object.fromEntries(columns.map((name, i) => [name, row[i]])) as T);
			return Object.assign((function* () { yield* rows(); })(), { toArray: rows, raw: () => ({ toArray: () => values }) });
		} };
	}

	transactionSync<T>(run: () => T): T {
		const level = `tx${this.transactionDepth}`;
		this.db.exec(`SAVEPOINT ${level}`);
		this.transactionDepth++;
		try {
			const value = run();
			this.db.exec(`RELEASE ${level}`);
			return value;
		} catch (error) {
			this.db.exec(`ROLLBACK TO ${level}; RELEASE ${level}`);
			throw error;
		} finally { this.transactionDepth--; }
	}
}
