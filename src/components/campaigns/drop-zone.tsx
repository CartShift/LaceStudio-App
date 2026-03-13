"use client";

import { DragEvent, useCallback, useRef, useState } from "react";

const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 4 * 1024 * 1024;

export function DropZone({ onFilesAdded, maxFiles = 10, className = "" }: { onFilesAdded: (files: File[]) => void; maxFiles?: number; className?: string }) {
	const [isDragOver, setIsDragOver] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const processFiles = useCallback(
		(fileList: FileList | File[]) => {
			setError(null);
			const files = Array.from(fileList);
			const valid: File[] = [];
			const errors: string[] = [];

			for (const file of files.slice(0, maxFiles)) {
				if (!SUPPORTED_TYPES.has(file.type)) {
					errors.push(`${file.name}: unsupported format`);
					continue;
				}
				if (file.size > MAX_SIZE) {
					errors.push(`${file.name}: exceeds 4MB limit`);
					continue;
				}
				if (file.size === 0) {
					errors.push(`${file.name}: empty file`);
					continue;
				}
				valid.push(file);
			}

			if (errors.length > 0) {
				setError(errors.join("; "));
			}

			if (valid.length > 0) {
				onFilesAdded(valid);
			}
		},
		[onFilesAdded, maxFiles]
	);

	const openFilePicker = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	function handleDrop(event: DragEvent<HTMLDivElement>) {
		event.preventDefault();
		setIsDragOver(false);
		if (event.dataTransfer.files.length > 0) {
			processFiles(event.dataTransfer.files);
		}
	}

	function handleDragOver(event: DragEvent<HTMLDivElement>) {
		event.preventDefault();
		setIsDragOver(true);
	}

	function handleDragLeave() {
		setIsDragOver(false);
	}

	function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
		const files = event.currentTarget.files;
		if (files && files.length > 0) {
			processFiles(files);
		}
		event.currentTarget.value = "";
	}

	function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			openFilePicker();
		}
	}

	function handlePaste(event: React.ClipboardEvent) {
		const items = event.clipboardData?.items;
		if (!items) return;

		const files: File[] = [];
		for (const item of Array.from(items)) {
			if (item.kind === "file" && item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) files.push(file);
			}
		}

		if (files.length > 0) {
			event.preventDefault();
			processFiles(files);
		}
	}

	return (
		<div
			onDrop={handleDrop}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onPaste={handlePaste}
			onClick={openFilePicker}
			onKeyDown={handleKeyDown}
			tabIndex={0}
			role="button"
			aria-label="Add reference images"
			className={`relative rounded-xl border-2 border-dashed transition-all duration-200 ${
				isDragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-border/60 bg-card/50 hover:border-border"
			} cursor-pointer ${className}`}>
			<input ref={fileInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={handleFileInputChange} className="sr-only" tabIndex={-1} />
			<div className="flex flex-col items-center justify-center gap-1.5 px-4 py-5 text-center">
				<div className={`rounded-full p-2 transition-colors ${isDragOver ? "bg-primary/10" : "bg-muted"}`}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`transition-colors ${isDragOver ? "text-primary" : "text-muted-foreground"}`}>
						<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</div>
				<p className="text-xs font-medium text-muted-foreground">{isDragOver ? "Drop images here" : "Drag, paste, or click to add images"}</p>
				<p className="text-[10px] text-muted-foreground/60">JPG, PNG, WebP · Max 4MB each</p>
				<button
					type="button"
					onClick={event => {
						event.stopPropagation();
						openFilePicker();
					}}
					className="mt-1 rounded-full border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
					Browse files
				</button>
			</div>

			{error ? <p className="px-3 pb-2 text-center text-[11px] text-destructive">{error}</p> : null}
		</div>
	);
}
