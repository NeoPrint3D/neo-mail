import { GlobeHemisphereWestIcon, CopyIcon, PlusIcon, ArrowsClockwiseIcon, ArrowSquareOutIcon, GearSixIcon, CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Dialog, Loader, useKumoToastManager } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type { DomainConfig, DomainResult, DnsRecord } from "shared/dns";
import WorkspaceFrame from "~/components/WorkspaceFrame";
import SearchSelect, { textChoices } from "~/components/SearchSelect";
import { CloudflareDomain } from "~/components/CloudflareDomain";
import api from "~/services/api";

const newDomain = (mxHost: string): DomainConfig => ({ domain: "", mxHost, mxPriority: 10, spf: "", dmarc: "v=DMARC1; p=none", dkim: [], sts: "off", tlsReports: "" });
const statusLabel = { ready: "Verified", missing: "Missing", conflict: "Needs attention", unavailable: "Lookup failed" } as const;
const keyFor = (record: DnsRecord) => `${record.type}:${record.name}`;

export function meta() { return [{ title: "Domains & DNS · NeoMail" }]; }

function DomainForm({ original, onClose, onSave, managed }: { original: DomainConfig; onClose: () => void; onSave: (data: DomainConfig) => Promise<void>; managed: boolean }) {
	const [form, setForm] = useState(original);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const update = <K extends keyof DomainConfig,>(key: K, value: DomainConfig[K]) => setForm((current) => ({ ...current, [key]: value }));
	const setKey = (index: number, changes: Partial<DomainConfig["dkim"][number]>) => update("dkim", form.dkim.map((record, i) => i === index ? { ...record, ...changes } : record));
	async function submit(event: FormEvent) {
		event.preventDefault(); setError(""); setBusy(true);
		try { await onSave(form); } catch (err) { setError(err instanceof Error ? err.message : "Could not save domain"); }
		finally { setBusy(false); }
	}
	return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
		<Dialog size="lg" className="settings-dialog max-h-[88dvh] overflow-y-auto p-6">
			<Dialog.Title className="text-xl font-semibold">{original.domain ? `DNS settings for ${original.domain}` : "Add a mail domain"}</Dialog.Title>
			<Dialog.Description className="mt-1 mb-5 text-sm text-kumo-subtle">{managed ? "Enter an active domain in your Cloudflare account. Connect incoming and outgoing mail after you add it." : "Save the expected records. Nothing changes at your DNS provider until you publish them."}</Dialog.Description>
			<form onSubmit={submit} className="space-y-5">
				<label className="field-label">Domain<input className="field-input" required value={form.domain} onChange={(event) => update("domain", event.target.value)} readOnly={!!original.domain} placeholder="example.com" maxLength={253} /></label>
				{!managed && <>
				<div className="grid gap-3 sm:grid-cols-[1fr_120px]">
					<label className="field-label">Incoming MX hostname<input className="field-input" value={form.mxHost} onChange={(event) => update("mxHost", event.target.value)} placeholder="mail.example.com" maxLength={253} /><span>Leave empty for a send-only domain or to set this later.</span></label>
					<label className="field-label">MX priority<input className="field-input" type="number" min={0} max={65535} required value={form.mxPriority} onChange={(event) => update("mxPriority", event.target.valueAsNumber)} /></label>
				</div>
				<label className="field-label">SPF TXT value<input className="field-input font-mono" value={form.spf} onChange={(event) => update("spf", event.target.value)} placeholder="v=spf1 include:your-relay.example -all" maxLength={4096} /><span>Copy the exact SPF policy from your outbound relay. Merge it into your existing SPF record if necessary.</span></label>
				<label className="field-label">DMARC TXT value<input className="field-input font-mono" value={form.dmarc} onChange={(event) => update("dmarc", event.target.value)} maxLength={4096} /><span>Start with <code>p=none</code> to monitor before enforcing a policy.</span></label>
				<fieldset className="space-y-2 rounded-xl border border-kumo-line p-3">
					<legend className="px-1 text-sm font-medium">DKIM selectors</legend>
					<p className="text-xs text-kumo-subtle">Use the public TXT value or CNAME targets supplied by your sending provider. Never paste a private key.</p>
					{form.dkim.map((record, index) => <div key={index} className="dkim-record-fields grid grid-cols-[1fr_95px_auto] items-end gap-2">
						<label className="field-label">Selector<input className="field-input" value={record.selector} maxLength={63} required onChange={(event) => setKey(index, { selector: event.target.value })} placeholder="relay" /></label>
						<SearchSelect showLabel label="Type" value={record.type} options={textChoices(["TXT", "CNAME"])} onChange={(value) => setKey(index, { type: value as "TXT" | "CNAME" })} />
						<button className="mail-button" type="button" onClick={() => update("dkim", form.dkim.filter((_, i) => i !== index))}>Remove</button>
						<label className="field-label col-span-full">Record value<input className="field-input font-mono" required maxLength={4096} value={record.value} onChange={(event) => setKey(index, { value: event.target.value })} /></label>
					</div>)}
					<button type="button" className="mail-button" disabled={form.dkim.length >= 10} onClick={() => update("dkim", [...form.dkim, { selector: "", type: "TXT", value: "" }])}><PlusIcon /> Add selector</button>
				</fieldset>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="field-label"><SearchSelect showLabel label="MTA-STS mode" value={form.sts} onChange={(value) => update("sts", value as DomainConfig["sts"])}
						options={[{ value: "off", label: "Off" }, { value: "testing", label: "Testing" }, { value: "enforce", label: "Enforce" }]} />
						<span>Test HTTPS policy hosting and valid STARTTLS before switching to Enforce.</span></div>
					<label className="field-label">TLS report address<input className="field-input" type="email" value={form.tlsReports} onChange={(event) => update("tlsReports", event.target.value)} placeholder="tls-reports@example.com" maxLength={254} /><span>Remote senders deliver reports to this address.</span></label>
				</div>
				</>}
				{error && <p role="alert" className="form-error">{error}</p>}
				<div className="flex justify-end gap-2"><button type="button" className="mail-button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="mail-button primary" disabled={busy}>{busy ? "Saving…" : original.domain ? "Save domain" : "Add domain"}</button></div>
			</form>
		</Dialog>
	</Dialog.Root>;
}

