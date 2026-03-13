import React from "react";

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
	onImageClick?: () => void;
	expandButton?: { "aria-label": string; onExpand: () => void };
};

export function SquareImageThumbnail({
	src,
	alt,
	placeholder = "Preview unavailable",
	containerClassName = "",
	onImageClick,
	expandButton
}: SquareImageThumbnailProps) {
	const base = "group/image relative aspect-square w-full overflow-hidden rounded-md border border-border bg-muted/55";
	const wrapperClassName = `${base} ${containerClassName}`.trim();

	const content = src ? (
		<>
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src={src} alt={alt} className="h-full w-full object-cover" />
			{expandButton ? (
				<span
					role="button"
					tabIndex={0}
					aria-label={expandButton["aria-label"]}
					className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/40 bg-card/65 text-foreground opacity-0 shadow-sm transition-all duration-200 group-hover/image:opacity-100 group-focus-within/image:opacity-100 focus-visible:opacity-100"
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
		</>
	) : (
		<div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">{placeholder}</div>
	);

	if (onImageClick && src) {
		return (
			<div className={wrapperClassName}>
				<button type="button" className="h-full w-full" onClick={onImageClick} aria-label={alt}>
					{content}
				</button>
			</div>
		);
	}

	return <div className={wrapperClassName}>{content}</div>;
}
