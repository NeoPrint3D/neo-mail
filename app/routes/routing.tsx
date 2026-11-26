import { Badge, Dialog, Loader, useKumoToastManager } from "@cloudflare/kumo";
import Button from "~/components/Button";
import {
	ArrowRightIcon,
	CloudArrowUpIcon,
	EnvelopeSimpleIcon,
	PencilSimpleIcon,
	PlusIcon,
	ProhibitIcon,
	ShareNetworkIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type { CloudflareRoutingSyncResult, InboxForwardingRule, RoutingAction, RoutingMatchType, RoutingRule, RoutingRuleInput } from "shared/routing";
import InboxForwardingForm from "~/components/InboxForwardingForm";
import { ForwardingDestinations } from "~/components/ForwardingDestinations";
import MailWebhooks from "~/components/MailWebhooks";
import MailboxSelect from "~/components/MailboxSelect";
import SearchSelect, { textChoices } from "~/components/SearchSelect";
import WorkspaceFrame from "~/components/WorkspaceFrame";
import ForwardingAddresses, { forwardingAddresses } from "~/components/ForwardingAddresses";
import { useConfig, useMailboxes } from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import type { Mailbox } from "~/types";

export function meta() {
	return [{ title: "Email routing · NeoMail" }];
}

function splitLocalPart(rule: RoutingRule) {
	return rule.matchType === "catch_all" ? "" : rule.address.split("@")[0] || "";
}

type RuleSource = RoutingMatchType | "mailbox";

function RuleDialog({
	domains,
	mailboxes,
	initial,
	initialInbox,
	defaultDomain,
	cloudflare,
	onClose,
	onSave,
}: {
	domains: string[];
	mailboxes: Mailbox[];
	initial: RoutingRule | null;
	initialInbox: string | null;
	defaultDomain: string;
	cloudflare: boolean;
	onClose: () => void;
	onSave: (input: RoutingRuleInput) => Promise<void>;
}) {
	const [domain, setDomain] = useState(initial?.domain || defaultDomain || domains[0] || "");
	const [source, setSource] = useState<RuleSource>(initialInbox ? "mailbox" : initial?.matchType || "exact");
	const [mailboxId, setMailboxId] = useState(initialInbox || "");
	const [localPart, setLocalPart] = useState(initial ? splitLocalPart(initial) : "");
	const [action, setAction] = useState<RoutingAction>(initial?.action || "forward");
	const [destinations, setDestinations] = useState(initial?.forwardTo ?? []);
	const [alsoLocalCopy, setAlsoLocalCopy] = useState(Boolean(initial?.action === "forward" && initial.deliverTo));
	const [deliverTo, setDeliverTo] = useState(initial?.deliverTo || mailboxes[0]?.id || "");
	const [rejectReason, setRejectReason] = useState(initial?.rejectReason || "Mailbox unavailable");
	const [note, setNote] = useState(initial?.note || "");
	const [enabled, setEnabled] = useState(initial ? initial.enabled : true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const address = `${localPart.trim().toLowerCase()}@${domain}`;
	const matchingMailbox = source === "exact" ? mailboxes.find((mailbox) => mailbox.email === address) : undefined;
	const isInbox = source === "mailbox" || (!initial && !!matchingMailbox);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (busy || source === "mailbox" || matchingMailbox) return;
		setError("");
		const targets = forwardingAddresses(destinations);
		if (action === "forward" && !targets.length) { setError("Add at least one forwarding destination."); return; }
		if (action === "forward" && alsoLocalCopy && !deliverTo) { setError("Select a local mailbox to keep a copy in."); return; }
		const resolvedDeliverTo = action === "mailbox"
			? (deliverTo || null)
			: action === "forward" && alsoLocalCopy
				? (deliverTo || null)
				: null;

		setBusy(true);
		try {
			await onSave({
				domain,
				matchType: source,
				localPart: source === "exact" ? localPart.trim().toLowerCase() : "",
				action,
				forwardTo: action === "reject" ? [] : targets,
				deliverTo: resolvedDeliverTo,
				rejectReason: rejectReason.trim() || "Mailbox unavailable",
				enabled,
				note: note.trim(),
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not save routing rule");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
			<Dialog size="lg" className="settings-dialog max-h-[88dvh] overflow-y-auto p-6">
				<Dialog.Title className="text-xl font-semibold">
					{initial ? `Edit route · ${initial.address}` : initialInbox ? `Edit forwarding · ${initialInbox}` : isInbox ? "Inbox forwarding" : "Add routing rule"}
				</Dialog.Title>
				<Dialog.Description className="mt-1 mb-5 text-sm text-kumo-subtle">
					{initialInbox ? "Update forwarding destinations and whether a copy is kept in this Inbox." : "Forward mail from an existing inbox, or set up a rule for an alias or catch-all."}
				</Dialog.Description>
				{!initialInbox && <div className="mb-4 space-y-4">
					<div className="grid gap-3 sm:grid-cols-2">
						<SearchSelect showLabel label="Match rule" value={source} disabled={busy} onChange={(value) => setSource(value as RuleSource)}
							options={[{ value: "exact", label: "Specific address" }, ...(!initial && mailboxes.length ? [{ value: "mailbox", label: "Existing inbox" }] : []), { value: "catch_all", label: `Catch-all (*@${domain || "domain"})` }]} />
						{source === "mailbox"
							? <MailboxSelect mailboxes={mailboxes} value={mailboxId} onChange={setMailboxId} showLabel label="Inbox to forward" disabled={busy} />
							: <SearchSelect showLabel label="Domain" value={domain} options={textChoices(domains)} searchPlaceholder="Search domains…" onChange={setDomain} disabled={busy} />}
					</div>

					{source === "exact" && (
						<label className="field-label">
							Email address
							<div className="flex items-center gap-2">
								<input
									className="field-input flex-1"
									value={localPart}
									onChange={(e) => setLocalPart(e.target.value)}
									onPaste={(event) => {
										const [prefix, host, extra] = event.clipboardData.getData("text").trim().toLowerCase().split("@");
										if (prefix && prefix.length <= 64 && domains.includes(host) && extra === undefined) {
											event.preventDefault();
											setLocalPart(prefix);
											setDomain(host);
										}
									}}
									placeholder="sales"
									maxLength={64}
									required
									form={isInbox ? "inbox-forwarding-form" : "routing-rule-form"}
									disabled={busy}
									inputMode="email"
									autoCapitalize="none"
									autoComplete="off"
								/>
								<span className="text-sm text-kumo-subtle">@{domain}</span>
							</div>
						</label>
					)}
				</div>}

				{isInbox ? <InboxForwardingForm mailboxId={matchingMailbox?.id ?? mailboxId} initialTargets={destinations}
					busy={busy} setBusy={setBusy} cloudflare={cloudflare} onClose={onClose} /> : (
				<form id="routing-rule-form" onSubmit={submit} className="space-y-4">
					{matchingMailbox && <p className="form-error" role="alert">This address is an inbox. Choose a different address for this alias, or add inbox forwarding separately.</p>}
					<SearchSelect showLabel label="Routing action" value={action} onChange={(value) => setAction(value as RoutingAction)}
						options={[{ value: "forward", label: "Forward directly to email(s)" }, { value: "mailbox", label: "Deliver to a local mailbox" }, { value: "reject", label: "Reject incoming mail (550)" }]} />

					{action === "forward" && (
						<div className="space-y-3 rounded-xl border border-kumo-line bg-kumo-recessed p-4">
							<ForwardingAddresses label="Forward directly to" value={destinations} onChange={setDestinations} disabled={busy} description="Add up to 10 addresses, or paste a list." />
							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									className="workspace-check"
									checked={alsoLocalCopy}
									onChange={(e) => setAlsoLocalCopy(e.target.checked)}
								/>
								Also keep a copy in a local mailbox
							</label>
							{alsoLocalCopy && <MailboxSelect mailboxes={mailboxes} value={deliverTo} onChange={setDeliverTo}
								showLabel label="Local copy mailbox" allowCreate preferredDomain={domain} />}
						</div>
					)}

					{action === "mailbox" && (
						<div className="space-y-3 rounded-xl border border-kumo-line bg-kumo-recessed p-4">
							<MailboxSelect mailboxes={mailboxes} value={deliverTo} onChange={setDeliverTo} showLabel label="Deliver to local mailbox" allowCreate preferredDomain={domain} />
							<p className="text-xs text-kumo-subtle">Mail to this alias appears in that mailbox and lets you reply from this alias.</p>
							<ForwardingAddresses label="Also forward copies to (optional)" value={destinations} onChange={setDestinations} disabled={busy} />
						</div>
					)}

					{action === "reject" && (
						<label className="field-label">
							SMTP rejection message
							<input
								className="field-input"
								value={rejectReason}
								onChange={(e) => setRejectReason(e.target.value)}
								maxLength={200}
								placeholder="Mailbox unavailable"
							/>
						</label>
					)}

					<div className="grid gap-3 sm:grid-cols-2">
						<label className="field-label">
							Label / note (optional)
							<input
								className="field-input"
								value={note}
								onChange={(e) => setNote(e.target.value)}
								maxLength={200}
								placeholder="Billing forwarder"
							/>
						</label>
						<label className="flex items-center gap-2 pt-5 text-sm">
							<input
								type="checkbox"
								className="workspace-check"
								checked={enabled}
								onChange={(e) => setEnabled(e.target.checked)}
							/>
							Rule enabled
						</label>
					</div>

					{error && <p role="alert" className="form-error">{error}</p>}
					<div className="flex justify-end gap-2 pt-2">
						<button type="button" className="mail-button" onClick={onClose} disabled={busy}>
							Cancel
						</button>
						<button
							type="submit"
							className="mail-button primary"
							disabled={busy || !!matchingMailbox || ((action === "mailbox" || (action === "forward" && alsoLocalCopy)) && !deliverTo)}
						>
							{busy ? "Saving…" : initial ? "Save rule" : "Create rule"}
						</button>
					</div>
				</form>
				)}
			</Dialog>
		</Dialog.Root>
	);
}

export default function RoutingRoute() {
	const [params, setParams] = useSearchParams();
	const selectedDomain = params.get("domain") || "";
	const toast = useKumoToastManager();
	const cache = useQueryClient();

	const { data: config } = useConfig();
	const mailboxQuery = useMailboxes();
	const mailboxes = mailboxQuery.data ?? [];
	const routing = useQuery({
		queryKey: ["routing", selectedDomain],
		queryFn: () => api.listRouting(selectedDomain || undefined),
	});

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<RoutingRule | null>(null);
	const [editingInbox, setEditingInbox] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<RoutingRule | null>(null);
	const [deletingInbox, setDeletingInbox] = useState<InboxForwardingRule | null>(null);
	const [syncDomain, setSyncDomain] = useState<string | null>(null);
	const [syncResults, setSyncResults] = useState<CloudflareRoutingSyncResult[] | null>(null);

	const domains = config?.domains ?? [];
	const rules = routing.data?.rules ?? [];
	const inboxForwarding = routing.data?.inboxForwarding ?? [];

	const refresh = async () => {
		await Promise.all([
			cache.invalidateQueries({ queryKey: ["routing"] }),
			cache.invalidateQueries({ queryKey: queryKeys.mailboxes.all }),
			cache.invalidateQueries({ queryKey: ["webhooks"] }),
		]);
	};

	const saveRule = useMutation({
		mutationFn: (input: RoutingRuleInput) =>
			editing ? api.updateRoutingRule(editing.id, input) : api.createRoutingRule(input),
		onSuccess: async () => {
			await refresh();
			toast.add({ title: editing ? "Routing rule updated" : "Routing rule created" });
			setDialogOpen(false);
			setEditing(null);
		},
	});

	const toggleRule = useMutation({
		mutationFn: (rule: RoutingRule) =>
			api.updateRoutingRule(rule.id, {
				domain: rule.domain,
				matchType: rule.matchType,
				localPart: splitLocalPart(rule),
				action: rule.action,
				forwardTo: rule.forwardTo,
				deliverTo: rule.deliverTo,
				rejectReason: rule.rejectReason,
				enabled: !rule.enabled,
				note: rule.note,
			}),
		onSuccess: async (updated) => {
			await refresh();
			toast.add({ title: updated.enabled ? `Enabled ${updated.address}` : `Paused ${updated.address}` });
		},
		onError: (err) => toast.add({ title: err instanceof Error ? err.message : "Could not update rule", variant: "error" }),
	});

	const removeRule = useMutation({
		mutationFn: (id: string) => api.deleteRoutingRule(id),
		onSuccess: async () => {
			await refresh();
			toast.add({ title: "Routing rule removed" });
			setDeleting(null);
		},
		onError: (err) => toast.add({ title: err instanceof Error ? err.message : "Could not delete rule", variant: "error" }),
	});

	const toggleInboxForwarding = useMutation({
		mutationFn: (fwd: InboxForwardingRule) =>
			api.updateMailboxForwarding(fwd.mailboxId, { enabled: !fwd.enabled, targets: fwd.forwardTo, keepCopy: fwd.keepCopy }),
		onSuccess: async (_data, fwd) => {
			await Promise.all([
				refresh(),
				cache.invalidateQueries({ queryKey: queryKeys.mailboxes.detail(fwd.mailboxId) }),
			]);
			toast.add({ title: !fwd.enabled ? `Enabled forwarding for ${fwd.mailboxId}` : `Paused forwarding for ${fwd.mailboxId}` });
		},
		onError: (err) => toast.add({ title: err instanceof Error ? err.message : "Could not update forwarding", variant: "error" }),
	});

	const removeInboxForwarding = useMutation({
		mutationFn: (mailboxId: string) =>
			api.updateMailboxForwarding(mailboxId, { enabled: false, targets: [], keepCopy: true }),
		onSuccess: async (_data, mailboxId) => {
			await Promise.all([
				refresh(),
				cache.invalidateQueries({ queryKey: queryKeys.mailboxes.detail(mailboxId) }),
			]);
			toast.add({ title: `Forwarding removed for ${mailboxId}` });
			setDeletingInbox(null);
		},
		onError: (err) => toast.add({ title: err instanceof Error ? err.message : "Could not remove forwarding", variant: "error" }),
	});

	const syncCloudflare = useMutation({
		mutationFn: (domain: string) => api.syncCloudflareRouting(domain),
		onSuccess: (results) => {
			setSyncResults(results);
			setSyncDomain(null);
			toast.add({ title: "Cloudflare Email Routing sync finished" });
		},
		onError: (err) => toast.add({ title: err instanceof Error ? err.message : "Sync failed", variant: "error" }),
	});

	const activeDomainForSync = selectedDomain || domains[0] || "";
	const cloudflare = routing.data?.platform === "cloudflare";

	return (
		<WorkspaceFrame>
			<div className="settings-page">
				<header className="settings-heading flex flex-wrap items-center justify-between gap-4">
					<div>
						<p className="workspace-label">
							<ShareNetworkIcon className="mr-1 inline" /> Mail routing
						</p>
						<h1>Email routing & aliases</h1>
						<p>Forward mail from an existing inbox, or route aliases and catch-alls.</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{routing.data?.cloudflareSyncAvailable && activeDomainForSync && (
							<Button
								variant="secondary"
								size="sm"
								icon={<CloudArrowUpIcon size={16} />}
								onClick={() => {
									setSyncResults(null);
									setSyncDomain(activeDomainForSync);
								}}
							>
								Sync {activeDomainForSync} to Cloudflare
							</Button>
						)}
						<Button
							variant="primary"
							icon={<PlusIcon size={16} />}
							disabled={!domains.length || mailboxQuery.isPending}
							onClick={() => {
								setEditing(null);
								setEditingInbox(null);
								setDialogOpen(true);
							}}
						>
							Add routing rule
						</Button>
					</div>
				</header>

				<section className="settings-card flex flex-wrap items-center justify-between gap-3">
					<div className="space-y-1 text-sm">
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="secondary">
								{cloudflare ? "Cloudflare Email Routing" : routing.data?.smtpInboundPort
									? `Inbound SMTP listening on :${routing.data.smtpInboundPort}`
									: "Inbound SMTP off (SMTP_INBOUND_PORT=0)"}
							</Badge>
							<Badge variant="secondary">
								{cloudflare ? "Forwarding requires verified destinations" : routing.data?.smtpOutboundAvailable
									? "Outbound forwarding relay ready"
									: "Set SMTP_URL to forward to external emails"}
							</Badge>
							{routing.data?.inboundWebhookEnabled && (
								<Badge variant="secondary">Webhook relay (/api/inbound) active</Badge>
							)}
						</div>
						<p className="text-xs text-kumo-subtle">
							To forward an existing inbox, choose it when adding a routing rule. You can keep a copy in the inbox.
						</p>
					</div>
					<div className="routing-domain-filter w-48 max-w-full">
						<SearchSelect label="Filter routing rules by domain" value={selectedDomain} searchPlaceholder="Search domains…"
							options={[{ value: "", label: "All domains" }, ...textChoices(domains)]} onChange={(value) => setParams(value ? { domain: value } : {})} />
					</div>
				</section>

				{cloudflare && routing.data?.forwardingVerification && activeDomainForSync && <ForwardingDestinations key={activeDomainForSync} domain={activeDomainForSync} />}

				{syncResults && (
					<section className="settings-card space-y-2">
						<div className="flex items-center justify-between">
							<h2 className="text-sm font-semibold">Cloudflare Email Routing sync results</h2>
							<button type="button" className="text-xs text-kumo-subtle hover:underline" onClick={() => setSyncResults(null)}>
								Dismiss
							</button>
						</div>
						<ul className="space-y-1 text-xs">
							{syncResults.map((item) => (
								<li key={item.ruleId}>
									<strong>{item.address}</strong> — {item.state}
									{item.detail ? `: ${item.detail}` : ""}
								</li>
							))}
						</ul>
					</section>
				)}

				{routing.isPending ? (
					<div className="py-12"><Loader /></div>
				) : routing.isError ? (
					<p role="alert" className="form-error">
						{routing.error.message}
					</p>
				) : !domains.length ? (
					<section className="settings-card py-12 text-center">
						<ShareNetworkIcon size={32} className="mx-auto mb-3 text-kumo-subtle" />
						<h2 className="font-semibold">Add a domain first</h2>
						<p className="mt-1 text-sm text-kumo-subtle">
							Connect a domain in <Link to="/domains" className="text-kumo-link">Domains & DNS</Link> before creating alias rules.
						</p>
					</section>
				) : !rules.length && !inboxForwarding.length ? (
					<section className="settings-card py-12 text-center">
						<ShareNetworkIcon size={32} className="mx-auto mb-3 text-kumo-subtle" />
						<h2 className="font-semibold">No routing or forwarding rules yet</h2>
						<p className="mt-1 text-sm text-kumo-subtle">
							Forward an existing inbox, or create an alias like <code>sales@{domains[0]}</code> or a catch-all.
						</p>
					</section>
				) : (
					<section className="settings-card overflow-hidden p-0">
						<ul className="divide-y divide-kumo-line">
							{inboxForwarding.map((fwd) => (
								<li key={`inbox:${fwd.mailboxId}`} className="routing-rule-row flex flex-wrap items-center gap-3 px-4 py-3.5 md:px-5">
									<div className="min-w-0 flex-1 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<code className="break-all text-sm font-semibold">{fwd.mailboxId}</code>
											<Badge variant="secondary">Inbox forwarding</Badge>
											{!fwd.enabled && <Badge variant="outline">Paused</Badge>}
										</div>
										<div className="flex flex-wrap items-center gap-2 text-xs text-kumo-subtle">
											{fwd.forwardTo.length > 0 && (
												<span className="inline-flex min-w-0 items-center gap-1 [overflow-wrap:anywhere] text-kumo-strong">
													<ArrowRightIcon size={13} className="shrink-0" /> Forwards to {fwd.forwardTo.join(", ")}
												</span>
											)}
											<span className="inline-flex min-w-0 items-center gap-1 [overflow-wrap:anywhere] text-kumo-strong">
												<EnvelopeSimpleIcon size={13} className="shrink-0" />
												{fwd.keepCopy ? `Copy in ${fwd.mailboxId}` : "Forward only (no local copy)"}
											</span>
										</div>
									</div>
									<div className="routing-rule-actions flex items-center gap-1.5">
										<Button
											variant="ghost"
											size="sm"
											disabled={toggleInboxForwarding.isPending || !fwd.forwardTo.length}
											onClick={() => toggleInboxForwarding.mutate(fwd)}
										>
											{fwd.enabled ? "Pause" : "Enable"}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											shape="square"
											aria-label={`Edit forwarding for ${fwd.mailboxId}`}
											icon={<PencilSimpleIcon size={15} />}
											onClick={() => {
												setEditing(null);
												setEditingInbox(fwd.mailboxId);
												setDialogOpen(true);
											}}
										/>
										<Button
											variant="ghost"
											size="sm"
											shape="square"
											aria-label={`Remove forwarding for ${fwd.mailboxId}`}
											icon={<TrashIcon size={15} />}
											onClick={() => setDeletingInbox(fwd)}
										/>
									</div>
								</li>
							))}
							{rules.map((rule) => (
								<li key={rule.id} className="routing-rule-row flex flex-wrap items-center gap-3 px-4 py-3.5 md:px-5">
									<div className="min-w-0 flex-1 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<code className="break-all text-sm font-semibold">{rule.address}</code>
											<Badge variant="secondary">
												{rule.matchType === "catch_all" ? "Catch-all" : "Alias"}
											</Badge>
											{!rule.enabled && <Badge variant="outline">Paused</Badge>}
											{rule.note && <span className="text-xs text-kumo-subtle">· {rule.note}</span>}
										</div>
										<div className="flex flex-wrap items-center gap-2 text-xs text-kumo-subtle">
											{rule.action === "reject" ? (
												<span className="inline-flex items-center gap-1 text-kumo-danger">
													<ProhibitIcon size={14} /> Rejects: {rule.rejectReason}
												</span>
											) : (
												<>
													{rule.forwardTo.length > 0 && (
														<span className="inline-flex min-w-0 items-center gap-1 [overflow-wrap:anywhere] text-kumo-strong">
															<ArrowRightIcon size={13} className="shrink-0" /> Forwards to {rule.forwardTo.join(", ")}
														</span>
													)}
													{rule.deliverTo && (
														<span className="inline-flex min-w-0 items-center gap-1 [overflow-wrap:anywhere] text-kumo-strong">
															<EnvelopeSimpleIcon size={13} className="shrink-0" />
															{rule.forwardTo.length ? `Copy in ${rule.deliverTo}` : `Delivers to ${rule.deliverTo}`}
														</span>
													)}
												</>
											)}
										</div>
									</div>
									<div className="routing-rule-actions flex items-center gap-1.5">
										<Button
											variant="ghost"
											size="sm"
											disabled={toggleRule.isPending}
											onClick={() => toggleRule.mutate(rule)}
										>
											{rule.enabled ? "Pause" : "Enable"}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											shape="square"
											aria-label={`Edit ${rule.address}`}
											icon={<PencilSimpleIcon size={15} />}
											onClick={() => {
												setEditing(rule);
												setDialogOpen(true);
											}}
										/>
										<Button
											variant="ghost"
											size="sm"
											shape="square"
											aria-label={`Delete ${rule.address}`}
											icon={<TrashIcon size={15} />}
											onClick={() => setDeleting(rule)}
										/>
									</div>
								</li>
							))}
						</ul>
					</section>
				)}
				<MailWebhooks domains={domains} selectedDomain={selectedDomain} />
			</div>

			{dialogOpen && (
				<RuleDialog
					domains={domains}
					mailboxes={mailboxes}
					initial={editing}
					initialInbox={editingInbox}
					defaultDomain={selectedDomain}
					cloudflare={cloudflare}
					onClose={() => {
						setDialogOpen(false);
						setEditing(null);
						setEditingInbox(null);
					}}
					onSave={async (input) => {
						await saveRule.mutateAsync(input);
					}}
				/>
			)}

			<Dialog.Root open={!!deletingInbox} onOpenChange={(open) => { if (!open && !removeInboxForwarding.isPending) setDeletingInbox(null); }}>
				<Dialog size="sm" className="settings-dialog space-y-4 p-6">
					<Dialog.Title className="font-semibold">Remove forwarding for {deletingInbox?.mailboxId}?</Dialog.Title>
					<Dialog.Description className="text-sm text-kumo-subtle">
						Incoming mail will still be delivered to this inbox, but it will stop forwarding to external addresses.
					</Dialog.Description>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" disabled={removeInboxForwarding.isPending} onClick={() => setDeletingInbox(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							loading={removeInboxForwarding.isPending}
							onClick={() => { if (deletingInbox) removeInboxForwarding.mutate(deletingInbox.mailboxId); }}
						>
							Remove
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>

			<Dialog.Root open={!!deleting} onOpenChange={(open) => { if (!open && !removeRule.isPending) setDeleting(null); }}>
				<Dialog size="sm" className="settings-dialog space-y-4 p-6">
					<Dialog.Title className="font-semibold">Remove {deleting?.address}?</Dialog.Title>
					<Dialog.Description className="text-sm text-kumo-subtle">
						Mail to this address will no longer match this rule. Existing messages already saved in mailboxes are kept.
					</Dialog.Description>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" disabled={removeRule.isPending} onClick={() => setDeleting(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							loading={removeRule.isPending}
							onClick={() => { if (deleting) removeRule.mutate(deleting.id); }}
						>
							Remove
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>

			<Dialog.Root open={!!syncDomain} onOpenChange={(open) => { if (!open && !syncCloudflare.isPending) setSyncDomain(null); }}>
				<Dialog size="sm" className="settings-dialog space-y-4 p-6">
					<Dialog.Title className="font-semibold">Sync {syncDomain} to Cloudflare Email Routing?</Dialog.Title>
					<Dialog.Description className="text-sm text-kumo-subtle">
						This creates or updates matching forward and catch-all rules in Cloudflare Email Routing using your configured token. Destination addresses must be verified in Cloudflare Email Routing first.
					</Dialog.Description>
					{syncCloudflare.error && <p role="alert" className="form-error">{syncCloudflare.error.message}</p>}
					<div className="flex justify-end gap-2">
						<Button variant="secondary" disabled={syncCloudflare.isPending} onClick={() => setSyncDomain(null)}>
							Cancel
						</Button>
						<Button
							variant="primary"
							loading={syncCloudflare.isPending}
							onClick={() => { if (syncDomain) syncCloudflare.mutate(syncDomain); }}
						>
							Sync rules
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</WorkspaceFrame>
	);
}
