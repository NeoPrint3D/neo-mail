import { useEffect } from "react";

// Home Screen Safari shrinks the visual viewport (not the layout viewport)
// when the keyboard appears. Leave pinch zoom and ordinary browser chrome alone.
export function useVisualViewport() {
	useEffect(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		const root = document.documentElement;
		let frame = 0;
		const sync = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const active = document.activeElement;
				const editing = active instanceof HTMLElement && (active.isContentEditable || active.matches("input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea"));
				const keyboard = editing && Math.abs(viewport.scale - 1) < 0.01 && root.clientHeight - viewport.height > 100;
				if (keyboard) {
					root.style.setProperty("--keyboard-viewport-height", `${Math.round(viewport.height)}px`);
					root.style.setProperty("--keyboard-viewport-top", `${Math.round(viewport.offsetTop)}px`);
					root.dataset.keyboard = "open";
				} else {
					root.style.removeProperty("--keyboard-viewport-height");
					root.style.removeProperty("--keyboard-viewport-top");
					delete root.dataset.keyboard;
				}
			});
		};
		viewport.addEventListener("resize", sync);
		viewport.addEventListener("scroll", sync);
		document.addEventListener("focusin", sync);
		document.addEventListener("focusout", sync);
		sync();
		return () => {
			cancelAnimationFrame(frame);
			viewport.removeEventListener("resize", sync);
			viewport.removeEventListener("scroll", sync);
			document.removeEventListener("focusin", sync);
			document.removeEventListener("focusout", sync);
			root.style.removeProperty("--keyboard-viewport-height");
			root.style.removeProperty("--keyboard-viewport-top");
			delete root.dataset.keyboard;
		};
	}, []);
}
