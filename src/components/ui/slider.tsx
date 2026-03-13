"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";

function Slider({
	className,
	defaultValue,
	value,
	min = 0,
	max = 100,
	...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
	const values = React.useMemo(
		() =>
			Array.isArray(value)
				? value
				: Array.isArray(defaultValue)
					? defaultValue
					: [min],
		[value, defaultValue, min]
	);

	return (
		<SliderPrimitive.Root
			data-slot="slider"
			defaultValue={defaultValue}
			value={value}
			min={min}
			max={max}
			className={cn(
				"relative flex w-full touch-none items-center select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
				className
			)}
			{...props}>
			<SliderPrimitive.Track
				data-slot="slider-track"
				className="relative grow overflow-hidden rounded-full bg-muted/65 shadow-[inset_0_1px_1px_color-mix(in_oklab,var(--foreground),transparent_94%)] data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2.5">
				<SliderPrimitive.Range
					data-slot="slider-range"
					className="absolute rounded-full bg-[linear-gradient(90deg,var(--primary),color-mix(in_oklab,var(--primary),var(--status-success)_35%))] data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
				/>
			</SliderPrimitive.Track>
			{Array.from({ length: values.length }, (_, index) => (
				<SliderPrimitive.Thumb
					data-slot="slider-thumb"
					key={index}
					className="block size-4 shrink-0 rounded-full border border-background/70 bg-background shadow-[0_6px_18px_color-mix(in_oklab,var(--primary),transparent_72%),0_0_0_1px_color-mix(in_oklab,var(--primary),transparent_72%)] transition-[transform,box-shadow,border-color] hover:scale-[1.05] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:color-mix(in_oklab,var(--ring),transparent_55%)] disabled:pointer-events-none disabled:opacity-50"
				/>
			))}
		</SliderPrimitive.Root>
	);
}

export { Slider };
