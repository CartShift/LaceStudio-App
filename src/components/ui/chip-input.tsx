"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

export function ChipInput({
	value,
	onChange,
	suggestions,
	placeholder,
	max = 10,
	className
}: {
	value: string[];
	onChange: (next: string[]) => void;
	suggestions?: string[];
	placeholder?: string;
	max?: number;
	className?: string;
}) {
	const [input, setInput] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	function addChip(text: string) {
		const cleaned = text.trim();
		if (!cleaned) return;
		if (value.length >= max) return;
		if (value.some(v => v.toLowerCase() === cleaned.toLowerCase())) return;
		onChange([...value, cleaned]);
		setInput("");
	}

	function removeChip(index: number) {
		onChange(value.filter((_, i) => i !== index));
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter" || e.key === ",") {
			e.preventDefault();
			addChip(input);
		}
		if (e.key === "Backspace" && !input && value.length > 0) {
			removeChip(value.length - 1);
		}
	}

	const unusedSuggestions = suggestions?.filter(s => !value.some(v => v.toLowerCase() === s.toLowerCase()));

	return (
		<div className={cn("space-y-2", className)}>
			{/* Chip display + input */}
			<div
				className="flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-xl border border-input bg-card/60 px-2.5 py-1.5 transition-colors focus-within:border-[var(--color-primary)] focus-within:ring-1 focus-within:ring-[color:color-mix(in_oklab,var(--color-primary),transparent_70%)]"
				onClick={() => inputRef.current?.focus()}>
				{value.map((chip, i) => (
					<span
						key={`${chip}-${i}`}
						className="inline-flex items-center gap-1 rounded-lg bg-[color:color-mix(in_oklab,var(--color-primary),transparent_85%)] px-2 py-0.5 text-xs font-medium text-foreground transition-all animate-in fade-in-50 zoom-in-95 duration-200">
						{chip}
						<button
							type="button"
							onClick={e => {
								e.stopPropagation();
								removeChip(i);
							}}
							className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
							aria-label={`Remove ${chip}`}>
							×
						</button>
					</span>
				))}
				{value.length < max ? (
					<input
						ref={inputRef}
						type="text"
						value={input}
						onChange={e => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						onBlur={() => addChip(input)}
						placeholder={value.length === 0 ? (placeholder ?? "Type and press Enter…") : ""}
						className="min-w-[80px] flex-1 border-none bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/50"
					/>
				) : null}
			</div>

			{/* Suggestions */}
			{unusedSuggestions && unusedSuggestions.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{unusedSuggestions.map(suggestion => (
						<button
							key={suggestion}
							type="button"
							onClick={() => addChip(suggestion)}
							className="rounded-lg border border-border/50 bg-card/40 px-2 py-0.5 text-[11px] text-muted-foreground transition-all hover:border-[color:color-mix(in_oklab,var(--color-primary),transparent_50%)] hover:bg-[color:color-mix(in_oklab,var(--color-primary),transparent_92%)] hover:text-foreground">
							+ {suggestion}
						</button>
					))}
				</div>
			) : null}

			{/* Counter */}
			{value.length > 0 ? (
				<p className="text-[10px] text-muted-foreground/60">
					{value.length}/{max} items
				</p>
			) : null}
		</div>
	);
}
