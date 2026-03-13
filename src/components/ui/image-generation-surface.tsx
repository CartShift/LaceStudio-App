"use client";

import { type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";

export type ImageGenerationSurfaceProps = {
	src: string | null | undefined;
	alt: string;
	placeholder?: ReactNode;
	className?: string;
	aspectClassName?: string;
	imageClassName?: string;
	objectFit?: "cover" | "contain";
	loading?: boolean;
	loadingTitle?: ReactNode;
	loadingDescription?: ReactNode;
	loadingBadge?: ReactNode;
	loadingVariant?: "default" | "compact";
	children?: ReactNode;
};

export function ImageGenerationSurface({
	src,
	alt,
	placeholder = "Preview unavailable",
	className,
	aspectClassName = "aspect-square w-full",
	imageClassName,
	objectFit = "cover",
	loading = false,
	loadingVariant,
	children
}: ImageGenerationSurfaceProps) {
	const normalizedSrc = src?.trim() ? src.trim() : null;

	return (
		<ImageGenerationSurfaceInner
			key={normalizedSrc ?? "__empty__"}
			src={normalizedSrc}
			alt={alt}
			placeholder={placeholder}
			className={className}
			aspectClassName={aspectClassName}
			imageClassName={imageClassName}
			objectFit={objectFit}
			loading={loading}
			loadingVariant={loadingVariant}>
			{children}
		</ImageGenerationSurfaceInner>
	);
}

function ImageGenerationSurfaceInner({
	src,
	alt,
	placeholder,
	className,
	aspectClassName,
	imageClassName,
	objectFit,
	loading,
	loadingVariant,
	children
}: ImageGenerationSurfaceProps & { src: string | null }) {
	const [loaded, setLoaded] = useState(false);
	const [failed, setFailed] = useState(false);
	const resolvedSrc = failed ? null : src;
	const isImageLoading = Boolean(resolvedSrc) && !loaded;
	const showGenerationLoading = loading;
	const showAssetLoading = !loading && isImageLoading;
	const resolvedVariant = loadingVariant ?? "default";

	return (
		<div
			className={cn(
				"relative isolate overflow-hidden rounded-md border border-border/70 bg-muted/35 shadow-[var(--shadow-soft)]",
				aspectClassName,
				className
			)}
			aria-busy={showGenerationLoading || showAssetLoading || undefined}>
			{showGenerationLoading ? <GenerationChrome variant={resolvedVariant} /> : null}
			{showAssetLoading ? <div className="absolute inset-0 z-0 bg-muted/55" aria-hidden /> : null}

			{resolvedSrc ? (
				<>
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img
						src={resolvedSrc}
						alt={alt}
						loading="lazy"
						decoding="async"
						onLoad={() => setLoaded(true)}
						onError={() => {
							setFailed(true);
							setLoaded(true);
						}}
						className={cn(
							"relative z-10 h-full w-full transition-[opacity,transform,filter] duration-500 ease-out",
							objectFit === "contain" ? "object-contain" : "object-cover",
							showGenerationLoading ? "scale-[1.04] blur-[3px] opacity-0" : showAssetLoading ? "scale-100 blur-0 opacity-0" : "scale-100 blur-0 opacity-100",
							imageClassName
						)}
					/>
				</>
			) : null}

			{!resolvedSrc && !showGenerationLoading ? (
				<div className="relative z-10 flex h-full items-center justify-center px-3 text-center text-[11px] text-muted-foreground">{placeholder}</div>
			) : null}

			{children}
		</div>
	);
}

function GenerationChrome({ variant }: { variant: "default" | "compact" }) {
	return (
		<div className={cn("image-generation-shell", variant === "compact" && "image-generation-shell--compact")}>
			<div className="image-generation-shell__grid" />
			<div className="image-generation-shell__orb image-generation-shell__orb--a" />
			<div className="image-generation-shell__orb image-generation-shell__orb--b" />
			<div className="image-generation-shell__orb image-generation-shell__orb--c" />
			<div className="image-generation-shell__content" aria-hidden>
				<p className={cn("image-generation-shell__label", variant === "compact" && "text-[11px]")}>Loading...</p>
			</div>
		</div>
	);
}
