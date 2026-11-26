import { useKumoToastManager } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { AtIcon, EnvelopeSimpleIcon, GlobeHemisphereWestIcon } from "@phosphor-icons/react";
import { useId, useRef, useState, type RefObject } from "react";
import { Link } from "react-router";
import { z } from "zod";
import { useConfig, useCreateMailbox, useMailboxes } from "~/queries/mailboxes";
import type { Mailbox } from "~/types";
import AppDialog from "./AppDialog";
import SearchSelect, { textChoices } from "./SearchSelect";

const emailSchema = z.string().max(254).email();
export function availableAddresses(config: { domains: string[]; emailAddresses: string[] } | undefined, mailboxes: readonly Mailbox[]) {
	const existing = new Set(mailboxes.map((mailbox) => mailbox.email));
	return config?.emailAddresses.filter((email) => config.domains.includes(email.split("@").at(-1)!) && !existing.has(email)).sort() ?? [];
}

export default function CreateMailboxDialog({ preferredDomain, initialAddress = "", onClose, onCreated, returnFocus }: {
	preferredDomain?: string;
	initialAddress?: string;
	onClose: () => void;
	onCreated?: (mailbox: Mailbox) => void;
	returnFocus?: RefObject<HTMLElement | null>;
}) {
	const config = useConfig();
	const mailboxes = useMailboxes();
	const create = useCreateMailbox();
	const toast = useKumoToastManager();
	const localInput = useRef<HTMLInputElement>(null);
	const prefixId = useId();
	const helpId = useId();
	const nameId = useId();
	const [selectedDomain, setSelectedDomain] = useState("");
	const [selectedAddress, setSelectedAddress] = useState("");
	const [initialLocal, initialDomain] = initialAddress.toLowerCase().split("@");
	const [local, setLocal] = useState(() => emailSchema.safeParse(initialAddress).success ? initialLocal : "");
	const [name, setName] = useState("");
	const [disposable, setDisposable] = useState(false);
	const [error, setError] = useState("");
	const [addressTouched, setAddressTouched] = useState(false);
	const domains = [...(config.data?.domains ?? [])].sort();
	const registered = mailboxes.data ?? [];
	const allowed = availableAddresses(config.data, registered);
	const restricted = !!config.data?.emailAddresses.length;
	const domain = [selectedDomain, initialDomain, preferredDomain].find((item): item is string => !!item && domains.includes(item)) || domains[0] || "";
	const address = [selectedAddress, initialAddress.toLowerCase(), allowed.find((item) => item.endsWith(`@${domain}`))].find((item): item is string => !!item && allowed.includes(item)) || allowed[0] || "";
	const email = restricted ? address : local.trim() && domain ? `${local.trim().toLowerCase()}@${domain}` : "";
	const addressError = email && !emailSchema.safeParse(email).success ? "Enter a valid address prefix, such as support or team.ops." :
		registered.some((box) => box.email === email) ? "A mailbox already uses this address." : "";
	const loading = config.isPending || mailboxes.isPending;
	const failed = config.isError || mailboxes.isError;
	const enabled = !loading && !failed && !!domains.length && (!restricted || !!allowed.length);

	async function submit() {
		setAddressTouched(true); setError("");
		if (!enabled || !email || addressError || create.isPending) return;
		let mailbox: Mailbox;
		try { mailbox = await create.mutateAsync({ email, name: name.trim() || email.split("@")[0], disposable }); }
		catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the mailbox. Please try again."); return; }
		toast.add({ title: `Added ${mailbox.email}` });
		onClose();
		onCreated?.(mailbox);
	}

	return <AppDialog wide title="Add a mailbox" description="Create an address with its own inbox, drafts, and sent mail."
		icon={<EnvelopeSimpleIcon size={26} weight="duotone" />} initialFocus={localInput} returnFocus={returnFocus} busy={create.isPending} onClose={onClose} onSubmit={() => void submit()}
		actions={enabled && <button className="mail-button primary" type="submit" disabled={create.isPending || !email || !!addressError}>{create.isPending ? "Creating mailbox…" : "Create mailbox"}</button>}>
		{loading ? <p role="status" className="text-sm text-kumo-subtle">Loading available domains…</p>
			: failed ? <div role="alert" className="space-y-3"><p>Could not load available addresses.</p><Button type="button" variant="secondary" onClick={() => { void config.refetch(); void mailboxes.refetch(); }}>Retry</Button></div>
			: !domains.length ? <div className="space-y-2"><h3 className="font-semibold">Connect a domain first</h3><p className="text-sm text-kumo-subtle">You’ll need a domain before you can create an inbox.</p><Link to="/domains" className="font-medium text-kumo-link" onClick={onClose}>Open Domains &amp; DNS</Link></div>
			: restricted && !allowed.length ? <p className="text-sm text-kumo-subtle">All addresses allowed by this server are already in use, or belong to domains that aren’t registered.</p>
			: <>
				{restricted ? <SearchSelect showLabel label="Email address" searchPlaceholder="Search available addresses…" options={textChoices(allowed)}
					value={address} disabled={create.isPending} onChange={(value) => { setSelectedAddress(value); setError(""); }} icon={<AtIcon size={18} />} /> :
					<div className="mailbox-address-fields">
						<div className="choice-field">
							<label className="choice-label" htmlFor={prefixId}>Address prefix</label>
							<input id={prefixId} className="field-input mailbox-create-input" ref={localInput} placeholder="e.g. support" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={64}
								value={local} disabled={create.isPending} aria-describedby={helpId} aria-invalid={addressTouched && !!addressError} onBlur={() => setAddressTouched(true)}
								onChange={(e) => { setLocal(e.target.value); setError(""); }} onPaste={(event) => {
									const paste = event.clipboardData.getData("text").trim().toLowerCase();
									const [prefix, pastedDomain] = paste.split("@");
									if (!domains.includes(pastedDomain) || !emailSchema.safeParse(paste).success) return;
									event.preventDefault(); setLocal(prefix); setSelectedDomain(pastedDomain); setError("");
								}} />
						</div>
						<SearchSelect showLabel label="Domain" searchPlaceholder="Search domains…" options={textChoices(domains)} value={domain}
							onChange={(value) => { setSelectedDomain(value); setError(""); }} disabled={create.isPending} icon={<GlobeHemisphereWestIcon size={18} />} />
					</div>}
				<p id={helpId} className={`text-sm ${addressTouched && addressError ? "form-error" : "text-kumo-subtle"}`}>{addressTouched && addressError ? addressError : "This is the address people will send mail to."}</p>
				<div className="choice-field">
					<label className="choice-label" htmlFor={nameId}>Display name <span className="font-normal text-kumo-subtle">(optional)</span></label>
					<input id={nameId} className="field-input mailbox-create-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Customer Support" maxLength={120} disabled={create.isPending} />
					<p className="text-sm text-kumo-subtle">Shown to recipients when you send mail from this address.</p>
				</div>
				<label className="flex cursor-pointer items-start gap-3 rounded-xl border border-kumo-line px-3 py-2.5 text-sm">
					<input type="checkbox" className="workspace-check mt-0.5 shrink-0" checked={disposable} disabled={create.isPending}
						onChange={(event) => setDisposable(event.target.checked)} />
					<span><span className="block font-medium">Disposable inbox</span>
						<span className="block text-kumo-subtle">For one-time codes and low-priority mail. Open it directly from the mailbox picker. Messages stay out of unified mail, search, unread badges, and MCP.</span></span>
				</label>
				<div className="mailbox-address-preview">
					<AtIcon size={20} className="shrink-0 text-kumo-link" aria-hidden="true" />
					<div className="min-w-0"><p className="choice-secondary">New email address</p><p className="break-all font-medium">{email || (domain ? `your-address@${domain}` : "Choose an address")}</p></div>
				</div>
				{error && <p role="alert" className="form-error">{error}</p>}
			</>}
	</AppDialog>;
}
