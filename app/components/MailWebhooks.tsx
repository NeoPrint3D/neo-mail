import { Badge, Dialog, useKumoToastManager } from "@cloudflare/kumo";
import { CopyIcon, LightningIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type FormEvent } from "react";
import type { MailWebhook } from "shared/webhooks";
import api from "~/services/api";
import AppDialog from "./AppDialog";
import Button from "./Button";
import SearchSelect from "./SearchSelect";

export default function MailWebhooks({ domains, selectedDomain }: { domains: string[]; selectedDomain: string }) {
	const toast = useKumoToastManager();
	const cache = useQueryClient();
	const addButton = useRef<HTMLButtonElement>(null);

	const query = useQuery({ queryKey: ["webhooks"], queryFn: api.listWebhooks });
	const [open, setOpen] = useState(false);
	const [recipient, setRecipient] = useState("");
	const [endpoint, setEndpoint] = useState("");
	const [formError, setFormError] = useState("");
	const [created, setCreated] = useState<{ webhook: MailWebhook; secret: string } | null>(null);
	const [deleting, setDeleting] = useState<MailWebhook | null>(null);
	const [testingId, setTestingId] = useState<string | null>(null);

	const sources = query.data?.sources ?? [];
	const allowedOrigins = query.data?.allowedOrigins ?? [];
	const allWebhooks = query.data?.webhooks ?? [];
	const webhooks = useMemo(
		() => selectedDomain ? allWebhooks.filter((hook) => hook.recipient.endsWith(`@${selectedDomain}`)) : allWebhooks,
		[allWebhooks, selectedDomain],
	);

	const sourceOptions = useMemo(
		() => sources.map((address) => ({ value: address, label: address, group: address.split("@")[1] })),
		[sources],
	);

	const create = useMutation({
		mutationFn: (data: { recipient: string; endpoint: string }) => api.createWebhook(data),
		onSuccess: async (result) => {
			setCreated(result);
			setOpen(false);
			setEndpoint("");
			setFormError("");
			await cache.invalidateQueries({ queryKey: ["webhooks"] });
			toast.add({ title: `Webhook added for ${result.webhook.recipient}` });
		},
		onError: (err) => setFormError(err instanceof Error ? err.message : "Could not add webhook"),
	});

	const toggle = useMutation({
		mutationFn: (hook: MailWebhook) => api.updateWebhook(hook.id, !hook.enabled),
		onSuccess: async (_data, hook) => {
			await cache.invalidateQueries({ queryKey: ["webhooks"] });
			toast.add({ title: hook.enabled ? `Paused webhook for ${hook.recipient}` : `Enabled webhook for ${hook.recipient}` });
		},
		onError: (err) => toast.add({ title: err instanceof Error ? err.message : "Could not update webhook", variant: "error" }),
	});

	const remove = useMutation({
		mutationFn: (id: string) => api.deleteWebhook(id),
		onSuccess: async (_data, id) => {
			if (created?.webhook.id === id) setCreated(null);
			setDeleting(null);
			await cache.invalidateQueries({ queryKey: ["webhooks"] });
			toast.add({ title: "Webhook removed" });
		},
		onError: (err) => toast.add({ title: err instanceof Error ? err.message : "Could not delete webhook", variant: "error" }),
	});

	const test = useMutation({
		mutationFn: (hook: MailWebhook) => {
			setTestingId(hook.id);
			return api.testWebhook(hook.id);
		},
		onSuccess: async ({ status }) => {
			await cache.invalidateQueries({ queryKey: ["webhooks"] });
			toast.add({
				title: status !== null && status >= 200 && status < 300
					? `Webhook responded ${status}`
					: status !== null
						? `Webhook responded ${status}`
						: "Webhook request failed",
				variant: status !== null && status >= 200 && status < 300 ? "default" : "error",
			});
		},
		onError: (err) => toast.add({ title: err instanceof Error ? err.message : "Could not test webhook", variant: "error" }),
		onSettled: () => setTestingId(null),
	});

	async function copy(value: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			toast.add({ title: `${label} copied` });
		} catch {
			toast.add({ title: "Could not copy. Select and copy it manually.", variant: "error" });
		}
	}

	function openDialog() {
		const preferred = (selectedDomain && sources.find((address) => address.endsWith(`@${selectedDomain}`))) || sources[0] || "";
		setRecipient(preferred);
		setEndpoint("");
		setFormError("");
		setOpen(true);
	}

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (create.isPending || !recipient || !endpoint.trim()) return;
		setFormError("");
		create.mutate({ recipient, endpoint: endpoint.trim() });
	}

	if (!domains.length) return null;

	return <>
		<section className="settings-card space-y-4" aria-labelledby="webhooks-heading">
			<div className="space-y-1.5">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 id="webhooks-heading" className="flex items-center gap-2 font-semibold">
						<LightningIcon size={18} /> Outbound webhooks
					</h2>
					<Button
						ref={addButton}
						variant="secondary"
						size="sm"
						icon={<PlusIcon size={15} />}
						disabled={query.isPending || !sources.length}
						onClick={openDialog}
					>
						Add webhook
					</Button>
				</div>
				<p className="text-xs text-kumo-subtle">
					Send a signed HTTPS POST (<code>mail.received</code>) when mail arrives at an inbox or exact alias. Payloads include arrival IDs only—never message contents or attachments.
				</p>
			</div>

			{created && (
				<div className="space-y-2 rounded-xl border border-kumo-line bg-kumo-recessed p-3">
					<p className="text-sm font-semibold">Copy the signing secret for {created.webhook.recipient}. It is only shown once.</p>
					<code className="block break-all text-xs">{created.secret}</code>
					<p className="text-xs text-kumo-subtle">
						Verify <code>X-NeoMail-Signature</code> (<code>sha256=</code> HMAC-SHA256 of <code>{"<X-NeoMail-Timestamp>.<body>"}</code>).
					</p>
					<div className="flex flex-wrap gap-2">
						<Button variant="secondary" size="sm" icon={<CopyIcon size={14} />} onClick={() => void copy(created.secret, "Signing secret")}>
							Copy secret
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
							Hide secret
						</Button>
					</div>
				</div>
			)}

			{query.isError ? (
				<p role="alert" className="form-error">{query.error.message}</p>
			) : query.isPending ? (
				<p className="text-sm text-kumo-subtle">Loading webhooks…</p>
			) : !sources.length ? (
				<p className="text-sm text-kumo-subtle">Create an inbox or active exact alias before adding a webhook.</p>
			) : !webhooks.length ? (
				<p className="text-sm text-kumo-subtle">
					{selectedDomain ? `No webhooks configured for ${selectedDomain}.` : "No webhooks configured yet."}
				</p>
			) : (
				<ul className="divide-y divide-kumo-line rounded-xl border border-kumo-line">
					{webhooks.map((hook) => {
						const okStatus = hook.lastAttempt?.status !== null && hook.lastAttempt?.status !== undefined && hook.lastAttempt.status >= 200 && hook.lastAttempt.status < 300;
						return (
							<li key={hook.id} className="routing-rule-row flex flex-wrap items-center gap-3 px-4 py-3">
								<div className="min-w-0 flex-1 space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<code className="break-all text-sm font-semibold">{hook.recipient}</code>
										{!hook.enabled && <Badge variant="outline">Paused</Badge>}
										{hook.lastAttempt && (
											<Badge variant={okStatus ? "secondary" : "outline"}>
												Last: {hook.lastAttempt.status ?? "failed"}
											</Badge>
										)}
									</div>
									<p className="break-all text-xs text-kumo-subtle">{hook.origin}</p>
								</div>
								<div className="routing-rule-actions flex items-center gap-1.5">
									<Button
										variant="ghost"
										size="sm"
										loading={testingId === hook.id}
										disabled={testingId !== null}
										onClick={() => test.mutate(hook)}
									>
										Test
									</Button>
									<Button
										variant="ghost"
										size="sm"
										disabled={toggle.isPending}
										onClick={() => toggle.mutate(hook)}
									>
										{hook.enabled ? "Pause" : "Enable"}
									</Button>
									<Button
										variant="ghost"
										size="sm"
										shape="square"
										aria-label={`Delete webhook for ${hook.recipient}`}
										icon={<TrashIcon size={15} />}
										onClick={() => setDeleting(hook)}
									/>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</section>

		{open && (
			<AppDialog
				title="Add webhook"
				description="Trigger an HTTPS request when mail arrives at a specific inbox or alias."
				icon={<LightningIcon size={24} weight="duotone" />}
				busy={create.isPending}
				returnFocus={addButton}
				onClose={() => setOpen(false)}
				onSubmit={submit}
				actions={
					<button type="submit" className="mail-button primary" disabled={create.isPending || !recipient || !endpoint.trim()}>
						{create.isPending ? "Creating…" : "Create webhook"}
					</button>
				}
			>
				<div className="space-y-4">
					<SearchSelect
						showLabel
						label="Incoming address"
						value={recipient}
						options={sourceOptions}
						searchPlaceholder="Search addresses…"
						onChange={setRecipient}
						disabled={create.isPending}
					/>
					<label className="field-label">
						Webhook URL
						<input
							className="field-input"
							type="url"
							inputMode="url"
							autoCapitalize="none"
							autoComplete="off"
							spellCheck={false}
							value={endpoint}
							onChange={(event) => setEndpoint(event.target.value)}
							placeholder="https://hooks.zapier.com/hooks/catch/..."
							maxLength={2000}
							required
							disabled={create.isPending}
						/>
						<span>
							Supports Zapier, Make, Pipedream, and n8n URLs
							{allowedOrigins.length
								? `, plus operator-approved origins (${allowedOrigins.join(", ")}).`
								: ". For other HTTPS endpoints, configure WEBHOOK_ALLOWED_ORIGINS."}
						</span>
					</label>
					{formError && <p role="alert" className="form-error">{formError}</p>}
				</div>
			</AppDialog>
		)}

		<Dialog.Root open={!!deleting} onOpenChange={(isOpen) => { if (!isOpen && !remove.isPending) setDeleting(null); }}>
			<Dialog size="sm" className="settings-dialog space-y-4 p-6">
				<Dialog.Title className="font-semibold">Remove webhook for {deleting?.recipient}?</Dialog.Title>
				<Dialog.Description className="text-sm text-kumo-subtle">
					Incoming mail to this address will still be delivered, but NeoMail will stop sending events to {deleting?.origin}.
				</Dialog.Description>
				<div className="flex justify-end gap-2">
					<Button variant="secondary" disabled={remove.isPending} onClick={() => setDeleting(null)}>
						Cancel
					</Button>
					<Button variant="destructive" loading={remove.isPending} onClick={() => { if (deleting) remove.mutate(deleting.id); }}>
						Remove
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	</>;
}
