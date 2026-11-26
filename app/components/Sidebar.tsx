// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { ArchiveIcon, AtIcon, EnvelopeSimpleIcon, FileIcon, FolderIcon, GearSixIcon, GlobeHemisphereWestIcon, PaperPlaneTiltIcon, PencilSimpleIcon, PlugsIcon, ShareNetworkIcon, StarIcon, TrashIcon, TrayIcon, WarningOctagonIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link, useLocation, useMatch, useNavigate, useParams, useSearchParams } from "react-router";
import { Folders } from "shared/folders";
import { useFolders } from "~/queries/folders";
import { useMailbox, useMailboxes } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";
import MailboxSelect from "./MailboxSelect";

const folders = [
	{ id: Folders.INBOX, label: "Inbox", icon: TrayIcon },
	{ id: "unread", label: "Unread", icon: EnvelopeSimpleIcon },
	{ id: "starred", label: "Starred", icon: StarIcon },
	{ id: Folders.SENT, label: "Sent", icon: PaperPlaneTiltIcon },
	{ id: Folders.DRAFT, label: "Drafts", icon: FileIcon },
	{ id: Folders.ARCHIVE, label: "Archive", icon: ArchiveIcon },
	{ id: Folders.SPAM, label: "Spam", icon: WarningOctagonIcon },
	{ id: Folders.TRASH, label: "Trash", icon: TrashIcon },
];

function SidebarLink({ to, icon, label, active, count }: { to: string; icon: ReactNode; label: string; active?: boolean; count?: number }) {
	const closeSidebar = useUIStore((s) => s.closeSidebar);
	return <Link to={to} onClick={closeSidebar} className={`mail-nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
		<span className="shrink-0" aria-hidden="true">{icon}</span><span className="min-w-0 flex-1 truncate">{label}</span>
		{!!count && <span className="text-xs tabular-nums">{count}</span>}
	</Link>;
}

function SettingsLinks({ pathname }: { pathname: string }) {
	return <>
		<SidebarLink to="/routing" label="Email routing" icon={<ShareNetworkIcon size={18} />} active={pathname === "/routing"} />
		<SidebarLink to="/domains" label="Domains & DNS" icon={<GlobeHemisphereWestIcon size={18} />} active={pathname === "/domains"} />
		<SidebarLink to="/integrations" label="MCP connections" icon={<PlugsIcon size={18} />} active={pathname === "/integrations"} />
	</>;
}

export default function Sidebar({ onCompose, mobile }: { onCompose: () => void; mobile?: boolean }) {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const folder = useMatch("/mailbox/:mailboxId/emails/:folder")?.params.folder;
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const [params] = useSearchParams();
	const { data: mailboxes = [], isPending, isError } = useMailboxes();
	const { data: mailbox } = useMailbox(mailboxId);
	const { data: mailboxFolders = [] } = useFolders(mailboxId);
	const closeSidebar = useUIStore((s) => s.closeSidebar);
	const path = mailboxId ? `/mailbox/${encodeURIComponent(mailboxId)}` : "";
	function workspaceFolder(id: string) {
		const q = new URLSearchParams();
		for (const key of ["domain", "mailbox"]) if (pathname === "/" && params.get(key)) q.set(key, params.get(key)!);
		if (id !== Folders.INBOX) q.set("view", id);
		return q.size ? `/?${q}` : "/";
	}

	return <aside className="mail-sidebar">
		<div className="desktop-compose px-2 pt-2 pb-4">
			<button type="button" className="compose-trigger" disabled={!mailboxes.length} onClick={onCompose}><PencilSimpleIcon size={21} weight="bold" /> Compose</button>
		</div>
		<nav aria-label="Mail navigation" className="min-h-0 flex-1 overflow-y-auto px-2 pb-5">
			{mailboxId && <SidebarLink to="/" label="All inboxes" icon={<TrayIcon size={18} />} />}
			{!mobile && <div className="mt-1 mb-2 px-2">
				<p className="workspace-label mb-2" title={mailboxId}>{mailbox?.name || (mailboxId ? "Current mailbox" : "Workspace mail")}</p>
				<MailboxSelect mailboxes={mailboxes} value={mailboxId || ""} label="Switch mailbox" allLabel="All mailboxes" allowCreate disabled={isPending} preferredDomain={mailbox?.domain || params.get("domain") || undefined}
					onChange={(id) => { closeSidebar(); navigate(id ? `/mailbox/${encodeURIComponent(id)}/emails/inbox` : "/"); }} />
				{isError && <p className="mt-1 text-xs text-kumo-subtle">Could not load mailboxes.</p>}
			</div>}
			{folders.filter(({ id }) => !mailboxId || (id !== "unread" && id !== "starred")).map(({ id, label, icon: Icon }) => <SidebarLink key={id} to={mailboxId ? `${path}/emails/${id}` : workspaceFolder(id)}
				label={label} icon={<Icon size={19} weight="regular" />} active={mailboxId ? folder === id : pathname === "/" && !params.get("q") && (params.get("view") || Folders.INBOX) === id}
				count={mailboxId && mailbox && !mailbox.disposable ? mailboxFolders.find((row) => row.id === id)?.unreadCount : undefined} />)}
			{mailboxId && <section className="mail-nav-section">
				<p className="workspace-label px-3 pb-1">Mailbox</p>
				{mailboxFolders.filter((row) => !folders.some(({ id }) => id === row.id)).map((row) => <SidebarLink key={row.id} to={`${path}/emails/${encodeURIComponent(row.id)}`} label={row.name} active={folder === row.id} icon={<FolderIcon size={17} />} count={mailbox && !mailbox.disposable ? row.unreadCount : undefined} />)}
				<SidebarLink to={`${path}/settings`} label="Mailbox settings" icon={<GearSixIcon size={17} />} active={pathname.endsWith("/settings")} />
			</section>}
			<section className="mail-nav-section">

				<SidebarLink to="/mailboxes" label={mobile ? "Manage mailboxes" : "Mailboxes"} icon={<AtIcon size={18} />} active={pathname === "/mailboxes"} />
				{mobile ? <details className="phone-workspace-settings" open={["/routing", "/domains", "/integrations"].includes(pathname) || undefined}>
					<summary className="mail-nav-link"><GearSixIcon size={18} /> Workspace settings</summary>
					<SettingsLinks pathname={pathname} />
				</details> : <SettingsLinks pathname={pathname} />}
			</section>
		</nav>
	</aside>;
}
