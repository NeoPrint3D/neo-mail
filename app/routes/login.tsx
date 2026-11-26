import { ArrowRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import BrandMark from "~/components/BrandMark";
import api from "~/services/api";

export function meta() { return [{ title: "Sign in · NeoMail" }]; }

export default function LoginRoute() {
	const session = useQuery({ queryKey: ["session"], queryFn: api.getSession });
	const [working, setWorking] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => { if (session.data?.email) window.location.replace("/"); }, [session.data?.email]);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); setError(""); setWorking(true);
		const fields = new FormData(event.currentTarget);
		const email = String(fields.get("email") || ""), password = String(fields.get("password") || "");
		try {
			await api.signIn({ email, password });
			window.location.replace("/");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Sign-in failed"); setWorking(false);
		}
	}
	return <main className="login-shell">
		<section className="login-card" aria-labelledby="login-heading">
			<div className="mb-6 flex items-center gap-3"><BrandMark /><span className="brand-wordmark">NeoMail</span></div>
			<h1 id="login-heading" className="text-3xl font-semibold tracking-tight">Sign in</h1>
			<p className="mt-2 mb-7 text-sm text-kumo-subtle">Open your mail workspace with the account you created on this instance.</p>
			{session.isPending ? <p role="status" className="text-sm text-kumo-subtle">Checking workspace…</p>
				: session.isError ? <div role="alert" className="space-y-2 text-sm"><p>Could not reach the workspace.</p><button className="mail-button" onClick={() => session.refetch()}>Retry</button></div>
				: <form onSubmit={submit} className="space-y-4">
					<label className="field-label">Email address<input className="field-input" type="email" name="email" required maxLength={254} autoComplete="username" placeholder="you@example.com" /></label>
					<label className="field-label">Password<input className="field-input" type="password" name="password" autoComplete="current-password" required maxLength={256} /></label>
					{error && <p role="alert" className="form-error">{error}</p>}
					<button className="mail-button primary w-full justify-between" type="submit" disabled={working}>{working ? "Please wait…" : "Sign in"}<ArrowRightIcon size={19} /></button>
				</form>}
		</section>
	</main>;
}
