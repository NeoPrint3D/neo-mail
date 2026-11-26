import { Dialog, useKumoToastManager } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { CopyIcon, KeyIcon, PlugsIcon, PlusIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import AppDialog from "~/components/AppDialog";
import WorkspaceFrame from "~/components/WorkspaceFrame";
import SearchSelect from "~/components/SearchSelect";
import { mcpIssuablePermissions, mcpServerName, type McpIssuablePermission, type McpPermission } from "shared/mcp";
import { useConfig, useMailboxes } from "~/queries/mailboxes";
import api, { type McpToken } from "~/services/api";

export function meta() { return [{ title: "MCP connections · NeoMail" }]; }

const permissionNames: Record<McpPermission, string> = { read: "Read", manage: "Legacy manage (no sending)", send: "Read and act", admin: "Workspace admin" };

export default function IntegrationsRoute() {
	const [origin, setOrigin] = useState("");
	const [testing, setTesting] = useState(false);
	const [status, setStatus] = useState("");
	const [name, setName] = useState("");
	const [permission, setPermission] = useState<McpIssuablePermission>("read");
	const [selected, setSelected] = useState<string[]>([]);
	const [allMailboxes, setAllMailboxes] = useState(false);
	const [confirmingAdmin, setConfirmingAdmin] = useState(false);
	const [result, setResult] = useState<(McpToken & { token: string }) | null>(null);
	const [revoking, setRevoking] = useState<McpToken | null>(null);
	const toast = useKumoToastManager();
	const cache = useQueryClient();
	const { data: config } = useConfig();
	const mailboxes = useMailboxes();
	const tokens = useQuery({ queryKey: ["mcp-tokens"], queryFn: api.listMcpTokens });
	const create = useMutation({ mutationFn: api.createMcpToken, onSuccess: (created) => { setResult(created); setName(""); setStatus(""); setConfirmingAdmin(false); void cache.invalidateQueries({ queryKey: ["mcp-tokens"] }); } });
	const revoke = useMutation({ mutationFn: api.revokeMcpToken, onSuccess: (_data, id) => {
		if (result?.id === id) setResult(null);
		setRevoking(null); void cache.invalidateQueries({ queryKey: ["mcp-tokens"] });
	} });
	useEffect(() => setOrigin(window.location.origin), []);
	const endpoint = `${origin || "https://mail.example.com"}/mcp`;
	const admin = permission === "admin";
	const eligibleMailboxes = mailboxes.data?.filter(({ disposable }) => !disposable);
	const selectedMailboxes = selected.filter((id) => eligibleMailboxes?.some((box) => box.id === id));
	const clientConfig = (token: string) => JSON.stringify({ mcpServers: { [mcpServerName]: { url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);

	async function copy(value: string, label: string) {
		try { await navigator.clipboard.writeText(value); toast.add({ title: `${label} copied` }); }
		catch { toast.add({ title: "Could not copy. Select and copy it manually.", variant: "error" }); }
	}
	async function testConnection() {
		if (!result) return;
		setTesting(true); setStatus("");
		try {
			const response = await fetch("/mcp", {
				method: "POST", headers: { Authorization: `Bearer ${result.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "workspace-check", version: "1.0.0" } } }),
				signal: AbortSignal.timeout(10000),
			});
			const data = await response.json().catch(() => null) as { result?: { serverInfo?: { name: string }; protocolVersion: string } } | null;
			if (!response.ok || data?.result?.serverInfo?.name !== mcpServerName) throw new Error("Could not connect with this token.");
			setStatus(`Connected · protocol ${data.result.protocolVersion}`);
		} catch (err) { setStatus(err instanceof Error ? err.message : "Connection failed"); }
		finally { setTesting(false); }
	}
	function createToken(event: FormEvent) {
		event.preventDefault();
		if (!name.trim() || create.isPending) return;
		create.reset();
		if (admin) { setConfirmingAdmin(true); return; }
		if (allMailboxes || selectedMailboxes.length) create.mutate({ name: name.trim(), permission, mailboxes: allMailboxes ? null : selectedMailboxes });
	}

	return <WorkspaceFrame>
		<div className="settings-page">
			<header className="settings-heading"><p className="workspace-label"><PlugsIcon className="mr-1 inline" /> Integrations</p><h1>MCP connections</h1><p>Connect a client you choose. No model runs inside NeoMail.</p></header>
			<section className="settings-card space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Server endpoint</h2><span className="mail-label">Streamable HTTP</span></div>
				<div className="flex items-center gap-2 rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2"><code className="min-w-0 flex-1 break-all text-sm">{endpoint}</code>
					<Button variant="ghost" size="sm" shape="square" icon={<CopyIcon size={16} />} onClick={() => copy(endpoint, "Endpoint")} aria-label="Copy server endpoint" /></div>
			</section>
			<section className="settings-card space-y-3">
				<h2 className="flex items-center gap-2 font-semibold"><KeyIcon size={18} /> Client tokens</h2>
				<p className="text-sm text-kumo-subtle">Create a revocable token for each client.</p>
				<form className="space-y-3" onSubmit={createToken}>
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="field-label">Client name<input className="field-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="e.g. Support agent" required /></label>
						<SearchSelect showLabel label="Permissions" value={permission} onChange={(value) => setPermission(value as McpIssuablePermission)}
							options={mcpIssuablePermissions.map((value) => ({ value, label: permissionNames[value] }))} />
					</div>
					<p className="text-xs text-kumo-subtle">
						{permission === "read" ? "Read and search mail without making changes."
							: permission === "send" ? `Read and manage mail in selected inboxes. Can send, reply, and forward ${config?.mcpAllowSend ? "after confirmation" : "if MCP sending is enabled"}.`
							: "Manage mail, domains, and routing across the workspace."}
						{" Disposable inboxes are never included."}
					</p>
					{admin ? <p className="rounded-lg bg-kumo-recessed px-3 py-2 text-sm">All current and future non-disposable inboxes</p> : <fieldset className="space-y-2 rounded-xl border border-kumo-line px-3 pb-3">
						<legend className="px-1 text-sm font-medium">Mailbox access</legend>
						<label className="flex items-center gap-2 text-sm"><input type="checkbox" className="workspace-check" checked={allMailboxes} onChange={(event) => setAllMailboxes(event.target.checked)} /> All current and future non-disposable mailboxes</label>
						{!allMailboxes && <div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">
							{eligibleMailboxes?.map(({ id, email }) => <label key={id} className="flex min-w-0 items-center gap-2 text-sm"><input type="checkbox" className="workspace-check shrink-0" checked={selected.includes(id)} onChange={(event) => setSelected((old) => event.target.checked ? [...old, id] : old.filter((value) => value !== id))} /><span className="break-all">{email}</span></label>)}
							{mailboxes.isPending && <p className="text-sm text-kumo-subtle">Loading mailboxes…</p>}
							{mailboxes.isError && <p className="text-sm text-kumo-danger">Could not load mailboxes.</p>}
							{eligibleMailboxes?.length === 0 && <p className="text-sm text-kumo-subtle">No non-disposable mailboxes to select.</p>}
						</div>}
					</fieldset>}
					<Button variant="primary" type="submit" disabled={!admin && !allMailboxes && !selectedMailboxes.length} loading={create.isPending} icon={<PlusIcon size={16} />}>Create token</Button>
				</form>
				{create.error && !confirmingAdmin && <p role="alert" className="form-error">{create.error.message}</p>}
				{result && <div className="space-y-2 rounded-xl border border-kumo-line bg-kumo-recessed p-3">
					<p className="text-sm font-semibold">Copy this token now. It is only shown once.</p><code className="block break-all text-xs">{result.token}</code>
					<div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => copy(result.token, "Token")}>Copy token</Button><Button variant="secondary" size="sm" onClick={() => copy(clientConfig(result.token), "Client config")}>Copy client config</Button><Button variant="secondary" size="sm" loading={testing} onClick={testConnection}>Test token</Button><Button variant="ghost" size="sm" onClick={() => setResult(null)}>Hide token</Button></div>
					{status && <p role="status" className="text-sm">{status}</p>}
				</div>}
				{tokens.isError ? <p role="alert" className="form-error">{tokens.error.message}</p> : <ul className="divide-y divide-kumo-line">
					{tokens.data?.map((token) => <li key={token.id} className="flex items-center justify-between gap-2 py-2"><div><p className="text-sm font-medium">{token.name}</p><p className="break-all text-xs text-kumo-subtle">{permissionNames[token.permission]} · {token.mailboxes?.join(", ") || "All non-disposable mailboxes"}</p></div><Button variant="ghost" size="sm" aria-label={`Revoke ${token.name}`} onClick={() => { revoke.reset(); setRevoking(token); }}>Revoke</Button></li>)}
				</ul>}
			</section>
		</div>
		{confirmingAdmin && <AppDialog title="Create workspace admin token?"
			description={`This token can manage all non-disposable inboxes, domains, and routing${config?.mcpAllowSend ? ", and send mail" : ""}.`}
			icon={<ShieldCheckIcon size={24} weight="duotone" />} busy={create.isPending} onClose={() => setConfirmingAdmin(false)}
			actions={<button type="button" className="mail-button primary" disabled={create.isPending}
				onClick={() => create.mutate({ name: name.trim(), permission: "admin", mailboxes: null })}>{create.isPending ? "Creating…" : "Create admin token"}</button>}>
			{create.error && <p role="alert" className="form-error">{create.error.message}</p>}
		</AppDialog>}
		<Dialog.Root open={!!revoking} onOpenChange={(open) => { if (!open && !revoke.isPending) setRevoking(null); }}><Dialog size="sm" className="settings-dialog space-y-3 p-6">
			<Dialog.Title className="font-semibold">Revoke {revoking?.name}?</Dialog.Title><Dialog.Description className="text-sm text-kumo-subtle">Connections that use this token will immediately lose access.</Dialog.Description>
			{revoke.error && <p role="alert" className="form-error">{revoke.error.message}</p>}
			<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRevoking(null)} disabled={revoke.isPending}>Cancel</Button><Button variant="destructive" loading={revoke.isPending} onClick={() => { if (revoking) revoke.mutate(revoking.id); }}>Revoke token</Button></div>
		</Dialog></Dialog.Root>
	</WorkspaceFrame>;
}
