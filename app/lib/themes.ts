export const themes = [
	{ id: "neo-dark", name: "NeoMail Dark", mode: "dark", canvas: "#131820", panel: "#1a202a", raised: "#252e3b", line: "#354153", text: "#e8eef7", muted: "#9cacc0", accent: "#90e7c7", danger: "#ffadb3", star: "#ffd16a" },
	{ id: "neo-light", name: "NeoMail Light", mode: "light", canvas: "#f0f4f9", panel: "#ffffff", raised: "#edf2f7", line: "#d5dee8", text: "#162131", muted: "#52637b", accent: "#0c6b58", danger: "#a82535", star: "#895b00" },
	{ id: "catppuccin-mocha", name: "Catppuccin Mocha", mode: "dark", canvas: "#181825", panel: "#1e1e2e", raised: "#313244", line: "#45475a", text: "#cdd6f4", muted: "#a6adc8", accent: "#cba6f7", danger: "#f38ba8", star: "#f9e2af" },
	{ id: "catppuccin-latte", name: "Catppuccin Latte", mode: "light", canvas: "#e6e9ef", panel: "#eff1f5", raised: "#dce0e8", line: "#bcc0cc", text: "#303446", muted: "#51576d", accent: "#7524be", danger: "#aa2348", star: "#895900" },
	{ id: "tokyo-night", name: "Tokyo Night", mode: "dark", canvas: "#16161e", panel: "#1a1b26", raised: "#24283b", line: "#3b4261", text: "#c0caf5", muted: "#a9b5d7", accent: "#9db8ff", danger: "#f7768e", star: "#e0af68" },
	{ id: "dracula", name: "Dracula", mode: "dark", canvas: "#21222c", panel: "#282a36", raised: "#343746", line: "#48506b", text: "#f8f8f2", muted: "#bcc2db", accent: "#bd93f9", danger: "#ff8888", star: "#f1fa8c" },
	{ id: "nord", name: "Nord", mode: "dark", canvas: "#282e3a", panel: "#2e3440", raised: "#3b4252", line: "#4c566a", text: "#eceff4", muted: "#c7d2e4", accent: "#88c0d0", danger: "#f0a0aa", star: "#ebcb8b" },
	{ id: "gruvbox", name: "Gruvbox Dark", mode: "dark", canvas: "#1d2021", panel: "#282828", raised: "#3c3836", line: "#504945", text: "#ebdbb2", muted: "#bdae93", accent: "#fabd2f", danger: "#fb8978", star: "#fabd2f" },
] as const;

export type MailTheme = typeof themes[number];
export const defaultTheme = themes[0];
const storageKey = "neomail-theme";
const changed = "neomail:theme";

export const themeStyles = themes.map(({ id, mode, name: _name, ...tokens }) => `html[data-mail-theme="${id}"]{color-scheme:${mode};--neo-on-accent:${mode === "dark" ? "#121b23" : "#fff"};--neo-shadow:${mode === "dark" ? "#0307117a" : "#20345424"};${Object.entries(tokens).map(([key, value]) => `--neo-${key}:${value};`).join("")}}`).join("\n");

// Apply the preference before first paint, including a one-time fallback to
// the original app's dark/light preference. Only known palettes may be applied.
export const themeBootScript = `try{const themes=${JSON.stringify(themes.map(({ id, mode, canvas }) => ({ id, mode, canvas })))};const id=localStorage.getItem(${JSON.stringify(storageKey)})||(localStorage.getItem("inbox-theme")==="light"?"neo-light":"neo-dark");const theme=themes.find(t=>t.id===id);if(theme){document.documentElement.dataset.mailTheme=theme.id;document.documentElement.dataset.mode=theme.mode;document.querySelector('meta[name="theme-color"]').content=theme.canvas}}catch{}`;

export function currentTheme(): MailTheme {
	return themes.find(({ id }) => id === document.documentElement.dataset.mailTheme) ?? defaultTheme;
}

function apply(theme: MailTheme) {
	document.documentElement.dataset.mailTheme = theme.id;
	document.documentElement.dataset.mode = theme.mode;
	document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.canvas);
	window.dispatchEvent(new Event(changed));
}

export function subscribeTheme(callback: () => void) {
	function sync(event: StorageEvent) {
		if (event.key === storageKey || event.key === null) apply(themes.find(({ id }) => id === event.newValue) ?? defaultTheme);
	}
	window.addEventListener(changed, callback);
	window.addEventListener("storage", sync);
	return () => { window.removeEventListener(changed, callback); window.removeEventListener("storage", sync); };
}

export function selectTheme(theme: MailTheme) {
	apply(theme);
	try { localStorage.setItem(storageKey, theme.id); } catch { /* private browser */ }
}
