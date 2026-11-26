import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { defaultTheme, themes, themeBootScript, themeStyles } from "../app/lib/themes.ts";

function boot(prefs) {
	const dataset = { mailTheme: defaultTheme.id, mode: defaultTheme.mode };
	const meta = { content: defaultTheme.canvas };
	runInNewContext(themeBootScript, { localStorage: { getItem: (key) => prefs[key] }, document: { documentElement: { dataset }, querySelector: () => meta } });
	return [dataset.mailTheme, dataset.mode, meta.content];
}

const luminance = (hex) => hex.slice(1).match(/../g).map((pair) => parseInt(pair, 16) / 255)
	.map((rgb) => rgb <= 0.04045 ? rgb / 12.92 : ((rgb + 0.055) / 1.055) ** 2.4)
	.reduce((sum, rgb, index) => sum + rgb * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test("NeoMail restores valid device themes before paint and migrates the old light preference", () => {
	assert.deepEqual(boot({ "inbox-theme": "light" }), ["neo-light", "light", "#f0f4f9"]);
	assert.deepEqual(boot({ "neomail-theme": "catppuccin-mocha", "inbox-theme": "light" }), ["catppuccin-mocha", "dark", "#181825"]);
	assert.deepEqual(boot({ "neomail-theme": "unexpected" }), [defaultTheme.id, defaultTheme.mode, defaultTheme.canvas]);
});

test("built-in palettes have unique ids and accessible text, muted text and links", () => {
	assert.equal(new Set(themes.map((theme) => theme.id)).size, themes.length);
	for (const { id, panel, canvas, raised, text, muted, accent } of themes) {
		assert.ok(themeStyles.includes(`data-mail-theme="${id}"`));
		for (const foreground of [text, muted, accent]) for (const background of [panel, canvas, raised]) {
			assert.ok(contrast(foreground, background) >= 4.5, `${id}: ${foreground} on ${background}`);
		}
	}
});
