import { Combobox } from "@base-ui/react/combobox";
import { CaretDownIcon, CheckIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

export type Choice = { value: string; label: string; description?: string; group?: string };
type Group = { label: string; items: Choice[] };

const searchText = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const matches = (item: Choice, query: string) => {
	const haystack = searchText([item.label, item.description, item.group, item.value].filter(Boolean).join(" "));
	return searchText(query).trim().split(/\s+/).every((word) => haystack.includes(word));
};

export default function SearchSelect({ options, value, onChange, label, showLabel, placeholder = "Select an option…", searchPlaceholder = "Search options…", empty = "No matching options.", disabled, icon, action, triggerRef }: {
	options: Choice[];
	value: string;
	onChange: (value: string) => void;
	label: string;
	showLabel?: boolean;
	placeholder?: string;
	searchPlaceholder?: string;
	empty?: string;
	disabled?: boolean;
	icon?: ReactNode;
	action?: { label: string; onSelect: (query: string) => void };
	triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
	const input = useRef<HTMLInputElement>(null);
	const triggerId = useId();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const selected = options.find((option) => option.value === value);
	const groups = useMemo(() => {
		const byLabel = new Map<string, Group>();
		for (const item of options) {
			const label = item.group || "";
			let group = byLabel.get(label);
			if (!group) byLabel.set(label, group = { label, items: [] });
			group.items.push(item);
		}
		return [...byLabel.values()];
	}, [options]);

	return <div className="choice-field">
		{showLabel && <label className="choice-label" htmlFor={triggerId}>{label}</label>}
		<Combobox.Root<Choice> items={groups} filter={matches} value={selected ?? null} isItemEqualToValue={(a, b) => a.value === b.value}
			disabled={disabled} open={open} inputValue={query} onInputValueChange={setQuery}
			onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}
			onValueChange={(item) => { if (item) onChange(item.value); }} autoHighlight>
			<Combobox.Trigger id={triggerId} ref={triggerRef} className="choice-trigger" title={selected?.description || selected?.label}
				aria-label={`${label}: ${selected?.label || placeholder}${selected?.description ? `, ${selected.description}` : ""}`}>
				{icon && <span className="choice-trigger-icon" aria-hidden="true">{icon}</span>}
				<span className="choice-trigger-text">
					<span className="truncate">{selected?.label || placeholder}</span>
					{selected?.description && <span className="choice-secondary truncate">{selected.description}</span>}
				</span>
				<CaretDownIcon size={14} className="choice-caret" aria-hidden="true" />
			</Combobox.Trigger>
			<Combobox.Portal>
				<Combobox.Positioner className="choice-positioner" sideOffset={7} align="start" collisionPadding={12}>
					<Combobox.Popup className="choice-popup" aria-label={label} initialFocus={(method) => method === "touch" ? true : input.current}>
						<div className="choice-search">
							<MagnifyingGlassIcon size={17} aria-hidden="true" />
							<Combobox.Input ref={input} autoComplete="off" spellCheck={false} placeholder={searchPlaceholder} aria-label={searchPlaceholder.replace(/…$/, "")}
								onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
						</div>
						<Combobox.Empty className="choice-empty">{empty}</Combobox.Empty>
						<Combobox.List className="choice-list">
							{(group: Group) => <Combobox.Group key={group.label} items={group.items}>
								{group.label && <Combobox.GroupLabel className="choice-group">{group.label}</Combobox.GroupLabel>}
								<Combobox.Collection>{(option: Choice) => <Combobox.Item key={option.value} value={option} className="choice-option">
									<span className="min-w-0 flex-1 break-words"><span className="block font-medium">{option.label}</span>
										{option.description && <span className="choice-secondary block">{option.description}</span>}</span>
									<Combobox.ItemIndicator className="shrink-0" aria-hidden="true"><CheckIcon size={16} weight="bold" /></Combobox.ItemIndicator>
								</Combobox.Item>}</Combobox.Collection>
							</Combobox.Group>}
						</Combobox.List>
						{action && <div className="choice-footer"><button className="choice-action" type="button" onClick={() => {
							const term = query.trim(); setOpen(false); setQuery(""); action.onSelect(term);
						}}><PlusIcon size={18} aria-hidden="true" />{action.label}</button></div>}
					</Combobox.Popup>
				</Combobox.Positioner>
			</Combobox.Portal>
		</Combobox.Root>
	</div>;
}

export const textChoices = (values: readonly string[]) => values.map((value) => ({ value, label: value }));
