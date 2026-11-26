import { AtIcon } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import type { Mailbox } from "~/types";
import CreateMailboxDialog from "./CreateMailboxDialog";
import SearchSelect, { type Choice } from "./SearchSelect";

export default function MailboxSelect({ mailboxes, value, onChange, label, showLabel, allLabel, disabled, allowCreate, preferredDomain, onCreated }: {
	mailboxes: Mailbox[];
	value: string;
	onChange: (value: string) => void;
	label: string;
	showLabel?: boolean;
	allLabel?: string;
	disabled?: boolean;
	allowCreate?: boolean;
	preferredDomain?: string;
	onCreated?: (mailbox: Mailbox) => void;
}) {
	const trigger = useRef<HTMLButtonElement>(null);
	const [adding, setAdding] = useState<string | null>(null);
	const options = useMemo(() => {
		const options: Choice[] = allLabel ? [{ value: "", label: allLabel }] : [];
		const sorted = [...mailboxes].sort((a, b) => a.domain.localeCompare(b.domain) || (a.name || a.email).localeCompare(b.name || b.email) || a.email.localeCompare(b.email));
		for (const mailbox of sorted) {
			const name = mailbox.name?.trim();
			options.push({ value: mailbox.id, label: `${name || mailbox.email}${mailbox.disposable ? " (Disposable)" : ""}`, description: name && name !== mailbox.email ? mailbox.email : undefined, group: mailbox.domain });
		}
		return options;
	}, [mailboxes, allLabel]);

	return <>
		<SearchSelect triggerRef={trigger} options={options} value={value} onChange={onChange} label={label} showLabel={showLabel} disabled={disabled}
			placeholder="Select a mailbox…" searchPlaceholder="Search mailboxes…" empty={mailboxes.length ? "No mailboxes match your search." : "No mailboxes have been added yet."}
			icon={<AtIcon size={18} />} action={allowCreate ? { label: "Add a mailbox", onSelect: setAdding } : undefined} />
		{adding !== null && <CreateMailboxDialog returnFocus={trigger} preferredDomain={preferredDomain} initialAddress={adding} onClose={() => setAdding(null)} onCreated={onCreated ?? ((mailbox) => onChange(mailbox.id))} />}
	</>;
}
