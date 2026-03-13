"use client";

import * as React from "react";
import { Progress as ProgressPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";

function Progress({
	className,
	value,
	...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
	const normalizedValue = Math.max(0, Math.min(100, value ?? 0));

	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			className={cn("relative h-2.5 w-full overflow-hidden rounded-full bg-muted/65", className)}
			value={normalizedValue}
			{...props}>
			<ProgressPrimitive.Indicator
				data-slot="progress-indicator"
				className="h-full w-full flex-1 bg-primary transition-all duration-500 ease-out"
				style={{ transform: `translateX(-${100 - normalizedValue}%)` }}
			/>
		</ProgressPrimitive.Root>
	);
}

export { Progress };