function DomainDns({ item, automatic, tls, edit, remove }: { item: DomainResult; automatic: boolean; tls: boolean; edit: () => void; remove: () => void }) {
	const toast = useKumoToastManager();
	const { config, records, policy, policyUrl } = item;
	const [confirm, setConfirm] = useState(false);
	const [removing, setRemoving] = useState(false);
	const query = useQuery({ queryKey: ["dns-check", config.domain, records], queryFn: () => api.checkDns(config.domain), enabled: false, retry: false });
	const publish = useMutation({ mutationFn: () => api.publishDns(config.domain), onSuccess: () => { setConfirm(false); void query.refetch(); } });
	const statuses = new Map(query.data?.map((record) => [keyFor(record), record]));
	const ready = query.data?.filter((record) => record.status === "ready").length;
	const copy = async (record: DnsRecord) => {
		try { await navigator.clipboard.writeText(record.value); toast.add({ title: `${record.purpose} value copied` }); }
		catch { toast.add({ title: "Select and copy the value manually", variant: "error" }); }
	};
	return <section className="settings-card min-w-0" aria-label={`DNS records for ${config.domain}`}>
		<div className="flex flex-wrap items-start justify-between gap-3">
			<div className="min-w-0"><p className="workspace-label">DNS record plan</p><h2 className="mt-1 break-all text-xl font-semibold">{config.domain}</h2>
				<p className="mt-1 text-sm text-kumo-subtle">{query.data ? `${ready} of ${records.length} records match public DNS.` : "Add the planned records, then check them against public DNS."}</p></div>
			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" size="sm" onClick={edit} icon={<GearSixIcon size={16} />}>Edit setup</Button>
				<Button variant="secondary" size="sm" disabled={!records.length} loading={query.isFetching} icon={<ArrowsClockwiseIcon size={16} />} onClick={() => query.refetch()}>Check DNS</Button>
				{automatic && <Button variant="primary" size="sm" disabled={!records.length} onClick={() => { publish.reset(); setConfirm(true); }}>Publish missing</Button>}
			</div>
		</div>
		{query.isError && <p role="alert" className="form-error mt-4">{query.error.message}</p>}
		{publish.data && <ul className="mt-4 space-y-1 rounded-lg border border-kumo-line p-3 text-sm">
			{publish.data.map((result) => <li key={keyFor(result)}><strong>{result.purpose}</strong> · {result.name} — {result.state === "conflict" ? "existing record left untouched" : result.error || result.state}</li>)}
		</ul>}
		{records.length ? <div className="mt-5 divide-y divide-kumo-line overflow-hidden rounded-xl border border-kumo-line">
			{records.map((record) => {
				const checked = statuses.get(keyFor(record));
				return <div key={keyFor(record)} className="space-y-2 p-3 md:px-4">
					<div className="flex flex-wrap items-center gap-2 text-sm"><span className="mail-label">{record.purpose} · {record.type}</span><code className="min-w-0 flex-1 break-all">{record.name}</code>
						<span className={`dns-status ${checked?.status || "unchecked"}`}>{checked?.status === "ready" && <CheckCircleIcon />}{checked?.status === "conflict" && <WarningCircleIcon />}{checked ? statusLabel[checked.status] : "Not checked"}</span>
					</div>
					<div className="flex items-start gap-2"><code className="min-w-0 flex-1 break-all rounded-md bg-kumo-recessed px-2 py-1.5 text-xs text-kumo-strong">{record.value}{record.priority !== undefined && <span className="text-kumo-subtle"> · priority {record.priority}</span>}</code>
						<Button variant="ghost" size="xs" shape="square" icon={<CopyIcon size={14} />} aria-label={`Copy ${record.purpose} value`} onClick={() => void copy(record)} /></div>
					{checked?.status === "conflict" && <p className="break-all text-xs text-kumo-subtle">Found: {checked.found.join(" · ")}</p>}
				</div>;
			})}
		</div> : <p className="mt-4 text-sm text-kumo-subtle">No records planned yet. Edit the setup to add your mail provider’s settings.</p>}
		{config.mxHost && <p className="mt-4 text-sm text-kumo-subtle">If you host the inbound listener, point <code>{config.mxHost}</code> at your server with an A/AAAA record (not proxied) and allow TCP port 25.</p>}
		{policy && policyUrl && <div className="mt-4 rounded-xl border border-kumo-line p-4">
			<h3 className="text-sm font-semibold">MTA-STS policy · {config.sts}</h3>
			<p className="mt-1 text-sm text-kumo-subtle">Point <code>mta-sts.{config.domain}</code> to this instance through an HTTPS virtual host. Keep the hostname intact in your reverse proxy.</p>
			{!tls && <p className="form-error mt-2">The built-in SMTP listener is not configured for STARTTLS. Verify TLS on your actual MX before enabling enforcement.</p>}
			<pre className="mt-2 overflow-x-auto rounded-md bg-kumo-recessed p-2 text-xs">{policy}</pre>
			<a className="mt-2 inline-flex items-center gap-1 text-sm text-kumo-link" href={policyUrl} rel="noreferrer" target="_blank">Open HTTPS policy <ArrowSquareOutIcon /></a>
		</div>}
		<div className="mt-5 flex justify-between gap-2 border-t border-kumo-line pt-4">
			<Link className="text-sm text-kumo-link" to="/mailboxes">Manage addresses →</Link><button type="button" className="text-sm text-kumo-subtle hover:underline" onClick={() => setRemoving(true)}>Remove domain</button>
		</div>
		<Dialog.Root open={confirm} onOpenChange={(open) => { if (!publish.isPending) setConfirm(open); }}><Dialog size="sm" className="settings-dialog space-y-4 p-6">
			<Dialog.Title className="font-semibold">Publish missing DNS records?</Dialog.Title>
			<Dialog.Description className="text-sm text-kumo-subtle">This creates missing records in the Cloudflare DNS zone for {config.domain}. Existing and conflicting records are not changed.</Dialog.Description>
			{publish.error && <p role="alert" className="form-error">{publish.error.message}</p>}
			<div className="flex justify-end gap-2"><Button variant="secondary" disabled={publish.isPending} onClick={() => setConfirm(false)}>Cancel</Button><Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>Publish</Button></div>
		</Dialog></Dialog.Root>
		<Dialog.Root open={removing} onOpenChange={setRemoving}><Dialog size="sm" className="settings-dialog space-y-4 p-6">
			<Dialog.Title className="font-semibold">Remove {config.domain}?</Dialog.Title><Dialog.Description className="text-sm text-kumo-subtle">Disconnect its mailboxes first. This removes the domain from this workspace without changing public DNS or deleting stored messages.</Dialog.Description>
			<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRemoving(false)}>Cancel</Button><Button variant="destructive" onClick={() => { setRemoving(false); remove(); }}>Remove</Button></div>
		</Dialog></Dialog.Root>
	</section>;
}

