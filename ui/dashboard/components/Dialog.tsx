import {type ReactNode, type RefObject, useEffect, useId, useRef} from "react";

const FOCUSABLE =
	'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
	title,
	children,
	onClose,
	busy = false,
	wide = false,
	initialFocusRef,
}: {
	title: string;
	children: ReactNode;
	onClose: () => void;
	busy?: boolean;
	wide?: boolean;
	initialFocusRef?: RefObject<HTMLElement | null>;
}) {
	const titleId = useId();
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef(onClose);
	const busyRef = useRef(busy);
	closeRef.current = onClose;
	busyRef.current = busy;

	useEffect(() => {
		const previous =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const node = dialogRef.current;
		const initial =
			initialFocusRef?.current ??
			node?.querySelector<HTMLElement>(FOCUSABLE) ??
			node;
		initial?.focus();
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				if (busyRef.current) return;
				event.preventDefault();
				closeRef.current();
				return;
			}
			if (event.key !== "Tab" || !node) return;
			const focusable = Array.from(
				node.querySelectorAll<HTMLElement>(FOCUSABLE),
			);
			if (focusable.length === 0) {
				event.preventDefault();
				node.focus();
				return;
			}
			const first = focusable[0]!;
			const last = focusable[focusable.length - 1]!;
			const active = document.activeElement;
			if (
				event.shiftKey &&
				(active === first || !node.contains(active as Node))
			) {
				event.preventDefault();
				last.focus();
				return;
			}
			if (
				!event.shiftKey &&
				(active === last || !node.contains(active as Node))
			) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.body.style.overflow = previousOverflow;
			previous?.focus();
		};
	}, [initialFocusRef]);

	return (
		<div className='dialog-backdrop'>
			<div
				ref={dialogRef}
				className={`dialog${wide ? " goal-dialog" : ""}`}
				role='dialog'
				aria-modal='true'
				aria-labelledby={titleId}
				tabIndex={-1}
			>
				<h2 id={titleId}>{title}</h2>
				{children}
			</div>
		</div>
	);
}
