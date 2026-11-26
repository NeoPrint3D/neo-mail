import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { SqlDatabase } from "./sql-types";
import { z } from "zod";
import { mcpPermissions, type McpScope, type McpToken } from "../shared/mcp";

const defaultScope: McpScope = { mailboxes: null, permission: "manage" };
const storedScope = z.object({
	mailboxes: z.array(z.string()).min(1).max(100).nullable(),
	permission: z.enum(mcpPermissions),
}).refine((scope) => scope.permission !== "admin" || scope.mailboxes === null);
function scopeFrom(value: unknown): McpScope | null {
	if (value === null || value === undefined) return defaultScope; // legacy tokens
	if (typeof value !== "string") return null;
	try {
		const parsed = storedScope.safeParse(JSON.parse(value));
		return parsed.success ? parsed.data : null;
	} catch { return null; }
}

const sessionDuration = 7 * 24 * 60 * 60;
const hex = (count: number) => randomBytes(count).toString("hex");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex"));
const deriveScrypt = (password: string, salt: string) => new Promise<string>((resolve, reject) => scrypt(password, salt, 64,
	{ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, hash) => error ? reject(error) : resolve(hash.toString("hex"))));
const now = () => Math.floor(Date.now() / 1000);

export class AuthStore {
	readonly setupCode: string;
	constructor(private readonly db: SqlDatabase, setupCode?: string, private readonly derive = deriveScrypt) {
		this.setupCode = setupCode ?? hex(16);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id = 1), email TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS login_sessions (digest TEXT PRIMARY KEY, expires INTEGER NOT NULL);
			CREATE TABLE IF NOT EXISTS mcp_tokens (id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
			CREATE INDEX IF NOT EXISTS auth_attempts_until ON auth_attempts(until);
			DELETE FROM login_sessions WHERE expires <= unixepoch();
		`);
		if (!this.db.prepare("PRAGMA table_info(mcp_tokens)").all().some((row) => row.name === "scope")) {
			this.db.exec("ALTER TABLE mcp_tokens ADD COLUMN scope TEXT");
		}
	}
	canSetup() { return this.setupCode.length >= 20; }
	configured() { return !!this.db.prepare("SELECT id FROM owner WHERE id = 1").get(); }
	allowAttempt(key: string, limit = 8) {
		const time = now();
		this.db.prepare("DELETE FROM auth_attempts WHERE until <= ?").run(time);
		const tracker = this.db.prepare(`INSERT INTO auth_attempts (key,count,until) VALUES (?,1,?)
			ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count <= ? RETURNING count`).get(key, time + 300, limit);
		return !!tracker && Number(tracker.count) <= limit;
	}
	async initialize(code: string, email: string, password: string) {
		if (this.setupCode.length < 20 || !equal(code, this.setupCode) || this.configured()) return false;
		const salt = hex(32);
		const hash = await this.derive(password, salt);
		return !!this.db.prepare("INSERT INTO owner (id,email,salt,password) VALUES (1,?,?,?) ON CONFLICT(id) DO NOTHING").run(email, salt, hash).changes;
	}
	async verify(email: string, password: string) {
		const row = this.db.prepare("SELECT email,salt,password FROM owner WHERE id = 1").get() as { email: string; salt: string; password: string } | undefined;
		const hash = await this.derive(password, row?.salt || "agentic-inbox-no-user");
		return !!row && equal(hash, row.password) && equal(email, row.email);
	}
	async changePassword(current: string, password: string, session: string) {
		const email = this.sessionEmail(session);
		if (!email || !await this.verify(email, current)) return false;
		const salt = hex(32);
		const hash = await this.derive(password, salt);
		this.db.prepare("UPDATE owner SET salt = ?, password = ? WHERE id = 1").run(salt, hash);
		this.db.prepare("DELETE FROM login_sessions WHERE digest != ?").run(digest(session));
		return true;
	}
	createSession() {
		const token = hex(32);
		this.db.prepare("DELETE FROM login_sessions WHERE expires <= ?").run(now());
		this.db.prepare("INSERT INTO login_sessions (digest,expires) VALUES (?,?)").run(digest(token), now() + sessionDuration);
		return { token, maxAge: sessionDuration };
	}
	sessionEmail(token?: string) {
		if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
		const session = this.db.prepare("SELECT email FROM login_sessions, owner WHERE digest = ? AND expires > ? AND owner.id = 1").get(digest(token), now());
		return session?.email as string | undefined;
	}
	deleteSession(token: string) { this.db.prepare("DELETE FROM login_sessions WHERE digest = ?").run(digest(token)); }
	createToken(name: string, scope: McpScope): (McpToken & { token: string }) | null {
		const id = hex(12), token = `inbox_${hex(32)}`, created = new Date().toISOString();
		if (!this.db.prepare(`INSERT INTO mcp_tokens (id,digest,name,created,scope) SELECT ?,?,?,?,?
			WHERE (SELECT COUNT(*) FROM mcp_tokens) < 50`).run(id, digest(token), name, created, JSON.stringify(scope)).changes) return null;
		return { id, token, name, created, ...scope };
	}
	listTokens(): McpToken[] {
		return this.db.prepare("SELECT id,name,created,scope FROM mcp_tokens ORDER BY created DESC").all().map((row) => ({
			id: String(row.id), name: String(row.name), created: String(row.created),
			...(scopeFrom(row.scope) ?? { mailboxes: null, permission: "read" as const }),
		}));
	}
	revokeToken(id: string) { return !!this.db.prepare("DELETE FROM mcp_tokens WHERE id = ?").run(id).changes; }
	verifyToken(value?: string) {
		if (!value || !/^Bearer inbox_[a-f0-9]{64}$/.test(value)) return null;
		const row = this.db.prepare("SELECT scope FROM mcp_tokens WHERE digest = ?").get(digest(value.slice(7)));
		return row ? scopeFrom(row.scope) : null;
	}
}
