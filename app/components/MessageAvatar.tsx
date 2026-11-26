import { CheckIcon } from "@phosphor-icons/react";

export default function MessageAvatar({ sender, label, checked, disabled, onToggle }: {
	sender: string; label?: string; checked?: boolean; disabled?: boolean; onToggle?: () => void;
}) {
	const text = sender.replace(/^To:\s*/i, "").trim();
	const initial = Array.from(text)[0]?.toUpperCase() || "?";
	const tone = Array.from(text.toLowerCase()).reduce((hash, character) => (hash * 31 + (character.codePointAt(0) ?? 0)) % 5, 0);
	if (!onToggle) return <span className="phone-message-avatar mail-avatar" data-tone={tone} aria-hidden="true">{initial}</span>;
	return <button className="phone-message-avatar mail-avatar" data-tone={tone} type="button" disabled={disabled} aria-label={label} aria-pressed={checked}
		onClick={(event) => { event.stopPropagation(); onToggle(); }}>{checked ? <CheckIcon size={20} weight="bold" /> : initial}</button>;
}
