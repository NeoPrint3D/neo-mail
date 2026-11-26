import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { splitEmailList } from "~/lib/utils";

const maxDestinations = 10;
export const forwardingAddresses = (rows: string[]) => [...new Set(rows.flatMap(splitEmailList).map((email) => email.toLowerCase()))];

export default function ForwardingAddresses({ label, value, onChange, disabled, description }: {
	label: string;
	value: string[];
	onChange: (rows: string[]) => void;
	disabled?: boolean;
	description?: string;
}) {
	const inputs = useRef<(HTMLInputElement | null)[]>([]);
	const [error, setError] = useState("");
	const rows = value.length ? value : [""];

	function setRows(next: string[], focus?: number) {
		setError(""); onChange(next);
		if (focus !== undefined) requestAnimationFrame(() => inputs.current[focus]?.focus());
	}

	return <fieldset className="min-w-0 space-y-2" disabled={disabled}>
		<legend className="mb-1 text-sm font-medium">{label}</legend>
		{description && <p className="text-xs text-kumo-subtle">{description}</p>}
		{rows.map((address, index) => <div className="flex items-center gap-2" key={index}>
			<input className="field-input min-w-0" ref={(input) => { inputs.current[index] = input; }} type="text" inputMode="email" autoCapitalize="none" autoComplete="off" spellCheck={false}
				aria-label={`${label} ${index + 1}`} placeholder={index ? "another@example.com" : "name@example.com"} value={address}
				onChange={(event) => setRows(rows.map((item, i) => i === index ? event.target.value : item))}
				onPaste={(event) => {
					const pasted = splitEmailList(event.clipboardData.getData("text"));
					if (pasted.length <= 1) return;
					event.preventDefault();
					const next = [...rows.slice(0, index), ...pasted, ...rows.slice(index + 1)];
					if (next.length > maxDestinations) { setError(`Use up to ${maxDestinations} forwarding addresses.`); return; }
					setRows(next, index + pasted.length - 1);
				}} />
			{rows.length > 1 && <button type="button" className="mail-icon-button" aria-label={`Remove forwarding address ${index + 1}`}
				onClick={() => setRows(rows.filter((_, i) => i !== index), Math.min(index, rows.length - 2))}><XIcon size={17} /></button>}
		</div>)}
		<button type="button" className="mail-button" disabled={disabled || rows.length >= maxDestinations} onClick={() => setRows([...rows, ""], rows.length)}>
			<PlusIcon size={16} /> Add address
		</button>
		{error && <p className="form-error" role="alert">{error}</p>}
	</fieldset>;
}
