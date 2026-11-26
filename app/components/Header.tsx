// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { GearSixIcon, ListIcon, MagnifyingGlassIcon, PaletteIcon, SignOutIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { currentPushSubscription, pushDeviceId } from "~/lib/push";
import { useUIStore } from "~/hooks/useUIStore";
import { useMailbox, useMailboxes } from "~/queries/mailboxes";
import api from "~/services/api";
import { AppearanceDialog } from "./Appearance";
import BrandMark from "./BrandMark";
import InstallApp from "./InstallApp";
import MobileMailboxPicker from "./MobileMailboxPicker";

export default function Header() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const { pathname, key } = useLocation();
	const mailPage = pathname === "/" || /^\/mailbox\/[^/]+\/(?:emails\/|search$)/.test(pathname);
	const { data: mailbox } = useMailbox(mailboxId);
	const showSearch = !mailboxId || (mailbox && !mailbox.disposable);
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const query = params.get("q") || "";
	const [search, setSearch] = useState(query);
	const [showPicker, setShowPicker] = useState(false);
	const avatar = useRef<HTMLButtonElement>(null);
	const openSidebar = useUIStore((state) => state.openSidebar);
	const { data: mailboxes } = useMailboxes();
	const activeId = mailboxId || (pathname === "/" ? params.get("mailbox") || "" : "");
	const active = mailbox || mailboxes?.find((box) => box.id === activeId);
	const [appearance, setAppearance] = useState<"desktop" | "phone" | null>(null);
	const appearanceTrigger = useRef<HTMLButtonElement>(null);
	const [loggingOut, setLoggingOut] = useState(false);
	const [error, setError] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const menu = useRef<HTMLDetailsElement>(null);
	const closeSidebar = useUIStore((state) => state.closeSidebar);
	const { data: session } = useQuery({ queryKey: ["session"], queryFn: api.getSession });

	useEffect(() => setSearch(query), [query, pathname]);
	useEffect(() => { setShowPicker(false); setAppearance(null); if (menu.current) menu.current.open = false; }, [key]);
	useEffect(() => {
		function shortcut(event: KeyboardEvent) {
			if (event.key === "Escape" && menu.current?.open) menu.current.open = false;
			if (input.current?.offsetParent && event.key === "/" && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey && !document.querySelector('[role="dialog"]') &&
				!(event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)))) {
				event.preventDefault(); input.current?.focus();
			}
		}
		window.addEventListener("keydown", shortcut);
		return () => window.removeEventListener("keydown", shortcut);
	}, []);

	function updateSearch(value: string) {
		const q = value.trim();
		if (mailboxId) {
			if (!q && !pathname.endsWith("/search")) return;
			navigate(`/mailbox/${encodeURIComponent(mailboxId)}/${q ? `search?${new URLSearchParams({ q })}` : "emails/inbox"}`);
		} else {
			const next = new URLSearchParams(pathname === "/" ? params : undefined);
			if (q) next.set("q", q); else next.delete("q");
			navigate({ pathname: "/", search: next.toString() });
		}
	}
	function openAppearance(source: "desktop" | "phone") {
		setShowPicker(false);
		if (menu.current) menu.current.open = false;
		setAppearance(source);
	}
	async function signOut() {
		setLoggingOut(true); setError("");
		try {
			const subscription = await currentPushSubscription().catch(() => null);
			const id = subscription ? await pushDeviceId(subscription.endpoint).catch(() => undefined) : undefined;
			await api.signOut(id);
			void subscription?.unsubscribe().catch(() => false);
			window.location.replace("/login");
		}
		catch (err) { setError(err instanceof Error ? err.message : "Could not sign out"); setLoggingOut(false); }
	}

	return <header className={`mail-topbar${mailPage && showSearch ? " phone-search-bar" : " phone-title-bar"}`}>
		<button id="mobile-nav-button" className="mail-icon-button phone-menu-button" type="button" onClick={openSidebar} aria-label="Open navigation" aria-haspopup="dialog"><ListIcon size={24} /></button>
		<div className="mail-brand">
			<Link to="/" onClick={closeSidebar} className="flex shrink-0 items-center gap-2 no-underline" aria-label="NeoMail home">
				<BrandMark /><span className="brand-wordmark hidden lg:inline">NeoMail</span>
			</Link>
		</div>
		{(!mailPage || !showSearch) && <span className="phone-title truncate">{active?.name || "NeoMail"}</span>}
		{showSearch ? <form role="search" className="mail-search" onSubmit={(event: FormEvent) => { event.preventDefault(); input.current?.blur(); updateSearch(search); }}>
			<button type="submit" className="mail-icon-button mail-search-submit" aria-label="Run mail search"><MagnifyingGlassIcon size={20} /></button>
			<input ref={input} type="search" aria-label={mailboxId ? "Search this mailbox" : "Search all mail"} value={search} onChange={(event) => setSearch(event.target.value)} maxLength={500} enterKeyHint="search" autoCapitalize="none" autoComplete="off"
				placeholder={mailboxId ? "Search this mailbox" : "Search mail"} />
			{search ? <button type="button" className="mail-icon-button" aria-label="Clear search" onClick={() => { setSearch(""); updateSearch(""); input.current?.focus(); }}><XIcon size={17} /></button>
				: <kbd className="mr-3 hidden rounded border border-kumo-line px-1.5 text-xs text-kumo-subtle md:block">/</kbd>}
		</form> : <div className="flex-1" />}
		<div className="flex shrink-0 items-center gap-1.5">
			<button ref={appearanceTrigger} className="mail-icon-button desktop-theme-toggle" type="button" aria-label="Appearance" aria-haspopup="dialog" onClick={() => openAppearance("desktop")} title="Appearance"><PaletteIcon size={20} /></button>
			<button type="button" className="account-avatar phone-account-button" ref={avatar} onClick={() => setShowPicker(true)} aria-label="Switch mailbox" aria-haspopup="dialog">
				{(active?.name || session?.email || "Inbox").charAt(0).toUpperCase()}
			</button>
			<details className="account-menu" ref={menu}>
				<summary className="account-avatar" aria-label="Account menu">{session?.email?.charAt(0).toUpperCase() || "A"}</summary>
				<div className="account-dropdown">
					<div className="border-b border-kumo-line px-3 py-2"><p className="workspace-label">Signed in as</p><p className="mt-1 break-all text-sm">{session?.email || "Workspace owner"}</p></div>
					<InstallApp />
					<Link to="/account" className="mail-nav-link" onClick={() => { if (menu.current) menu.current.open = false; }}><GearSixIcon size={18} /> Account settings</Link>
					<button type="button" className="mail-nav-link" onClick={() => void signOut()} disabled={loggingOut}><SignOutIcon size={18} /> {loggingOut ? "Signing out…" : "Sign out"}</button>
					{error && <p role="alert" className="form-error px-3">{error}</p>}
				</div>
			</details>
		</div>
		{showPicker && <MobileMailboxPicker activeId={activeId} email={session?.email ?? undefined} onClose={() => setShowPicker(false)} returnFocus={avatar}>
			<Link to="/account" className="mail-nav-link" onClick={() => setShowPicker(false)}><GearSixIcon size={19} /> Account settings</Link>
			<button type="button" className="mail-nav-link" onClick={() => openAppearance("phone")} aria-haspopup="dialog"><PaletteIcon size={19} /> Appearance</button>
			<InstallApp />
			<button type="button" className="mail-nav-link" onClick={() => void signOut()} disabled={loggingOut}><SignOutIcon size={19} /> {loggingOut ? "Signing out…" : "Sign out"}</button>
			{error && <p role="alert" className="form-error px-3">{error}</p>}
		</MobileMailboxPicker>}
		{appearance && <AppearanceDialog returnFocus={appearance === "phone" ? avatar : appearanceTrigger} onClose={() => setAppearance(null)} />}
	</header>;
}
