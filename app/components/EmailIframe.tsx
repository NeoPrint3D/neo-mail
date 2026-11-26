// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified for NeoMail; see NOTICE and MODIFICATIONS.md.

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import DOMPurify from "dompurify";
import { useCallback, useEffect, useRef, useState } from "react";

interface EmailIframeProps {
	body: string;
	/** When true, iframe auto-sizes to content height instead of filling parent */
	autoSize?: boolean;
}

/**
 * Renders email HTML inside a sandboxed iframe.
 *
 * Security model:
 * - DOMPurify sanitises the HTML before injection.
 * - The iframe sandbox does NOT include `allow-same-origin`, so even if
 *   DOMPurify has a bypass the attacker's code runs in an opaque origin
 *   with no access to the parent page's cookies, DOM, or API.
 * - Because the iframe is cross-origin we cannot read `contentDocument`
 *   for auto-sizing. Instead, the injected HTML includes a tiny inline
 *   script that posts its body height to the parent via `postMessage`.
 * - A strict CSP meta tag blocks external resource loads inside the
 *   iframe as a defense-in-depth layer.
 */
export default function EmailIframe({ body, autoSize }: EmailIframeProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(autoSize ? 100 : 0);
	const [paperMode, setPaperMode] = useState<"dark" | "light">(() =>
		typeof document !== "undefined" && document.documentElement.dataset.mode === "light" ? "light" : "dark",
	);

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			if (!autoSize) return;
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (
				event.data &&
				typeof event.data === "object" &&
				event.data.__emailIframeHeight &&
				Number.isFinite(event.data.height) &&
				event.data.height > 0
			) {
				setHeight(Math.min(100_000, Math.ceil(event.data.height) + 2));
			}
		},
		[autoSize],
	);

	useEffect(() => {
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [handleMessage]);

	useEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe || !body) return;

		const cleanBody = DOMPurify.sanitize(body, {
			USE_PROFILES: { html: true },
			FORBID_TAGS: ["style"],
			ADD_ATTR: ["target"],
			FORCE_BODY: true,
		});

		const padding = autoSize ? "16px" : "24px";
		const dark = paperMode === "dark";
		const bg = dark ? "#161c25" : "#ffffff";
		const fg = dark ? "#e8eef7" : "#1a1a1a";
		const link = dark ? "#93c5fd" : "#2563eb";
		const quoteBorder = dark ? "#3b495e" : "#d1d5db";
		const quoteColor = dark ? "#9cacc0" : "#6b7280";
		const preBg = dark ? "#212936" : "#f3f4f6";

		const layoutScript = `<script>
			(function() {
				var lastW = 0, lastNat = 0, lastH = 0, raf = 0;
				function fit() {
					raf = 0;
					var doc = document.documentElement;
					var body = document.body;
					if (!doc || !body) return;
					var avail = doc.clientWidth;
					body.style.transform = "";
					body.style.width = "";
					body.style.maxWidth = "";
					var natural = Math.max(body.scrollWidth, doc.scrollWidth);
					var scale = (avail > 0 && natural > avail + 1) ? Math.max(0.3, avail / natural) : 1;
					if (scale < 1) {
						body.style.maxWidth = "none";
						body.style.width = natural + "px";
						body.style.transform = "scale(" + scale + ")";
					}
					var h = Math.max(Math.ceil(body.getBoundingClientRect().height), Math.ceil(body.scrollHeight * scale));
					if (${autoSize ? "true" : "false"} && h > 0 && (avail !== lastW || natural !== lastNat || h !== lastH)) {
						lastW = avail; lastNat = natural; lastH = h;
						parent.postMessage({ __emailIframeHeight: true, height: h }, "*");
					}
				}
				function schedule() { if (!raf) raf = requestAnimationFrame(fit); }
				fit();
				window.addEventListener("load", fit, { once: true });
				window.addEventListener("resize", schedule);
				if (typeof ResizeObserver === "function") new ResizeObserver(schedule).observe(document.documentElement);
			})();
		<\/script>`;

		iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: https:; script-src 'unsafe-inline';">
<style>
* { box-sizing: border-box; }
html {
	background: ${bg};
	color-scheme: ${dark ? "dark" : "light"};
	max-width: 100%;
	overflow-x: hidden;
}
body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-size: 14px;
	line-height: 1.65;
	color: ${fg};
	background: ${bg};
	padding: ${padding};
	margin: 0;
	max-width: 100%;
	word-wrap: break-word;
	overflow-wrap: break-word;
	transform-origin: top left;
}
[style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
	position: relative !important;
}
a { color: ${link}; overflow-wrap: anywhere; }
img, svg, video { max-width: 100% !important; height: auto !important; }
blockquote {
	border-left: 3px solid ${quoteBorder};
	padding-left: 1em;
	margin-left: 0;
	color: ${quoteColor};
}
pre {
	background: ${preBg};
	padding: 12px;
	border-radius: 8px;
	max-width: 100%;
	overflow-x: auto;
	font-size: 13px;
}
table { border-collapse: collapse; max-width: 100% !important; min-width: 0 !important; }
td, th { padding: 4px 8px; min-width: 0 !important; }
@media (max-width: 640px) {
  body { font-size: 15px; padding: 12px; }
  div, section, header, footer, article, main, table, thead, tbody, tfoot, tr, td, th {
    max-width: 100% !important;
    min-width: 0 !important;
  }
  table, thead, tbody, tfoot, tr, td, th, div, p, span, li, a {
    white-space: normal !important;
    overflow-wrap: anywhere;
  }
}
p { margin: 4px 0; }
h1, h2, h3 { margin: 8px 0 4px; }
ul, ol { padding-left: 20px; margin: 4px 0; }
</style>
</head>
<body>${cleanBody}${layoutScript}</body>
</html>`;
	}, [body, autoSize, paperMode]);

	return (
		<div className={`relative w-full min-w-0 overflow-hidden ${autoSize ? "" : "h-full"}`}>
			<button
				type="button"
				onClick={() => setPaperMode((mode) => (mode === "dark" ? "light" : "dark"))}
				className={`inline-flex min-h-9 items-center gap-1 rounded-full border border-kumo-line bg-kumo-elevated px-3 text-xs font-medium text-kumo-strong hover:bg-kumo-fill ${autoSize ? "mb-2" : "absolute right-3 top-2.5 z-10"}`}
				title={paperMode === "dark" ? "Switch message to light paper" : "Switch message to dark paper"}
			>
				{paperMode === "dark" ? <SunIcon size={12} /> : <MoonIcon size={12} />}
				{paperMode === "dark" ? "Light paper" : "Dark paper"}
			</button>
			<iframe
				ref={iframeRef}
				className={`block w-full max-w-full min-w-0 border border-kumo-line rounded-xl ${autoSize ? "" : "h-full border-0 rounded-none"}`}
				style={autoSize ? { height: `${height}px` } : { height: "100%" }}
				sandbox="allow-scripts allow-popups allow-top-navigation-by-user-activation"
				title="Email content"
			/>
		</div>
	);
}
