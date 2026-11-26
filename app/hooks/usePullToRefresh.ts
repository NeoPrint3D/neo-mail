import { useRef, type TouchEvent } from "react";

// Refresh only after an intentional downward drag from the top of the list.
// Leave the horizontal edge gesture, selection, and multi-touch to the browser.
export function usePullToRefresh(refresh: () => void, disabled: boolean) {
	const start = useRef<{ x: number; y: number } | null>(null);
	return {
		onTouchStart(event: TouchEvent<HTMLElement>) {
			const touch = event.touches[0];
			start.current = !disabled && event.touches.length === 1 && event.currentTarget.scrollTop <= 0 && touch.clientX > 22
				&& touch.clientX < window.innerWidth - 22 && !(event.target instanceof Element && event.target.closest("button:not([data-mail-pull]),input,textarea"))
				? { x: touch.clientX, y: touch.clientY } : null;
		},
		onTouchMove(event: TouchEvent<HTMLElement>) {
			if (event.touches.length !== 1 || event.currentTarget.scrollTop > 2) start.current = null;
		},
		onTouchEnd(event: TouchEvent<HTMLElement>) {
			const origin = start.current;
			start.current = null;
			const touch = event.changedTouches[0];
			if (!disabled && origin && touch && touch.clientY - origin.y > 76 && Math.abs(touch.clientX - origin.x) < 42) refresh();
		},
		onTouchCancel() { start.current = null; },
	};
}
