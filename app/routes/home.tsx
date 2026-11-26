// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { Loader, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowLeftIcon, ArrowRightIcon, AtIcon, DotsThreeIcon, GearSixIcon, GlobeHemisphereWestIcon, MagnifyingGlassIcon, PlusIcon, ShareNetworkIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Link } from "react-router";
import AppDialog from "~/components/AppDialog";
import CreateMailboxDialog, { availableAddresses } from "~/components/CreateMailboxDialog";
import WorkspaceFrame from "~/components/WorkspaceFrame";
import { useConfig, useDeleteMailbox, useMailboxes } from "~/queries/mailboxes";
import type { Mailbox } from "~/types";

export function meta() { return [{ title: "Mailboxes · NeoMail" }]; }

export default function MailboxesRoute() {
	const toast = useKumoToastManager();
	const mailboxesQuery = useMailboxes();
	const configQuery = useConfig();
	const disconnect = useDeleteMailbox();
	const [query, setQuery] = useState("");
	const [creating, setCreating] = useState<string | null>(null);
	const [selectedMailbox, setSelectedMailbox] = useState<Mailbox | null>(null);
	const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
	const [disconnecting, setDisconnecting] = useState<Mailbox | null>(null);
	const config = configQuery.data;
	const mailboxes = mailboxesQuery.data || [];
	const domains = [...new Set([...(config?.domains ?? []), ...mailboxes.map((mailbox) => mailbox.domain)])].sort();
	const terms = query.trim().toLowerCase().split(/\s+/);
	const groups = domains.map((domain) => ({ domain, entries: mailboxes.filter((box) => box.domain === domain && terms.every((term) => `${box.name} ${box.email}${box.disposable ? " disposable" : ""}`.toLowerCase().includes(term))) }))
		.filter(({ domain, entries }) => entries.length || terms.every((term) => domain.includes(term)));
	const allowed = availableAddresses(config, mailboxes);
	const canAddTo = (domain: string) => config?.domains.includes(domain) && (!config.emailAddresses.length || allowed.some((email) => email.endsWith(`@${domain}`)));

	async function disconnectMailbox() {
		if (!disconnecting) return;
		try {
			await disconnect.mutateAsync(disconnecting.id);
			toast.add({ title: `Disconnected ${disconnecting.email}` }); setDisconnecting(null);
		} catch (error) { toast.add({ title: error instanceof Error ? error.message : "Could not disconnect mailbox", variant: "error" }); }
	}

	return <WorkspaceFrame>
		<div className="settings-page mailbox-directory">
			<div className="directory-content">
				<Link to="/" className="directory-back"><ArrowLeftIcon size={19} />All inboxes</Link>
				<header className="directory-heading"><div className="min-w-0"><h1>Mailboxes</h1><p>{mailboxes.length} {mailboxes.length === 1 ? "address" : "addresses"} across {domains.length} {domains.length === 1 ? "domain" : "domains"}</p></div>
					<button className="mail-button primary" type="button" onClick={() => setCreating("")}><PlusIcon size={19} />Add mailbox</button>
				</header>
				{mailboxes.length > 0 && <div className="phone-picker-search"><MagnifyingGlassIcon size={19} aria-hidden="true" />
					<input type="search" autoComplete="off" autoCapitalize="none" aria-label="Find a mailbox" placeholder="Find a mailbox" value={query} onChange={(event) => setQuery(event.target.value)} />
					{query && <button className="mail-icon-button" type="button" aria-label="Clear mailbox search" onClick={() => setQuery("")}><XIcon size={18} /></button>}
				</div>}
				{configQuery.isPending || mailboxesQuery.isPending ? <div className="grid place-items-center py-12" role="status" aria-label="Loading mailboxes"><Loader /></div>
					: configQuery.isError || mailboxesQuery.isError ? <div role="alert" className="settings-card"><p className="mb-3">Could not load the mailbox directory.</p><button className="mail-button" type="button" onClick={() => { void configQuery.refetch(); void mailboxesQuery.refetch(); }}>Retry</button></div>
					: !domains.length ? <section className="settings-card space-y-3"><h2 className="font-semibold">Connect a domain to get started</h2><p className="text-sm text-kumo-subtle">Once a domain is connected, you can add addresses on it here.</p><Link className="mail-button primary" to="/domains"><GlobeHemisphereWestIcon size={19} />Domains &amp; DNS</Link></section>
					: !groups.length ? <p className="py-10 text-center text-sm text-kumo-subtle">No mailboxes match your search.</p>
					: groups.map(({ domain, entries }) => <section key={domain} aria-label={domain} className="directory-group">
						<header><div className="min-w-0 flex-1"><h2>{domain}</h2><p>{config?.domains.includes(domain) ? `${entries.length} ${entries.length === 1 ? "mailbox" : "mailboxes"}` : "Domain not registered"}</p></div>
							<button className="mail-icon-button" aria-label={`Actions for ${domain}`} type="button" onClick={() => setSelectedDomain(domain)}><DotsThreeIcon size={24} weight="bold" /></button></header>
						{entries.length ? <ul className="divide-y divide-kumo-line">
							{entries.map((mailbox) => <li key={mailbox.id} className="directory-row">
								<Link to={`/mailbox/${encodeURIComponent(mailbox.id)}/emails/inbox`}>
									<span className="mail-avatar" aria-hidden="true">{(mailbox.name || mailbox.email).charAt(0).toUpperCase()}</span>
									<span className="min-w-0"><strong>{mailbox.name}</strong><span className="directory-address">{mailbox.email}</span>{mailbox.disposable && <span className="mail-label mt-1">Disposable</span>}</span>
								</Link>
								<button className="mail-icon-button" aria-label={`Actions for ${mailbox.email}`} type="button" onClick={() => setSelectedMailbox(mailbox)}><DotsThreeIcon size={24} weight="bold" /></button>
							</li>)}
						</ul> : <p className="px-4 py-4 text-sm text-kumo-subtle">No addresses on this domain{query.trim() ? " match your search" : ""}.</p>}
					</section>)}
				{!!domains.length && !query.trim() && <Link to="/domains" className="directory-back"><GlobeHemisphereWestIcon size={19} />Manage domains <ArrowRightIcon size={15} /></Link>}
			</div>
		</div>
		{creating !== null && <CreateMailboxDialog preferredDomain={creating} onClose={() => setCreating(null)} />}
		{selectedMailbox && <AppDialog title={selectedMailbox.name} description={selectedMailbox.email} icon={<AtIcon size={23} />} onClose={() => setSelectedMailbox(null)}>
			<div className="reader-action-list"><Link className="mail-nav-link" to={`/mailbox/${encodeURIComponent(selectedMailbox.id)}/settings`}><GearSixIcon size={20} />Mailbox settings</Link>
				<button className="mail-nav-link text-kumo-danger" type="button" onClick={() => { disconnect.reset(); setDisconnecting(selectedMailbox); setSelectedMailbox(null); }}><TrashIcon size={20} />Disconnect mailbox</button></div>
		</AppDialog>}
		{selectedDomain && <AppDialog title={selectedDomain} description="Choose what to view or manage on this domain." icon={<GlobeHemisphereWestIcon size={23} />} onClose={() => setSelectedDomain(null)}>
			<div className="reader-action-list"><Link className="mail-nav-link" to={`/?${new URLSearchParams({ domain: selectedDomain })}`}><ArrowRightIcon size={20} />View domain mail</Link>
				{canAddTo(selectedDomain) && <button className="mail-nav-link" type="button" onClick={() => { setCreating(selectedDomain); setSelectedDomain(null); }}><PlusIcon size={20} />Add address</button>}
				<Link className="mail-nav-link" to={`/domains?${new URLSearchParams({ domain: selectedDomain })}`}><GlobeHemisphereWestIcon size={20} />Domains &amp; DNS</Link>
				<Link className="mail-nav-link" to={`/routing?${new URLSearchParams({ domain: selectedDomain })}`}><ShareNetworkIcon size={20} />Routing rules</Link></div>
		</AppDialog>}
		{disconnecting && <AppDialog title="Disconnect mailbox?" description={<>Mail will stop arriving for <strong>{disconnecting.email}</strong>. Existing mail and attachments stay in storage. Re-add the address to reconnect it.</>}
			icon={<TrashIcon size={22} />} busy={disconnect.isPending} onClose={() => setDisconnecting(null)}
			actions={<button className="mail-button danger" type="button" disabled={disconnect.isPending} onClick={() => void disconnectMailbox()}>{disconnect.isPending ? "Disconnecting…" : "Disconnect"}</button>}>
			{disconnect.isError && <p role="alert" className="form-error">{disconnect.error.message}</p>}
		</AppDialog>}
	</WorkspaceFrame>;
}
