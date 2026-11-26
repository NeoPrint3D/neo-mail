import { Dialog } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import api from "~/services/api";

export function CloudflareDomain({ domain, configured }: { domain: string; configured: boolean }) {
	const cache = useQueryClient();
	const key = ["cloudflare-mail", domain];
	const check = useQuery({ queryKey: key, queryFn: () => api.cloudflareStatus(domain), enabled: configured, retry: false });
	const [confirm, setConfirm] = useState<"receive" | "send" | null>(null);
	const connect = useMutation({ mutationFn: (action: "receive" | "send") => api.connectCloudflare(domain, action),
		onSuccess: (result) => { cache.setQueryData(key, result); setConfirm(null); },
		onError: () => { void check.refetch(); },
	});
	const state = check.data;
	const open = (action: "receive" | "send") => { connect.reset(); setConfirm(action); };
	const conflicts = !!state && (state.blockingMx.length > 0 || state.catchAllConflict);
	return <section className="settings-card space-y-4" aria-label={`Cloudflare connection for ${domain}`}>
		<div className="flex flex-wrap items-start justify-between gap-2">
			<div><p className="workspace-label">Cloudflare Email Service</p><h2 className="mt-1 break-all text-xl font-semibold">{domain}</h2></div>
			{configured && <Button variant="secondary" size="sm" loading={check.isFetching} onClick={() => void check.refetch()}>Refresh status</Button>}
		</div>
		{!configured ? <p className="form-error">Set the Worker’s <code>CLOUDFLARE_TOKEN</code> secret to connect active zones from this screen.</p>
			: check.isPending ? <p role="status" className="text-sm text-kumo-subtle">Checking Cloudflare …</p>
			: check.isError ? <p role="alert" className="form-error">{check.error.message}</p> : null}
		{state && <>
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-2 rounded-xl border border-kumo-line p-3">
					<h3 className="font-medium">Incoming mail</h3>
					<p className="text-sm text-kumo-subtle">{state.workerConnected && !state.blockingMx.length ? "Connected to this Worker. New inboxes and aliases work without adding Cloudflare rules." : state.routingEnabled ? "Email Routing is on. Connect the catch-all to this Worker." : "Email Routing is not yet enabled."}</p>
					{!state.workerConnected && <Button variant="primary" size="sm" disabled={conflicts} onClick={() => open("receive")}>Connect incoming mail</Button>}
				</div>
				<div className="space-y-2 rounded-xl border border-kumo-line p-3">
					<h3 className="font-medium">Outgoing mail</h3>
					<p className="text-sm text-kumo-subtle">{state.sendingStatus === "enabled" ? "Email Sending is enabled. Send a test message after DNS has propagated." : state.sendingSupported ? "Enable Email Sending for this From domain." : "Email Sending is unavailable for this token or Cloudflare account."}</p>
					{state.sendingSupported && state.sendingStatus !== "enabled" && <Button variant="secondary" size="sm" onClick={() => open("send")}>Enable sending</Button>}
				</div>
			</div>
			{conflicts && <p role="alert" className="form-error">{state.blockingMx.length > 0 && <>Existing MX records: {state.blockingMx.join(", ")}. </>}{state.catchAllConflict && <>An active catch-all belongs to another destination. </>}NeoMail does not replace either. Review the existing configuration in Cloudflare first.</p>}
			{state.overrides.length > 0 && <details className="rounded-lg border border-kumo-line p-3 text-sm"><summary className="cursor-pointer">{state.overrides.length} existing Cloudflare rule{state.overrides.length !== 1 && "s"} can bypass this Worker</summary><p className="my-2 text-kumo-subtle">Cloudflare evaluates these rules before the catch-all. They were left unchanged.</p><ul className="list-inside list-disc break-all">{state.overrides.map((address, index) => <li key={`${address}:${index}`}>{address}</li>)}</ul></details>}
			<div className="flex flex-wrap gap-4 text-sm"><Link className="text-kumo-link" to="/mailboxes">Manage mailboxes →</Link><Link className="text-kumo-link" to={`/routing?${new URLSearchParams({ domain })}`}>Set up aliases and forwarding →</Link></div>
		</>}
		<Dialog.Root open={!!confirm} onOpenChange={(open) => { if (!open && !connect.isPending) setConfirm(null); }}><Dialog size="sm" className="settings-dialog space-y-4 p-6">
			<Dialog.Title className="font-semibold">{confirm === "receive" ? "Connect incoming mail?" : "Enable outgoing mail?"}</Dialog.Title>
			<Dialog.Description className="text-sm text-kumo-subtle">{confirm === "receive" ? `Cloudflare may add and lock its required MX and SPF records for ${domain}. Unmatched addresses will be routed to this Worker. Existing exact rules will not change.` : `Ask Cloudflare to enable Email Sending and configure its sending DNS for ${domain}. Cloudflare applies its own plan and recipient limits.`}</Dialog.Description>
			{connect.error && <p role="alert" className="form-error">{connect.error.message}</p>}
			<div className="flex justify-end gap-2"><Button variant="secondary" disabled={connect.isPending} onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" loading={connect.isPending} onClick={() => { if (confirm) connect.mutate(confirm); }}>Confirm</Button></div>
		</Dialog></Dialog.Root>
	</section>;
}
