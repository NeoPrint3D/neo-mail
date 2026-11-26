// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { Badge, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { ArrowLeftIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import FolderSettings from "~/components/FolderSettings";
import SearchSelect, { textChoices } from "~/components/SearchSelect";
import ForwardingAddresses, { forwardingAddresses } from "~/components/ForwardingAddresses";
import { queryKeys } from "~/queries/keys";
import { useConfig, useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import api from "~/services/api";
import type { Mailbox } from "~/types";

function MailboxSettings({ mailbox }: { mailbox: Mailbox }) {
	const toast = useKumoToastManager();
	const cache = useQueryClient();
	const update = useUpdateMailbox();
	const { data: config } = useConfig();

	const initialTargets = [
		...(mailbox.settings?.forwarding?.targets ?? []),
		...(mailbox.settings?.forwarding?.email ? [mailbox.settings.forwarding.email] : []),
	];
	const [name, setName] = useState(mailbox.settings?.fromName || mailbox.name);
	const [signatureEnabled, setSignatureEnabled] = useState(!!mailbox.settings?.signature?.enabled);
	const [signature, setSignature] = useState(mailbox.settings?.signature?.text || "");
	const [signatureChanged, setSignatureChanged] = useState(false);

	const [forwardingEnabled, setForwardingEnabled] = useState(!!mailbox.settings?.forwarding?.enabled);
	const [forwardingTargets, setForwardingTargets] = useState(initialTargets);
	const [keepCopy, setKeepCopy] = useState(mailbox.settings?.forwarding?.keepCopy ?? true);

	const domains = config?.domains ?? [mailbox.domain];
	const [aliasPrefix, setAliasPrefix] = useState("");
	const [aliasDomain, setAliasDomain] = useState(mailbox.domain || domains[0] || "");
	const [aliasForward, setAliasForward] = useState<string[]>([]);
	const [aliasError, setAliasError] = useState("");

	const addAlias = useMutation({
		mutationFn: () =>
			api.createRoutingRule({
				domain: aliasDomain,
				matchType: "exact",
				localPart: aliasPrefix.trim().toLowerCase(),
				action: "mailbox",
				deliverTo: mailbox.id,
				forwardTo: forwardingAddresses(aliasForward),
				enabled: true,
				note: `Alias for ${mailbox.email}`,
			}),
		onSuccess: async () => {
			setAliasPrefix("");
			setAliasForward([]);
			setAliasError("");
			await Promise.all([
				cache.invalidateQueries({ queryKey: queryKeys.mailboxes.detail(mailbox.id) }),
				cache.invalidateQueries({ queryKey: ["routing"] }),
			]);
			toast.add({ title: "Alias added" });
		},
		onError: (err) => setAliasError(err instanceof Error ? err.message : "Could not add alias"),
	});

	const removeAlias = useMutation({
		mutationFn: (id: string) => api.deleteRoutingRule(id),
		onSuccess: async () => {
			await Promise.all([
				cache.invalidateQueries({ queryKey: queryKeys.mailboxes.detail(mailbox.id) }),
				cache.invalidateQueries({ queryKey: ["routing"] }),
			]);
			toast.add({ title: "Alias removed" });
		},
		onError: (err) => toast.add({ title: err instanceof Error ? err.message : "Could not remove alias", variant: "error" }),
	});

	async function save(event: FormEvent) {
		event.preventDefault();
		const targets = forwardingAddresses(forwardingTargets);
		if (forwardingEnabled && targets.length === 0) {
			toast.add({ title: "Enter at least one forwarding email address", variant: "error" });
			return;
		}
		try {
			await update.mutateAsync({
				mailboxId: mailbox.id,
				settings: {
					fromName: name.trim(),
					signature: {
						enabled: signatureEnabled,
						text: signature,
						html: signatureChanged ? undefined : mailbox.settings?.signature?.html,
					},
					forwarding: {
						enabled: forwardingEnabled,
						targets,
						keepCopy,
					},
				},
			});
			toast.add({ title: "Mailbox settings saved" });
		} catch (err) {
			toast.add({ title: err instanceof Error ? err.message : "Could not save settings", variant: "error" });
		}
	}

	const aliases = mailbox.aliases ?? [];

	return (
		<div className="space-y-6">
			<form onSubmit={save} className="space-y-4">
				<section className="settings-card space-y-4">
					<h2 className="font-semibold">Sender identity</h2>
					<Input label="Display name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
					<Input label="Email address" value={mailbox.email} readOnly />
					<p className="text-xs text-kumo-subtle">Replies and new messages from this mailbox use this address.</p>
				</section>

				<section className="settings-card space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h2 className="font-semibold">Email forwarding</h2>
						{config && config.platform !== "cloudflare" && !config.smtpAvailable && (
							<Badge variant="outline">Requires SMTP_URL</Badge>
						)}
					</div>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							className="workspace-check"
							checked={forwardingEnabled}
							onChange={(e) => setForwardingEnabled(e.target.checked)}
						/>
						Forward incoming mail directly to external email(s)
					</label>
					<ForwardingAddresses label="Forwarding destinations" value={forwardingTargets} onChange={setForwardingTargets} disabled={!forwardingEnabled || update.isPending}
						description="Add up to 10 addresses, or paste a list." />
					{forwardingEnabled && config?.platform === "cloudflare" && <Link className="block text-sm text-kumo-link" to={`/routing?${new URLSearchParams({ domain: mailbox.domain })}`}>Verify each destination in Email routing</Link>}
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							className="workspace-check"
							checked={keepCopy}
							disabled={!forwardingEnabled}
							onChange={(e) => setKeepCopy(e.target.checked)}
						/>
						Keep a copy in this mailbox&apos;s Inbox
					</label>
				</section>

				<section className="settings-card space-y-3">
					<h2 className="font-semibold">Signature</h2>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							className="workspace-check"
							checked={signatureEnabled}
							onChange={(e) => setSignatureEnabled(e.target.checked)}
						/>
						Add a signature to new messages and replies
					</label>
					<textarea
						aria-label="Signature text"
						className="block w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed p-3 text-sm"
						rows={5}
						maxLength={8000}
						disabled={!signatureEnabled}
						value={signature}
						onChange={(e) => { setSignature(e.target.value); setSignatureChanged(true); }}
						placeholder={"Thanks,\nSupport team"}
					/>
				</section>

				<div className="flex justify-end">
					<Button type="submit" variant="primary" loading={update.isPending}>
						Save changes
					</Button>
				</div>
			</form>

			<section className="settings-card space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 className="font-semibold">Assigned aliases</h2>
						<p className="text-xs text-kumo-subtle">
							Aliases deliver into this inbox (and optionally forward copies) and can be used as your From address when replying.
						</p>
					</div>
					<Link to="/routing" className="text-sm font-medium text-kumo-link">
						All routing rules →
					</Link>
				</div>

				{aliases.length > 0 ? (
					<ul className="divide-y divide-kumo-line rounded-xl border border-kumo-line">
						{aliases.map((alias) => (
							<li key={alias.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<code className="text-sm font-medium">{alias.address}</code>
										{!alias.enabled && <Badge variant="outline">Paused</Badge>}
									</div>
									{alias.forwardTo.length > 0 && (
										<p className="text-xs text-kumo-subtle">Also forwards to: {alias.forwardTo.join(", ")}</p>
									)}
								</div>
								<Button
									variant="ghost"
									size="xs"
									shape="square"
									aria-label={`Remove alias ${alias.address}`}
									icon={<TrashIcon size={14} />}
									disabled={removeAlias.isPending}
									onClick={() => removeAlias.mutate(alias.id)}
								/>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-kumo-subtle">No aliases point to this mailbox yet.</p>
				)}

				<form
					className="grid gap-3 rounded-xl border border-kumo-line bg-kumo-recessed p-4"
					onSubmit={(e) => {
						e.preventDefault();
						setAliasError("");
						if (aliasPrefix.trim()) addAlias.mutate();
					}}
				>
					<div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
						<label className="field-label">
							Alias prefix
							<input
								className="field-input"
								value={aliasPrefix}
								onChange={(e) => setAliasPrefix(e.target.value)}
								placeholder="sales"
								maxLength={64}
								required
							/>
						</label>
						<span className="hidden items-end pb-2.5 text-sm text-kumo-subtle sm:flex">@</span>
						<SearchSelect showLabel label="Domain" value={aliasDomain} options={textChoices(domains)} searchPlaceholder="Search domains…" onChange={setAliasDomain} />
					</div>
					<ForwardingAddresses label="Also forward copies to (optional)" value={aliasForward} onChange={setAliasForward} disabled={addAlias.isPending} />
					{aliasError && <p role="alert" className="form-error">{aliasError}</p>}
					<div className="flex justify-end">
						<Button type="submit" variant="secondary" size="sm" icon={<PlusIcon size={14} />} loading={addAlias.isPending}>
							Add alias
						</Button>
					</div>
				</form>
			</section>
		</div>
	);
}

export default function SettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const mailbox = useMailbox(mailboxId);
	return (
		<div className="settings-page">
			<div className="mx-auto w-full max-w-2xl">
				<Link className="phone-settings-back directory-back mb-2" to="/mailboxes"><ArrowLeftIcon size={18} />Mailboxes</Link>
				<header className="settings-heading mb-5">
					<p className="workspace-label">Mailbox</p>
					<h1>Mailbox settings</h1>
					<p>Manage identity, external email forwarding, aliases, signature, and custom folders.</p>
				</header>
				{mailbox.isError ? (
					<p role="alert" className="form-error">
						{mailbox.error.message}{" "}
						<Button variant="secondary" onClick={() => mailbox.refetch()}>Retry</Button>
					</p>
				) : mailbox.data ? (
					<div key={mailbox.data.id}>
						{mailbox.data.disposable && <p className="settings-card mb-4 text-sm"><Badge variant="secondary">Disposable</Badge>{" "}
							<span className="text-kumo-subtle">Mail here is excluded from unified mail, search, unread badges, and MCP.</span></p>}
						<MailboxSettings mailbox={mailbox.data} />
						<FolderSettings mailboxId={mailbox.data.id} />
					</div>
				) : (
					<Loader />
				)}
			</div>
		</div>
	);
}
