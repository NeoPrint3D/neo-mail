import { DownloadSimpleIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import AppDialog from "./AppDialog";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export default function InstallApp() {
	const [available, setAvailable] = useState(false);
	const [installed, setInstalled] = useState(false);
	const [showHelp, setShowHelp] = useState(false);
	const [ios, setIos] = useState(false);
	const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

	useEffect(() => {
		const standalone = window.matchMedia("(display-mode: standalone)");
		const syncInstalled = () => {
			const isInstalled = standalone.matches || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
			setInstalled(isInstalled);
			setAvailable(!isInstalled);
		};
		const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
		setIos(isIos);
		const handlePrompt = (event: Event) => { event.preventDefault(); setPromptEvent(event as InstallPromptEvent); };
		const handleInstalled = () => { setInstalled(true); setAvailable(false); };
		syncInstalled();
		standalone.addEventListener("change", syncInstalled);
		window.addEventListener("beforeinstallprompt", handlePrompt);
		window.addEventListener("appinstalled", handleInstalled);
		return () => {
			standalone.removeEventListener("change", syncInstalled);
			window.removeEventListener("beforeinstallprompt", handlePrompt);
			window.removeEventListener("appinstalled", handleInstalled);
		};
	}, []);

	if (!available || installed) return null;

	async function install() {
		if (promptEvent) {
			await promptEvent.prompt();
			const choice = await promptEvent.userChoice;
			if (choice.outcome === "accepted") { setInstalled(true); setAvailable(false); }
			setPromptEvent(null);
			return;
		}
		setShowHelp(true);
	}

	return <>
		<button type="button" className="mail-nav-link" onClick={() => void install()}><DownloadSimpleIcon size={18} /> Install app</button>
		{showHelp && <AppDialog title="Install NeoMail" description={ios
			? "Add NeoMail to your Home Screen for a fast, full-screen inbox."
			: "Add NeoMail to your device for a fast, app-like experience."}
			icon={<DownloadSimpleIcon size={24} weight="duotone" />} onClose={() => setShowHelp(false)}>
			<div className="space-y-4 text-sm">
				{ios ? <>
					<div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-kumo-tint"><ShareNetworkIcon size={19} /></span><p><strong>1. Tap Share</strong><br /><span className="text-kumo-subtle">In Safari, tap the Share button at the bottom of the screen (or at the top on iPad).</span></p></div>
					<div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-kumo-tint"><span className="font-semibold">＋</span></span><p><strong>2. Choose “Add to Home Screen”</strong><br /><span className="text-kumo-subtle">If it isn’t in the menu, scroll down and choose “Edit Actions” to add it.</span></p></div>
					<div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-kumo-tint"><DownloadSimpleIcon size={18} /></span><p><strong>3. Tap “Add”</strong><br /><span className="text-kumo-subtle">If you see “Open as Web App,” leave it on. Then open Inbox from your Home Screen.</span></p></div>
					<p className="rounded-lg bg-kumo-recessed p-3 text-xs text-kumo-subtle">For the full-screen iPhone experience, open this page in Safari before adding it. After installing, you can turn on notifications in Account settings.</p>
				</> : <p className="text-kumo-subtle">Use your browser’s <strong>Install app</strong> or <strong>Add to Home Screen</strong> option. The app opens in its own window and keeps its interface ready for your next visit.</p>}
			</div>
		</AppDialog>}
	</>;
}
