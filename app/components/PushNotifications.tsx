import { BellIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { PushSettings } from "shared/push";
import { applicationServerKey, installedApp, iosDevice, pushDeviceId, pushDeviceLabel } from "~/lib/push";
import api from "~/services/api";
import Button from "./Button";

export const pushSettingsQueryKey = ["push-settings"] as const;

type Availability = "loading" | "ready" | "install" | "unsupported" | "blocked" | "worker-error";

export default function PushNotifications() {
	const cache = useQueryClient();
	const settings = useQuery({ queryKey: pushSettingsQueryKey, queryFn: api.pushSettings, retry: false });
	const [availability, setAvailability] = useState<Availability>("loading");
	const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
	const [subscription, setSubscription] = useState<PushSubscription | null>(null);
	const [localId, setLocalId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<{ text: string; error?: true } | null>(null);
	const publicKey = settings.data?.publicKey;
	const devices = settings.data?.devices ?? [];
	const current = devices.find((device) => device.id === localId);

	useEffect(() => {
		if (!publicKey) return;
		let disposed = false;
		async function check() {
			if (iosDevice() && !installedApp()) { setAvailability("install"); return; }
			if (!isSecureContext || !("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) {
				setAvailability("unsupported"); return;
			}
			if (Notification.permission === "denied") { setAvailability("blocked"); return; }
			try {
				const reg = await navigator.serviceWorker.getRegistration() ?? await navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" });
				const supported = reg.active ? reg : await navigator.serviceWorker.ready;
				const sub = await supported.pushManager.getSubscription();
				const id = sub && await pushDeviceId(sub.endpoint);
				if (!disposed) {
					setAvailability("ready"); setRegistration(supported); setSubscription(sub); setLocalId(id);
				}
			} catch { if (!disposed) setAvailability("worker-error"); }
		}
		void check();
		window.addEventListener("focus", check);
		return () => { disposed = true; window.removeEventListener("focus", check); };
	}, [publicKey]);

	async function enable() {
		if (!registration || !publicKey || busy) return;
		setBusy(true); setResult(null);
		try {
			const key = applicationServerKey(publicKey);
			let sub = subscription;
			const previousKey = sub?.options.applicationServerKey;
			if (sub && previousKey && (key.length !== previousKey.byteLength || !new Uint8Array(previousKey).every((byte, i) => byte === key[i]))) {
				await sub.unsubscribe();
				sub = null; setSubscription(null); setLocalId(null);
			}
			// Subscribe directly in the tap handler so iOS can show its permission prompt.
			sub ??= await registration.pushManager.subscribe({ applicationServerKey: key, userVisibleOnly: true });
			setSubscription(sub);
			setLocalId(await pushDeviceId(sub.endpoint));
			await api.enablePush(pushDeviceLabel(), sub.toJSON());
			await settings.refetch();
			setResult({ text: "Notifications are on for this device." });
		} catch (err) {
			if (Notification.permission === "denied") {
				setAvailability("blocked");
				setResult(null);
			} else setResult({ text: err instanceof Error ? err.message : "Could not turn on notifications", error: true });
		} finally { setBusy(false); }
	}

	async function disable(id: string) {
		setBusy(true); setResult(null);
		try {
			await api.disablePush(id);
			if (id === localId) {
				await subscription?.unsubscribe().catch(() => false);
				setSubscription(null); setLocalId(null);
			}
			cache.setQueryData<PushSettings>(pushSettingsQueryKey, (previous) => previous && { ...previous, devices: previous.devices.filter((device) => device.id !== id) });
			setResult({ text: "Notifications were turned off for that device." });
		} catch (err) { setResult({ text: err instanceof Error ? err.message : "Could not turn off notifications", error: true }); }
		finally { setBusy(false); }
	}

	async function test(id: string) {
		setBusy(true); setResult(null);
		try {
			await api.testPush(id);
			setResult({ text: "Test sent. Look for a NeoMail notification on this device." });
		} catch (err) {
			setResult({ text: err instanceof Error ? err.message : "Could not send a test notification", error: true });
			void settings.refetch();
		} finally { setBusy(false); }
	}

	return <section id="notifications" aria-labelledby="notification-heading" className="settings-card max-w-xl space-y-3">
		<h2 id="notification-heading" className="flex items-center gap-2 font-semibold"><BellIcon size={19} /> New mail notifications</h2>
		<p className="text-sm text-kumo-subtle">Get notified even when the app is closed. Notifications don’t show senders, subjects, or message contents. Disposable inboxes stay quiet.</p>
		{settings.isPending ? <p className="text-sm text-kumo-subtle">Loading notification settings…</p>
			: settings.isError ? <div className="space-y-2"><p role="alert" className="form-error">Could not load notification settings.</p><Button size="sm" onClick={() => void settings.refetch()}>Retry</Button></div>
			: !publicKey ? <p className="text-sm text-kumo-subtle">Web Push is not configured on this server.</p>
			: availability === "install" ? <p className="text-sm">On iPhone or iPad with iOS/iPadOS 16.4 or later, add the app to your Home Screen from Safari, open it from the icon, and return here.</p>
			: availability === "blocked" ? <p className="text-sm">Notifications are blocked on this device. Allow NeoMail notifications in your device or browser settings.</p>
			: availability === "unsupported" ? <p className="text-sm">This browser or connection doesn’t support Web Push. Use an up-to-date browser over HTTPS.</p>
			: availability === "worker-error" ? <p className="text-sm">The app couldn’t initialize notifications. Reload this page and try again.</p>
			: availability === "loading" ? <p className="text-sm text-kumo-subtle">Checking this device…</p>
			: current ? <div className="flex flex-wrap items-center gap-2"><span className="text-sm">On for this device</span><Button size="sm" disabled={busy} onClick={() => void test(current.id)}>Send test</Button></div>
			: <Button variant="primary" disabled={busy} onClick={() => void enable()}>Turn on for this device</Button>}
		{result && <p role={result.error ? "alert" : "status"} className={result.error ? "form-error" : "text-sm"}>{result.text}</p>}
		{devices.length > 0 && <ul aria-label="Notification devices" className="divide-y divide-kumo-line border-t border-kumo-line">
			{devices.map((device) => <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
				<div className="min-w-0"><span className="break-words text-sm font-medium">{device.label}</span>{device.id === localId && <span className="text-xs text-kumo-subtle"> · This device</span>}</div>
				<Button size="sm" variant="ghost" disabled={busy} aria-label={`Turn off notifications for ${device.id === localId ? "this device" : device.label}`} onClick={() => void disable(device.id)}>Turn off</Button>
			</li>)}
		</ul>}
	</section>;
}
