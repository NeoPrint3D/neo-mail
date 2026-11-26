import { ArrowRightIcon } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import BrandMark from "~/components/BrandMark";
import api from "~/services/api";

export function meta() { return [{ title: "Setup · NeoMail" }]; }

export default function SetupRoute() {
	const [working, setWorking] = useState(false);
	const [error, setError] = useState("");

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); setError(""); setWorking(true);
		const fields = new FormData(event.currentTarget);
		const email = String(fields.get("email") || ""), password = String(fields.get("password") || ""), confirm = String(fields.get("confirm") || "");
		try {
			if (!password || password !== confirm) throw new Error("Passwords do not match");
			await api.setup({ email, password, code: String(fields.get("code") || "") });
			window.location.replace("/");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Setup failed"); setWorking(false);
		}
	}
	return <main className="login-shell">
		<section className="login-card" aria-labelledby="setup-heading">
			<div className="mb-6 flex items-center gap-3"><BrandMark /><span className="brand-wordmark">NeoMail</span></div>
			<h1 id="setup-heading" className="text-3xl font-semibold tracking-tight">Set up your account</h1>
			<p className="mt-2 mb-7 text-sm text-kumo-subtle">Create the owner account for your mail workspace.</p>
			{error && <p role="alert" className="form-error mb-4">{error}</p>}
			<form onSubmit={submit} className="space-y-4">
				<label className="field-label">Setup code<input className="field-input" name="code" type="password" required maxLength={256} autoComplete="off" spellCheck={false} /><span>Use the initial setup code from your deployment.</span></label>
				<label className="field-label">Email address<input className="field-input" type="email" name="email" required maxLength={254} autoComplete="username" placeholder="you@example.com" /></label>
				<label className="field-label">Password<input className="field-input" type="password" name="password" required autoComplete="new-password" minLength={12} maxLength={256} /></label>
				<label className="field-label">Confirm password<input className="field-input" type="password" name="confirm" required autoComplete="new-password" minLength={12} maxLength={256} /></label>
				<button className="mail-button primary w-full justify-between" type="submit" disabled={working}>{working ? "Please wait…" : "Create account"}<ArrowRightIcon size={19} /></button>
			</form>
		</section>
	</main>;
}
