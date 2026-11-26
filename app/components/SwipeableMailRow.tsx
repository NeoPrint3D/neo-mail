import { useRef, useState, type MouseEvent, type ReactNode, type TouchEvent } from "react";

export interface SwipeAction {
	label: string;
	icon: ReactNode;
	tone: "accent" | "danger";
	onTrigger: () => void;
}

export default function SwipeableMailRow({
	as = "li",
	className = "",
	leftAction,
	rightAction,
	disabled = false,
	children,
}: {
	as?: "li" | "div";
	className?: string;
	leftAction?: SwipeAction;
	rightAction?: SwipeAction;
	disabled?: boolean;
	children: ReactNode;
}) {
	const rowRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{ x: number; y: number; lock: "x" | "y" | null } | null>(null);
	const suppressClickUntil = useRef(0);
	const [side, setSide] = useState<"left" | "right" | null>(null);
	const [armed, setArmed] = useState(false);

	const threshold = () => {
		const width = rowRef.current?.clientWidth || window.innerWidth;
		return Math.max(72, Math.min(108, width * 0.24));
	};

	function resetVisual() {
		if (rowRef.current) rowRef.current.style.transform = "";
		setSide(null);
		setArmed(false);
	}

	function onTouchStart(event: TouchEvent<HTMLElement>) {
		if (disabled || (!leftAction && !rightAction) || event.touches.length !== 1) {
			dragRef.current = null;
			return;
		}
		const touch = event.touches[0];
		if (touch.clientX <= 22 || touch.clientX >= window.innerWidth - 22) {
			dragRef.current = null;
			return;
		}
		if (event.target instanceof Element && event.target.closest("input, textarea, select")) {
			dragRef.current = null;
			return;
		}
		dragRef.current = { x: touch.clientX, y: touch.clientY, lock: null };
	}

	function onTouchMove(event: TouchEvent<HTMLElement>) {
		const drag = dragRef.current;
		if (!drag || event.touches.length !== 1) return;
		const touch = event.touches[0];
		const dx = touch.clientX - drag.x;
		const dy = touch.clientY - drag.y;
		if (drag.lock === null) {
			if (Math.hypot(dx, dy) < 8) return;
			if (Math.abs(dx) > Math.abs(dy) * 1.15) {
				drag.lock = "x";
			} else {
				drag.lock = "y";
				resetVisual();
				return;
			}
		}
		if (drag.lock !== "x") return;

		let clamped = Math.max(-128, Math.min(128, dx));
		if (clamped > 0 && !leftAction) clamped = 0;
		if (clamped < 0 && !rightAction) clamped = 0;

		if (rowRef.current) rowRef.current.style.transform = clamped ? `translate3d(${clamped}px, 0, 0)` : "";
		const nextSide = clamped > 4 ? "left" : clamped < -4 ? "right" : null;
		const nextArmed = Math.abs(clamped) >= threshold();
		if (nextSide !== side) setSide(nextSide);
		if (nextArmed !== armed) setArmed(nextArmed);
		if (clamped !== 0) suppressClickUntil.current = Date.now() + 250;
	}

	function onTouchEnd(event: TouchEvent<HTMLElement>) {
		const drag = dragRef.current;
		dragRef.current = null;
		const touch = event.changedTouches[0];
		if (!drag || !touch) {
			resetVisual();
			return;
		}
		const dx = touch.clientX - drag.x;
		const dy = touch.clientY - drag.y;
		const limit = threshold();
		const horizontalFlick = drag.lock === "x" || (drag.lock === null && Math.abs(dx) >= limit && Math.abs(dx) > Math.abs(dy) * 1.4);
		resetVisual();
		if (!horizontalFlick || disabled) return;

		if (dx <= -limit && rightAction) {
			suppressClickUntil.current = Date.now() + 450;
			rightAction.onTrigger();
		} else if (dx >= limit && leftAction) {
			suppressClickUntil.current = Date.now() + 450;
			leftAction.onTrigger();
		}
	}

	function onTouchCancel() {
		dragRef.current = null;
		resetVisual();
	}

	function onClickCapture(event: MouseEvent<HTMLElement>) {
		if (Date.now() < suppressClickUntil.current) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	const Tag = as;
	const active = side === "left" ? leftAction : side === "right" ? rightAction : undefined;

	return (
		<Tag
			className="mail-swipe-row"
			data-swiping={side ? "true" : undefined}
			onTouchStart={onTouchStart}
			onTouchMove={onTouchMove}
			onTouchEnd={onTouchEnd}
			onTouchCancel={onTouchCancel}
			onClickCapture={onClickCapture}
		>
			{active && (
				<div
					aria-hidden="true"
					className="mail-swipe-backdrop"
					data-side={side}
					data-tone={active.tone}
					data-armed={armed ? "true" : "false"}
				>
					<span className="mail-swipe-action">
						{active.icon}
						<span>{active.label}</span>
					</span>
				</div>
			)}
			<div ref={rowRef} className={`mail-swipe-surface ${className}`}>
				{children}
			</div>
		</Tag>
	);
}
