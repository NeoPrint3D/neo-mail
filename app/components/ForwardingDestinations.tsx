import { Badge } from "@cloudflare/kumo";
import Button from "~/components/Button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import api from "~/services/api";
import ForwardingAddresses, { forwardingAddresses } from "./ForwardingAddresses";

export function ForwardingDestinations({ domain }: { domain: string }) {
	const [open, setOpen] = useState(false);
	const [addresses, setAddresses] = useState<string[]>([]);
	const targets = forwardingAddresses(addresses);
	const destinations = useQuery({ queryKey: ["forwarding-destinations", domain], queryFn: () => api.forwardingDestinations(domain), enabled: open, retry: false });
	const verify = useMutation({
		mutationFn: async (targets: string[]) => {
			const failed: { address: string; error: string }[] = [];
			for (const address of targets) {
				try { await api.verifyForwardingDestination(domain, address); }
				catch (err) { failed.push({ address, error: err instanceof Error ? err.message : "Could not request verification" }); }
			}
			return { requested: targets.length - failed.length, failed };
		},
		onSuccess: ({ failed }) => { setAddresses(failed.map(({ address }) => address)); void destinations.refetch(); },
	});
	function submit(event: FormEvent) {
		event.preventDefault();
		if (targets.length && !verify.isPending) verify.mutate(targets);
	}
	return <details className="settings-card" onToggle={(event) => setOpen(event.currentTarget.open)}>
		<summary className="min-h-10 cursor-pointer py-1 font-semibold">Verify forwarding destinations</summary>
		<p className="mt-2 text-sm text-kumo-subtle">Cloudflare must verify each external destination once per account. Open the link sent to that address, then refresh the list. Verify addresses before turning on a forwarding rule.</p>
		<form className="mt-3 space-y-3" onSubmit={submit}>
			<ForwardingAddresses label="Destination email" value={addresses} onChange={setAddresses} disabled={verify.isPending} />
			<Button variant="secondary" type="submit" disabled={!targets.length || targets.length > 10} loading={verify.isPending}>Request verification</Button>
		</form>
		{verify.data && verify.data.requested > 0 && <p role="status" className="mt-2 text-sm">{verify.data.requested} {verify.data.requested === 1 ? "address" : "addresses"} submitted. Check the status below.</p>}
		{verify.data && verify.data.failed.length > 0 && <ul role="alert" className="form-error mt-2 space-y-1">{verify.data.failed.map(({ address, error }) => <li key={address}>{address}: {error}</li>)}</ul>}
		<div className="mt-3 flex items-center justify-between gap-2"><h3 className="text-sm font-medium">Account destinations</h3><Button variant="ghost" size="sm" loading={destinations.isFetching} onClick={() => void destinations.refetch()}>Refresh</Button></div>
		{destinations.error && <p role="alert" className="form-error mt-2">{destinations.error.message}</p>}
		{destinations.data?.length === 0 && <p className="text-sm text-kumo-subtle">No forwarding destinations yet.</p>}
		<ul className="max-h-56 divide-y divide-kumo-line overflow-y-auto">{destinations.data?.map((row) => <li key={row.email} className="flex items-center justify-between gap-2 py-2.5 text-sm"><span className="min-w-0 break-all">{row.email}</span><Badge className="shrink-0" variant={row.verified ? "secondary" : "outline"}>{row.verified ? "Verified" : "Pending"}</Badge></li>)}</ul>
	</details>;
}
