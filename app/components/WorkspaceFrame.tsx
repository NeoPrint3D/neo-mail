import { Dialog } from "@base-ui/react/dialog";
import { MagnifyingGlassIcon, PencilSimpleIcon, XIcon } from "@phosphor-icons/react";
import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { useUIStore } from "~/hooks/useUIStore";
import { useMailbox, useMailboxes } from "~/queries/mailboxes";
import AppDialog from "./AppDialog";
import BrandMark from "./BrandMark";
import Header from "./Header";
import Sidebar from "./Sidebar";

const ComposeEmail = lazy(() => import("./ComposeEmail"));
const PhoneCompose = createContext<(() => void) | null>(null);

export function PhoneComposeButton() {
	const open = useContext(PhoneCompose);
	return open && <button type="button" className="phone-compose" aria-label="Compose" title="Compose" onClick={open}>
		<span aria-hidden="true"><PencilSimpleIcon size={20} weight="bold" /></span>
	</button>;
}

export default function WorkspaceFrame({ children }: { children: ReactNode }) {
	const { isSidebarOpen, closeSidebar } = useUIStore();
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const { pathname, key } = useLocation();
	const [params] = useSearchParams();
	const { data: mailbox } = useMailbox(mailboxId);
	const { data: mailboxes = [] } = useMailboxes();
	const [composeFrom, setComposeFrom] = useState("");
	const [chooseSender, setChooseSender] = useState(false);
	const [senderQuery, setSenderQuery] = useState("");
	const scoped = mailboxes.filter((box) => (!params.get("domain") || box.domain === params.get("domain")) && (!params.get("mailbox") || box.id === params.get("mailbox")));
	const [online, setOnline] = useState(true);

	useEffect(() => { closeSidebar(); }, [key, closeSidebar]);
	useEffect(() => {
		const sync = () => setOnline(navigator.onLine);
		sync();
		window.addEventListener("online", sync);
		window.addEventListener("offline", sync);
		return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
	}, []);

	function compose() {
		closeSidebar();
		if (mailbox) { setComposeFrom(mailbox.id); return; }
		if (scoped.length === 1) { setComposeFrom(scoped[0].id); return; }
		const primary = scoped.filter((box) => !box.disposable);
		if (primary.length === 1) { setComposeFrom(primary[0].id); return; }
		setSenderQuery(""); setChooseSender(true);
	}

	const candidates = chooseSender ? (scoped.length ? scoped : mailboxes).filter((box) => `${box.name} ${box.email}`.toLowerCase().includes(senderQuery.trim().toLowerCase())) : [];
	const showCompose = (pathname === "/" && !params.get("view") && !params.get("q")) || pathname.endsWith("/emails/inbox");
	return <div className="mail-shell">
		<Header />
		{!online && <p className="mail-offline-banner" role="status">Offline · Reconnect to refresh or send mail</p>}
		<div className="mail-shell-body">
			<div className="mail-side-drawer"><Sidebar onCompose={compose} /></div>
			<main className="mail-stage"><PhoneCompose.Provider value={showCompose && mailboxes.length ? compose : null}>{children}</PhoneCompose.Provider></main>
		</div>
		<Dialog.Root open={isSidebarOpen} onOpenChange={(open) => { if (!open) closeSidebar(); }}>
			<Dialog.Portal>
				<Dialog.Backdrop className="phone-drawer-backdrop" />
				<Dialog.Popup className="phone-drawer" finalFocus={() => document.getElementById("mobile-nav-button")}>
					<header className="mobile-drawer-heading"><BrandMark /><Dialog.Title className="brand-wordmark">NeoMail</Dialog.Title>
						<Dialog.Close className="mail-icon-button" aria-label="Close navigation"><XIcon size={22} /></Dialog.Close>
					</header>
					<Sidebar onCompose={compose} mobile />
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
		{chooseSender && <AppDialog title="Send from" description="Choose the mailbox you want to send from."
			icon={<PencilSimpleIcon size={23} />} onClose={() => setChooseSender(false)}>
			<div className="phone-picker-search"><MagnifyingGlassIcon size={20} aria-hidden="true" />
				<input type="search" autoCapitalize="none" aria-label="Find a sender" placeholder="Find a sender" value={senderQuery} onChange={(event) => setSenderQuery(event.target.value)} /></div>
			<div className="grid gap-1">
				{candidates.map((box) => <button key={box.id} type="button" className="phone-picker-row text-left" onClick={() => { setChooseSender(false); setComposeFrom(box.id); }}>
					<span className="mail-avatar" aria-hidden="true">{(box.name || box.email).charAt(0).toUpperCase()}</span>
					<span className="min-w-0"><strong className="block truncate">{box.name}</strong><span className="block truncate text-xs text-kumo-subtle">{box.email}</span></span>
				</button>)}
				{!candidates.length && <p className="px-2 text-sm text-kumo-subtle">No matching senders.</p>}
			</div>
		</AppDialog>}
		{composeFrom && <Suspense fallback={<p className="sr-only" role="status">Opening composer</p>}><ComposeEmail key={composeFrom} mailboxId={composeFrom} onClose={() => setComposeFrom("")} /></Suspense>}
	</div>;
}
