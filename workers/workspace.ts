import { DurableObject } from "cloudflare:workers";
import { AuthStore } from "../server/auth";
import { DomainSchema, Domains } from "../server/domains";
import { PushStore } from "../server/push";
import { RoutingStore } from "../server/routing";
import { WebhookStore } from "../server/webhooks";
import { storageAdapter } from "./sqlite";
import type { Bindings } from "./types";

/** One workspace owns auth, domain configuration, and alias routing. Mail resides in separate DOs. */
export class WorkspaceDO extends DurableObject<Bindings> {
	private readonly auth: AuthStore;
	private readonly domains: Domains;
	private readonly routing: RoutingStore;
	private readonly push: PushStore;
	private readonly webhooks: WebhookStore;

	constructor(ctx: DurableObjectState, env: Bindings) {
		super(ctx, env);
		const { db } = storageAdapter(ctx.storage);
		this.auth = new AuthStore(db, env.SETUP_CODE ?? "");
		this.domains = new Domains(db);
		this.routing = new RoutingStore(db);
		this.push = new PushStore(db);
		this.webhooks = new WebhookStore(db);
		// One-time bootstrap for existing Worker deployments; edits in the UI remain authoritative.
		ctx.storage.transactionSync(() => {
			db.exec("CREATE TABLE IF NOT EXISTS workspace_bootstrap (id INTEGER PRIMARY KEY)");
			if (!db.prepare("SELECT 1 FROM workspace_bootstrap WHERE id = 1").get()) {
				for (const domain of (env.DOMAINS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
					this.domains.create(DomainSchema.parse({ domain, dmarc: "" }));
				}
				db.prepare("INSERT INTO workspace_bootstrap (id) VALUES (1)").run();
			}
		});
	}

	authConfigured(...args: Parameters<AuthStore["configured"]>) { return this.auth.configured(...args); }
	authCanSetup(...args: Parameters<AuthStore["canSetup"]>) { return this.auth.canSetup(...args); }
	authAllowAttempt(...args: Parameters<AuthStore["allowAttempt"]>) { return this.auth.allowAttempt(...args); }
	authInitialize(...args: Parameters<AuthStore["initialize"]>) { return this.auth.initialize(...args); }
	authVerify(...args: Parameters<AuthStore["verify"]>) { return this.auth.verify(...args); }
	authChangePassword(...args: Parameters<AuthStore["changePassword"]>) { return this.auth.changePassword(...args); }
	authCreateSession(...args: Parameters<AuthStore["createSession"]>) { return this.auth.createSession(...args); }
	authSessionEmail(...args: Parameters<AuthStore["sessionEmail"]>) { return this.auth.sessionEmail(...args); }
	authDeleteSession(...args: Parameters<AuthStore["deleteSession"]>) { return this.auth.deleteSession(...args); }
	authCreateToken(...args: Parameters<AuthStore["createToken"]>) { return this.auth.createToken(...args); }
	authListTokens(...args: Parameters<AuthStore["listTokens"]>) { return this.auth.listTokens(...args); }
	authRevokeToken(...args: Parameters<AuthStore["revokeToken"]>) { return this.auth.revokeToken(...args); }
	authVerifyToken(...args: Parameters<AuthStore["verifyToken"]>) { return this.auth.verifyToken(...args); }
	domainsNames(...args: Parameters<Domains["names"]>) { return this.domains.names(...args); }
	domainsList(...args: Parameters<Domains["list"]>) { return this.domains.list(...args); }
	domainsGet(...args: Parameters<Domains["get"]>) { return this.domains.get(...args); }
	domainsCreate(...args: Parameters<Domains["create"]>) { return this.domains.create(...args); }
	domainsUpdate(...args: Parameters<Domains["update"]>) { return this.domains.update(...args); }
	domainsDelete(...args: Parameters<Domains["delete"]>) { return this.domains.delete(...args); }
	pushSave(...args: Parameters<PushStore["save"]>) { return this.push.save(...args); }
	pushList(...args: Parameters<PushStore["list"]>) { return this.push.list(...args); }
	pushRows(...args: Parameters<PushStore["rows"]>) { return this.push.rows(...args); }
	pushRemove(...args: Parameters<PushStore["remove"]>) { this.push.remove(...args); }
	pushRemoveForSession(...args: Parameters<PushStore["removeForSession"]>) { this.push.removeForSession(...args); }
	pushClear() { this.push.clear(); }
	webhookList(...args: Parameters<WebhookStore["list"]>) { return this.webhooks.list(...args); }
	webhookCreate(...args: Parameters<WebhookStore["create"]>) { return this.webhooks.create(...args); }
	webhookGet(...args: Parameters<WebhookStore["get"]>) { return this.webhooks.get(...args); }
	webhookForRecipient(...args: Parameters<WebhookStore["forRecipient"]>) { return this.webhooks.forRecipient(...args); }
	webhookSetEnabled(...args: Parameters<WebhookStore["setEnabled"]>) { return this.webhooks.setEnabled(...args); }
	webhookDelete(...args: Parameters<WebhookStore["delete"]>) { return this.webhooks.delete(...args); }
	webhookClaim(...args: Parameters<WebhookStore["claim"]>) { return this.webhooks.claim(...args); }
	webhookRecord(...args: Parameters<WebhookStore["record"]>) { return this.webhooks.record(...args); }
	routingList(...args: Parameters<RoutingStore["list"]>) { return this.routing.list(...args); }
	routingListForMailbox(...args: Parameters<RoutingStore["listForMailbox"]>) { return this.routing.listForMailbox(...args); }
	routingGet(...args: Parameters<RoutingStore["get"]>) { return this.routing.get(...args); }
	routingFindByAddress(...args: Parameters<RoutingStore["findByAddress"]>) { return this.routing.findByAddress(...args); }
	routingCreate(...args: Parameters<RoutingStore["create"]>) { return this.routing.create(...args); }
	routingUpdate(...args: Parameters<RoutingStore["update"]>) { return this.routing.update(...args); }
	routingDelete(...args: Parameters<RoutingStore["delete"]>) { return this.routing.delete(...args); }
}
