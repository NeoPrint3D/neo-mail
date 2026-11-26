import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DomainSchema, hostName } from "../domains";
import { mailboxDisposition } from "../lib/email-helpers";
import { domainRoutes } from "../domain-routes";
import { app as mailApi, MailboxSettings } from "../index";
import { RoutingInputSchema } from "../routing";
import { routingRoutes } from "../routing-routes";
import type { Env } from "../types";
import { confirmed, destructive, emailAddress, error, mailboxId, mailboxPath, readOnly, resourceId, routeTool, write } from "./tool-helpers";

export function registerWorkspaceAdmin(server: McpServer, env: Env) {
	const domainPath = (domain: string) => `/api/v1/domains/${encodeURIComponent(domain)}`;
	const routingPath = "/api/v1/routing";

	server.registerTool("create_mailbox", {
		description: "Create an inbox on a registered domain. Does not change DNS or existing mail routing.",
		inputSchema: { email: emailAddress, name: z.string().trim().min(1).max(120).optional() }, annotations: write,
	}, async ({ email, name }) => routeTool(mailApi, env, "POST", "/api/v1/mailboxes", { email, name: name ?? email.split("@")[0] }));
	server.registerTool("update_mailbox_settings", {
		description: "Change a mailbox’s display name, signature or forwarding. Omitted settings are retained. Confirm any delivery changes with the owner.",
		inputSchema: { mailboxId, settings: MailboxSettings.extend({ forwarding: MailboxSettings.shape.forwarding.unwrap().omit({ email: true }).optional() }), confirmed }, annotations: destructive,
	}, async ({ mailboxId: id, settings }) => {
		const object = await env.STORE.get(`mailboxes/${id}.json`);
		if (!object) return error("Mailbox not found");
		const current = await object.json<z.output<typeof MailboxSettings> & { disposable?: boolean }>();
		if (current.disposable === true) return error("Mailbox not found");
		return routeTool(mailApi, env, "PUT", mailboxPath(id), { settings: { ...current, ...settings } });
	});
	server.registerTool("disconnect_mailbox", {
		description: "Stop accepting mail for this inbox. Stored mail is retained; re-create the exact address to reconnect.",
		inputSchema: { mailboxId, confirmed }, annotations: destructive,
	}, async ({ mailboxId: id }) => (await mailboxDisposition(env.STORE, id)) === false
		? routeTool(mailApi, env, "DELETE", mailboxPath(id)) : error("Mailbox not found"));

	server.registerTool("list_domain_settings", {
		description: "List mail domain settings and planned DNS records. Does not change live DNS.", annotations: readOnly,
	}, async () => routeTool(domainRoutes, env, "GET", "/api/v1/domains"));
	server.registerTool("create_domain", {
		description: "Register a mail domain in the workspace. Does not buy domains, modify DNS or enable Cloudflare mail.",
		inputSchema: DomainSchema, annotations: write,
	}, async (config) => routeTool(domainRoutes, env, "POST", "/api/v1/domains", config));
	server.registerTool("update_domain_settings", {
		description: "Replace the saved settings for a domain. Retrieve current settings first. This does not publish DNS records.",
		inputSchema: { config: DomainSchema, confirmed }, annotations: destructive,
	}, async ({ config }) => routeTool(domainRoutes, env, "PUT", domainPath(config.domain), config));
	server.registerTool("remove_domain", {
		description: "Remove a domain from the workspace after its inboxes and routing rules are removed. Does not alter provider DNS.",
		inputSchema: { domain: hostName, confirmed }, annotations: destructive,
	}, async ({ domain }) => routeTool(domainRoutes, env, "DELETE", domainPath(domain)));
	server.registerTool("check_domain_dns", {
		description: "Check a registered domain’s live DNS against its saved mail record plan.", inputSchema: { domain: hostName }, annotations: readOnly,
	}, async ({ domain }) => routeTool(domainRoutes, env, "GET", `${domainPath(domain)}/check`));
	if (env.CLOUDFLARE_TOKEN) server.registerTool("publish_missing_mail_dns", {
		description: "Publish missing records from a saved mail DNS plan. Existing conflicting records are not overwritten. Run check_domain_dns first.",
		inputSchema: { domain: hostName, confirmed }, annotations: destructive,
	}, async ({ domain }) => routeTool(domainRoutes, env, "POST", `${domainPath(domain)}/publish`, { confirmed: true }));
	if (env.CLOUDFLARE_MAIL) {
		server.registerTool("inspect_cloudflare_mail", {
			description: "Check Email Routing and Email Sending setup and discover conflicts or existing rules.",
			inputSchema: { domain: hostName }, annotations: readOnly,
		}, async ({ domain }) => routeTool(domainRoutes, env, "GET", `${domainPath(domain)}/cloudflare`));
		server.registerTool("enable_cloudflare_mail", {
			description: "Enable incoming routing or outbound sending for a registered Cloudflare domain. Inspect the domain and confirm first. Does not replace conflicting MX or another active catch-all.",
			inputSchema: { domain: hostName, action: z.enum(["receive", "send"]), confirmed }, annotations: destructive,
		}, async ({ domain, action }) => routeTool(domainRoutes, env, "POST", `${domainPath(domain)}/cloudflare`, { action, confirmed: true }));
		server.registerTool("list_forwarding_destinations", {
			description: "List account-wide Cloudflare forwarding destinations and their verification status. Supply a registered Cloudflare mail domain.",
			inputSchema: { domain: hostName }, annotations: readOnly,
		}, async ({ domain }) => routeTool(domainRoutes, env, "GET", `${domainPath(domain)}/cloudflare/destinations`));
		server.registerTool("verify_forwarding_destination", {
			description: "Email a verification request to an external forwarding address. The recipient must accept it before forwarding works.",
			inputSchema: { domain: hostName, email: emailAddress, confirmed }, annotations: destructive,
		}, async ({ domain, email }) => routeTool(domainRoutes, env, "POST", `${domainPath(domain)}/cloudflare/destinations`, { email }));
	}

	server.registerTool("create_routing_rule", {
		description: "Create an alias or catch-all to deliver to a mailbox, forward, or reject mail. Confirm the exact address and delivery targets first.",
		inputSchema: { rule: RoutingInputSchema, confirmed }, annotations: destructive,
	}, async ({ rule }) => routeTool(routingRoutes, env, "POST", routingPath, rule));
	server.registerTool("update_routing_rule", {
		description: "Replace a routing rule. Use list_routing_rules first and confirm delivery changes with the owner.",
		inputSchema: { ruleId: resourceId, rule: RoutingInputSchema, confirmed }, annotations: destructive,
	}, async ({ ruleId, rule }) => routeTool(routingRoutes, env, "PUT", `${routingPath}/${encodeURIComponent(ruleId)}`, rule));
	server.registerTool("delete_routing_rule", {
		description: "Remove a specific alias or catch-all routing rule. This can change delivery for the affected address or domain.",
		inputSchema: { ruleId: resourceId, confirmed }, annotations: destructive,
	}, async ({ ruleId }) => routeTool(routingRoutes, env, "DELETE", `${routingPath}/${encodeURIComponent(ruleId)}`));
	if (!env.platform && env.CLOUDFLARE_TOKEN) server.registerTool("sync_cloudflare_routing_rules", {
		description: "Sync eligible forward/reject rules to Cloudflare for a standalone deployment. This changes live routing; inspect the rules first.",
		inputSchema: { domain: hostName, confirmed }, annotations: destructive,
	}, async ({ domain }) => routeTool(routingRoutes, env, "POST", `${routingPath}/sync-cloudflare`, { domain, confirmed: true }));
}
