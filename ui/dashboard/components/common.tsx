import type {ReactNode} from "react";
import type {StatusTone} from "../model/status";

export function Badge({
	label,
	state,
	tone,
	title,
}: {
	label: string;
	state: string;
	tone: StatusTone;
	title?: string;
}) {
	return (
		<div
			className={`status ${tone}`}
			title={title}
		>
			<strong>{label}</strong>
			<span>{state}</span>
		</div>
	);
}

export function Callout({
	tone,
	children,
}: {
	tone: "success" | "warning" | "error" | "info";
	children: ReactNode;
}) {
	return (
		<p
			className={`callout ${tone}`}
			role={tone === "error" ? "alert" : "status"}
		>
			{children}
		</p>
	);
}

export function Field({label, children}: {label: string; children: ReactNode}) {
	return (
		<label className='field'>
			<span>{label}</span>
			{children}
		</label>
	);
}