export default function DomainsRoute() {
	const [params, setParams] = useSearchParams();
	const [editing, setEditing] = useState<DomainConfig | null>(null);
	const cache = useQueryClient();
	const toast = useKumoToastManager();
	const query = useQuery({ queryKey: ["domain-settings"], queryFn: api.listDomains });
	const domains = query.data?.domains || [];
	const cloudflare = query.data?.platform === "cloudflare";
	const item = domains.find(({ config }) => config.domain === params.get("domain")) || domains[0];
	const invalidate = () => Promise.all([cache.invalidateQueries({ queryKey: ["domain-settings"] }), cache.invalidateQueries({ queryKey: ["config"] })]);
	const remove = useMutation({ mutationFn: api.removeDomain, onSuccess: async () => { await invalidate(); setParams({}); }, onError: (error) => toast.add({ title: error.message, variant: "error" }) });
	return <WorkspaceFrame>
		<div className="settings-page">
			<header className="settings-heading flex flex-wrap items-center justify-between gap-4"><div><p className="workspace-label">Mail settings</p><h1>Domains & DNS</h1><p>{cloudflare ? "Connect Cloudflare zones for incoming and outgoing mail." : "Plan, check, and publish the records for your mail domains."}</p></div>
				<button type="button" className="mail-button primary" disabled={!query.isSuccess} onClick={() => setEditing(cloudflare ? { ...newDomain(""), dmarc: "" } : newDomain(query.data?.defaultMxHost || ""))}><PlusIcon size={18} /> Add domain</button>
			</header>
			{query.isPending ? <Loader /> : query.isError ? <p role="alert" className="form-error">{query.error.message} <button className="mail-button" onClick={() => query.refetch()}>Retry</button></p>
				: item ? <div className="grid items-start gap-4 xl:grid-cols-[210px_minmax(0,1fr)]">
					<div className="phone-domain-switch"><SearchSelect label="Domain" showLabel value={item.config.domain} options={textChoices(domains.map(({ config }) => config.domain))}
						searchPlaceholder="Search domains…" icon={<GlobeHemisphereWestIcon size={18} />} onChange={(domain) => setParams({ domain })} /></div>
					<nav aria-label="Configured domains" className="desktop-domain-list settings-card flex flex-wrap gap-1 xl:flex-col xl:p-3">
						{domains.map(({ config }) => <button type="button" key={config.domain} className={`mail-nav-link min-w-0 ${item.config.domain === config.domain ? "active" : ""}`} aria-pressed={item.config.domain === config.domain} onClick={() => setParams({ domain: config.domain })}><GlobeHemisphereWestIcon className="shrink-0" size={18} /><span className="truncate">{config.domain}</span></button>)}
					</nav>
					<div key={item.config.domain} className="min-w-0 space-y-4">
						{cloudflare && <CloudflareDomain domain={item.config.domain} configured={!!query.data?.cloudflareConfigured} />}
						{(() => {
							const panel = <DomainDns item={item} automatic={!!query.data?.autoPublish} tls={!!query.data?.smtpTls} edit={() => setEditing(item.config)} remove={() => remove.mutate(item.config.domain)} />;
							return cloudflare ? <details><summary className="mb-2 cursor-pointer text-sm text-kumo-subtle">Advanced DNS settings & domain removal</summary>{panel}</details> : panel;
						})()}
					</div>
				</div> : <section className="settings-card py-12 text-center"><GlobeHemisphereWestIcon size={32} className="mx-auto mb-3 text-kumo-subtle" /><h2 className="font-semibold">Connect your first domain</h2><p className="mt-1 text-sm text-kumo-subtle">{cloudflare ? "Add a domain from your Cloudflare account, connect mail, then create inboxes." : "After adding a domain, create an address in Mailboxes and point your DNS at your mail host."}</p></section>}
			{editing && <DomainForm original={editing} managed={cloudflare && !editing.domain} onClose={() => setEditing(null)} onSave={async (config) => {
				const result = editing.domain ? await api.updateDomain(config) : await api.addDomain(config);
				await invalidate(); setParams({ domain: result.config.domain }); setEditing(null); toast.add({ title: "Domain settings saved" });
			}} />}
		</div>
	</WorkspaceFrame>;
}
