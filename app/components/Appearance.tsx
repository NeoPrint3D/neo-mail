import { CheckIcon, PaletteIcon } from "@phosphor-icons/react";
import { useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { currentTheme, defaultTheme, selectTheme, subscribeTheme, themes, type MailTheme } from "~/lib/themes";
import AppDialog from "./AppDialog";
import Button from "./Button";

function useTheme() {
	return useSyncExternalStore(subscribeTheme, currentTheme, () => defaultTheme);
}

function ThemePreview({ theme }: { theme: MailTheme }) {
	return <span className="theme-preview shrink-0" aria-hidden="true">
		<span style={{ background: theme.canvas }} /><span style={{ background: theme.raised }} /><span style={{ background: theme.accent }} />
	</span>;
}

export function AppearanceDialog({ onClose, returnFocus }: { onClose: () => void; returnFocus?: RefObject<HTMLElement | null> }) {
	const active = useTheme();
	return <AppDialog title="Appearance" description="Choose a theme for NeoMail. Your preference is saved on this device."
		icon={<PaletteIcon size={24} weight="duotone" />} wide onClose={onClose} returnFocus={returnFocus}>
		<div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="App theme">
			{themes.map((theme) => <button key={theme.id} type="button" className="theme-choice min-w-0 text-left" aria-pressed={active.id === theme.id}
				onClick={() => selectTheme(theme)}>
				<ThemePreview theme={theme} />
				<span className="min-w-0 flex-1 text-sm font-semibold">{theme.name}</span>
				{active.id === theme.id && <CheckIcon size={16} className="shrink-0 text-kumo-link" aria-hidden="true" />}
			</button>)}
		</div>
		<p className="mt-3 text-xs text-kumo-subtle">The light and dark paper controls inside messages stay separate from the app theme.</p>
	</AppDialog>;
}

export function AppearanceSettings() {
	const active = useTheme();
	const [open, setOpen] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	return <section className="settings-card max-w-xl space-y-3" aria-labelledby="appearance-heading">
		<h2 id="appearance-heading" className="flex items-center gap-2 font-semibold"><PaletteIcon size={19} /> Appearance</h2>
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p className="flex items-center gap-2 text-sm"><ThemePreview theme={active} />{active.name}</p>
			<Button ref={button} onClick={() => setOpen(true)} aria-haspopup="dialog">Choose theme</Button>
		</div>
		{open && <AppearanceDialog onClose={() => setOpen(false)} returnFocus={button} />}
	</section>;
}
