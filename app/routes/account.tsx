import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { AppearanceSettings } from "~/components/Appearance";
import PushNotifications, { pushSettingsQueryKey } from "~/components/PushNotifications";
import WorkspaceFrame from "~/components/WorkspaceFrame";
import api from "~/services/api";

export function meta() { return [{ title: "Account settings · NeoMail" }]; }

export default function AccountRoute() {
	const cache = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<{ text: string; error?: boolean } | null>(null);
	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); setBusy(true); setResult(null);
		const form = event.currentTarget;
		const data = new FormData(form);
		try {
			await api.changePassword({ current: String(data.get("current")), password: String(data.get("password")) });
			void cache.invalidateQueries({ queryKey: pushSettingsQueryKey });
			form.reset(); setResult({ text: "Password updated. Other browser sessions were signed out and notification devices were cleared." });
		} catch (error) { setResult({ text: error instanceof Error ? error.message : "Could not update password", error: true }); }
		finally { setBusy(false); }
	}
	return <WorkspaceFrame>
		<div className="settings-page">
			<header className="settings-heading"><p className="workspace-label">Settings</p><h1>Account settings</h1><p>Make NeoMail yours and manage access to your workspace.</p></header>
			<AppearanceSettings />
			<PushNotifications />
			<section className="settings-card max-w-xl">
				<h2 className="font-semibold">Change password</h2>
				<form onSubmit={save} className="mt-4 space-y-4">
					<label className="field-label">Current password<input className="field-input" type="password" name="current" autoComplete="current-password" required maxLength={256} /></label>
					<label className="field-label">New password<input className="field-input" type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={256} /><span>Use at least 12 characters.</span></label>
					{result && <p role={result.error ? "alert" : "status"} className={result.error ? "form-error" : "text-sm"}>{result.text}</p>}
					<button className="mail-button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
				</form>
			</section>
			<p className="text-sm text-kumo-subtle">External clients sign in separately. <Link to="/integrations" className="text-kumo-link">Manage MCP tokens →</Link></p>
			<a href="/open-source-notices.txt" className="text-sm text-kumo-link">Open-source notices</a>
		</div>
	</WorkspaceFrame>;
}
