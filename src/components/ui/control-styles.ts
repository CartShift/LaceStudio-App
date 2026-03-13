const controlTransitionClass = "transition-[border-color,box-shadow,background-color,color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]";

export const controlBaseClass = [
	"ds-control",
	"h-11 w-full rounded-[var(--radius-control)] px-3.5 py-2.5 text-sm leading-relaxed text-foreground",
	"placeholder:text-muted-foreground/85",
	"selection:bg-[color:color-mix(in_oklab,var(--primary),transparent_72%)] selection:text-foreground",
	"disabled:cursor-not-allowed disabled:opacity-60",
	controlTransitionClass
].join(" ");

export const controlCompactClass = "ds-control ds-control-sm";

export const controlShellClass = "group/control relative w-full";

export const controlIconClass = "pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground transition-colors duration-200 group-focus-within/control:text-foreground";
