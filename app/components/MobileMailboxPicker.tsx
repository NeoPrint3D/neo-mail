import { AtIcon, CheckIcon, GearSixIcon, MagnifyingGlassIcon, PlusIcon, TrayIcon } from "@phosphor-icons/react";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useNavigate } from "react-router";
import { useMailboxes } from "~/queries/mailboxes";
import AppDialog from "./AppDialog";
import CreateMailboxDialog from "./CreateMailboxDialog";

export default function MobileMailboxPicker({ activeId, email, onClose, returnFocus, children }: {
	activeId: string; email?: string; onClose: () => void; returnFocus: RefObject<HTMLButtonElement | null>; children: ReactNode;
}) {
	const { data: mailboxes = [], isPending, isError, refetch } = useMailboxes();
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [adding, setAdding] = useState(false);
	const search = useRef<HTMLInputElement>(null);
	const terms = query.trim().toLowerCase().split(/\s+/);
	const filtered = mailboxes.filter(({ name, email, disposable }) => terms.every((term) => `${name} ${email}${disposable ? " disposable" : ""}`.toLowerCase().includes(term)));
	const domains = [...new Set(filtered.map(({ domain }) => domain))];

	return <AppDialog title="Switch mailbox" description={email ? `Signed in as ${email}` : "Choose an inbox to open."} icon={<AtIcon size={25} />} onClose={onClose} returnFocus={returnFocus}>
		<div className="phone-picker-search">
			<MagnifyingGlassIcon size={20} aria-hidden="true" />
			<input ref={search} type="search" autoCapitalize="none" autoComplete="off" aria-label="Search mailboxes" placeholder="Search mailboxes" value={query} onChange={(event) => setQuery(event.target.value)} />
		</div>
		{!query.trim() && <Link className="phone-picker-row" to="/" onClick={onClose} aria-current={!activeId ? "page" : undefined}>
			<TrayIcon size={21} /><span className="min-w-0 flex-1 font-semibold">All inboxes</span>{!activeId && <CheckIcon size={19} />}
		</Link>}
		{domains.map((domain) => <section key={domain} aria-label={domain}>
			<h3 className="workspace-label px-2 pb-1">{domain}</h3>
			{filtered.filter((box) => box.domain === domain).map((box) => <Link key={box.id} className="phone-picker-row" to={`/mailbox/${encodeURIComponent(box.id)}/emails/inbox`} onClick={onClose} aria-current={box.id === activeId ? "page" : undefined}>
				<span className="mail-avatar" aria-hidden="true">{(box.name || box.email).charAt(0).toUpperCase()}</span>
				<span className="min-w-0 flex-1"><span className="block truncate font-semibold">{box.name}{box.disposable && <span className="ml-2 mail-label">Disposable</span>}</span><span className="block truncate text-xs text-kumo-subtle">{box.email}</span></span>
				{box.id === activeId && <CheckIcon size={19} className="shrink-0" />}
			</Link>)}
		</section>)}
		{isPending ? <p role="status" className="px-2 text-sm text-kumo-subtle">Loading mailboxes…</p> : isError ? <p role="alert" className="px-2 text-sm">Could not load mailboxes. <button className="text-kumo-link" type="button" onClick={() => void refetch()}>Retry</button></p> : !filtered.length && <p className="px-2 text-sm text-kumo-subtle">{query.trim() ? "No mailboxes match your search." : "No mailboxes yet."}</p>}
		<div className="reader-action-list border-t border-kumo-line pt-2">
			<button className="mail-nav-link" type="button" onClick={() => setAdding(true)}><PlusIcon size={19} />Add a mailbox</button>
			<Link className="mail-nav-link" to="/mailboxes" onClick={onClose}><GearSixIcon size={19} />Manage mailboxes</Link>
			<details className="phone-workspace-settings">
				<summary className="mail-nav-link"><GearSixIcon size={19} />Account &amp; appearance</summary>
				<div className="reader-action-list pl-2">{children}</div>
			</details>
		</div>
		{adding && <CreateMailboxDialog initialAddress={query.trim()} onClose={() => setAdding(false)} onCreated={(box) => {
			onClose(); navigate(`/mailbox/${encodeURIComponent(box.id)}/emails/inbox`);
		}} />}
	</AppDialog>;
}
