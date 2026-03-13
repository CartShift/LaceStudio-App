"use client";

import React from "react";
import { ImageGenerationSurface } from "@/components/ui/image-generation-surface";

const ExpandIcon = () => (
	<svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M15 3h6v6" />
		<path d="M9 21H3v-6" />
		<path d="M21 3l-7 7" />
		<path d="M3 21l7-7" />
	</svg>
);

export type SquareImageThumbnailProps = {
	src: string | null | undefined;
	alt: string;
	placeholder?: React.ReactNode;
	containerClassName?: string;
	loading?: boolean;
	loadingTitle?: React.ReactNode;
	loadingDescription?: React.ReactNode;
	loadingBadge?: React.ReactNode;
	loadingVariant?: "default" | "compact";
	onImageClick?: () => void;
	expandButton?: { "aria-label": string; onExpand: () => void };
};

export function SquareImageThumbnail({
	src,
	alt,
	placeholder = "Preview unavailable",
	containerClassName = "",
	loading = false,
	loadingTitle,
	loadingDescription,
	loadingBadge,
	loadingVariant,
	onImageClick,
	expandButton
}: SquareImageThumbnailProps) {
	const base = "group/image relative aspect-square w-full overflow-hidden rounded-md border border-border bg-muted/55";
	const wrapperClassName = `${base} ${containerClassName}`.trim();

	const content = (
		<ImageGenerationSurface
			src={src}
			alt={alt}
			placeholder={placeholder}
			className={wrapperClassName}
			loading={loading}
			loadingTitle={loadingTitle}
			loadingDescription={loadingDescription}
			loadingBadge={loadingBadge}
			loadingVariant={loadingVariant}>
			{expandButton ? (
				<span
					role="button"
					tabIndex={0}
					aria-label={expandButton["aria-label"]}
					className="absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/40 bg-card/65 text-foreground opacity-0 shadow-sm transition-all duration-200 group-hover/image:opacity-100 group-focus-within/image:opacity-100 focus-visible:opacity-100"
					onClick={e => {
						e.stopPropagation();
						expandButton.onExpand();
					}}
					onKeyDown={e => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							e.stopPropagation();
							expandButton.onExpand();
						}
					}}>
					<ExpandIcon />
				</span>
			) : null}
		</ImageGenerationSurface>
	);

	if (onImageClick && src) {
		return (
			<button
				type="button"
				className="block w-full appearance-none border-0 bg-transparent p-0 text-left"
				onClick={onImageClick}
				aria-label={alt}>
				{content}
			</button>
		);
	}

	return content;
}
