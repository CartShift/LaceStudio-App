import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { controlBaseClass } from "@/components/ui/control-styles";

type SelectFieldProps = Omit<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root>, "children" | "onValueChange"> & {
	children?: React.ReactNode;
	className?: string;
	contentClassName?: string;
	placeholder?: string;
	name?: string;
	required?: boolean;
	onValueChange?: (value: string) => void;
	onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
	id?: string;
	"aria-describedby"?: string;
	"aria-invalid"?: boolean;
};

type NativeOption = {
	value: string;
	label: React.ReactNode;
	disabled?: boolean;
};

type NativeGroup = {
	label?: React.ReactNode;
	options: NativeOption[];
};

function appendNativeNodes(children: React.ReactNode, groups: NativeGroup[], activeGroupLabel?: React.ReactNode): boolean {
	let valid = true;

	React.Children.forEach(children, child => {
		if (!valid || child == null || typeof child === "boolean") {
			return;
		}

		if (!React.isValidElement(child)) {
			if (typeof child === "string" && child.trim().length === 0) {
				return;
			}
			valid = false;
			return;
		}

		const element = child as React.ReactElement<{
			children?: React.ReactNode;
			disabled?: boolean;
			label?: React.ReactNode;
			value?: string | number;
		}>;

		if (element.type === React.Fragment) {
			valid = appendNativeNodes(element.props.children, groups, activeGroupLabel) && valid;
			return;
		}

		if (typeof element.type !== "string") {
			valid = false;
			return;
		}

		if (element.type === "optgroup") {
			const nextGroup: NativeGroup = {
				label: element.props.label,
				options: []
			};
			groups.push(nextGroup);
			valid = appendNativeNodes(element.props.children, groups, element.props.label) && valid;
			return;
		}

		if (element.type !== "option") {
			valid = false;
			return;
		}

		const targetGroup =
			groups.length === 0 || activeGroupLabel == null || groups.at(-1)?.label !== activeGroupLabel
				? (() => {
						const nextGroup: NativeGroup = {
							label: activeGroupLabel,
							options: []
						};
						groups.push(nextGroup);
						return nextGroup;
					})()
				: groups.at(-1);

		targetGroup?.options.push({
			value:
				typeof element.props.value === "string"
					? element.props.value
					: element.props.value != null
						? String(element.props.value)
						: typeof element.props.children === "string"
							? element.props.children
							: "",
			label: element.props.children,
			disabled: element.props.disabled
		});
	});

	return valid;
}

function parseNativeSelectChildren(children: React.ReactNode) {
	const groups: NativeGroup[] = [];
	const isNativeOptionTree = appendNativeNodes(children, groups);
	if (!isNativeOptionTree) {
		return null;
	}

	let placeholder: React.ReactNode | undefined;

	const normalizedGroups = groups
		.map(group => {
			const options = group.options.filter(option => {
				if (option.value === "" && placeholder == null) {
					placeholder = option.label;
					return false;
				}

				if (option.value === "" && option.disabled) {
					return false;
				}

				return true;
			});

			return {
				label: group.label,
				options
			};
		})
		.filter(group => group.options.length > 0);

	return {
		groups: normalizedGroups,
		placeholder
	};
}

const selectTriggerBaseClass = cn(controlBaseClass, "justify-between gap-3 pr-10 text-left shadow-[var(--shadow-inner)] data-[placeholder]:text-muted-foreground/90 [&>span]:line-clamp-1");

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>>(({ className, children, ...props }, ref) => (
	<SelectPrimitive.Trigger ref={ref} data-slot="select-trigger" className={cn(selectTriggerBaseClass, className)} {...props}>
		{children}
		<SelectPrimitive.Icon asChild>
			<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180" />
		</SelectPrimitive.Icon>
	</SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<React.ElementRef<typeof SelectPrimitive.ScrollUpButton>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>>(
	({ className, ...props }, ref) => (
		<SelectPrimitive.ScrollUpButton ref={ref} data-slot="select-scroll-up-button" className={cn("flex cursor-default items-center justify-center py-1 text-muted-foreground", className)} {...props}>
			<ChevronUp className="size-4" />
		</SelectPrimitive.ScrollUpButton>
	)
);
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<React.ElementRef<typeof SelectPrimitive.ScrollDownButton>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>>(
	({ className, ...props }, ref) => (
		<SelectPrimitive.ScrollDownButton
			ref={ref}
			data-slot="select-scroll-down-button"
			className={cn("flex cursor-default items-center justify-center py-1 text-muted-foreground", className)}
			{...props}>
			<ChevronDown className="size-4" />
		</SelectPrimitive.ScrollDownButton>
	)
);
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Content>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>(
	({ className, children, position = "popper", ...props }, ref) => (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				ref={ref}
				data-slot="select-content"
				className={cn(
					"relative z-50 max-h-80 min-w-[8rem] overflow-hidden rounded-xl border border-[color:color-mix(in_oklab,var(--foreground),transparent_88%)] bg-[linear-gradient(160deg,color-mix(in_oklab,var(--card),white_10%),color-mix(in_oklab,var(--card),transparent_2%)_56%,color-mix(in_oklab,var(--accent),transparent_94%))] text-foreground shadow-[var(--shadow-lift)] backdrop-blur-[var(--backdrop-blur)]",
					"data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
					"data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
					position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
					className
				)}
				position={position}
				{...props}>
				<SelectScrollUpButton />
				<SelectPrimitive.Viewport className={cn("p-1.5", position === "popper" && "h-[var(--radix-select-trigger-height)] min-w-[var(--radix-select-trigger-width)]")}>
					{children}
				</SelectPrimitive.Viewport>
				<SelectScrollDownButton />
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	)
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Label>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>>(({ className, ...props }, ref) => (
	<SelectPrimitive.Label ref={ref} data-slot="select-label" className={cn("px-2.5 py-1.5 font-subheader text-[10px] text-muted-foreground", className)} {...props} />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Item>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(({ className, children, ...props }, ref) => (
	<SelectPrimitive.Item
		ref={ref}
		data-slot="select-item"
		className={cn(
			"relative flex w-full cursor-default select-none items-center rounded-[0.8rem] py-2 pl-9 pr-3 text-sm outline-none transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus:bg-[color:color-mix(in_oklab,var(--accent),transparent_72%)] focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
			className
		)}
		{...props}>
		<span className="absolute left-3 flex size-4 items-center justify-center">
			<SelectPrimitive.ItemIndicator>
				<Check className="size-4 text-primary" />
			</SelectPrimitive.ItemIndicator>
		</span>
		<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
	</SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>>(({ className, ...props }, ref) => (
	<SelectPrimitive.Separator ref={ref} data-slot="select-separator" className={cn("mx-1 my-1 h-px bg-[color:color-mix(in_oklab,var(--foreground),transparent_90%)]", className)} {...props} />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

const SelectField = React.forwardRef<HTMLButtonElement, SelectFieldProps>(
	({ children, className, contentClassName, placeholder, onChange, onValueChange, value, defaultValue, id, name, required, disabled, ...props }, ref) => {
		const nativeConfig = React.useMemo(() => parseNativeSelectChildren(children), [children]);

		const handleValueChange = React.useCallback(
			(nextValue: string) => {
				onValueChange?.(nextValue);

				if (onChange) {
					onChange({
						target: {
							value: nextValue,
							name
						}
					} as React.ChangeEvent<HTMLSelectElement>);
				}
			},
			[name, onChange, onValueChange]
		);

		const normalizedValue = value != null && value !== "" ? value : undefined;
		const normalizedDefaultValue = defaultValue != null && defaultValue !== "" ? defaultValue : undefined;

		if (nativeConfig) {
			return (
				<SelectPrimitive.Root value={normalizedValue} defaultValue={normalizedDefaultValue} onValueChange={handleValueChange} name={name} required={required} disabled={disabled} {...props}>
					<SelectTrigger ref={ref} id={id} aria-describedby={props["aria-describedby"]} aria-invalid={props["aria-invalid"]} className={className}>
						<SelectValue placeholder={placeholder ?? nativeConfig.placeholder ?? "Select an option"} />
					</SelectTrigger>
					<SelectContent className={contentClassName}>
						{nativeConfig.groups.map((group, groupIndex) =>
							group.label ? (
								<SelectGroup key={`group-${groupIndex}-${String(group.label)}`}>
									<SelectLabel>{group.label}</SelectLabel>
									{group.options.map(option => (
										<SelectItem key={`${groupIndex}-${option.value}`} value={option.value} disabled={option.disabled}>
											{option.label}
										</SelectItem>
									))}
								</SelectGroup>
							) : (
								group.options.map(option => (
									<SelectItem key={`${groupIndex}-${option.value}`} value={option.value} disabled={option.disabled}>
										{option.label}
									</SelectItem>
								))
							)
						)}
					</SelectContent>
				</SelectPrimitive.Root>
			);
		}

		return (
			<SelectPrimitive.Root value={normalizedValue} defaultValue={normalizedDefaultValue} onValueChange={handleValueChange} name={name} required={required} disabled={disabled} {...props}>
				{children}
			</SelectPrimitive.Root>
		);
	}
);
SelectField.displayName = "SelectField";

export { Select, SelectContent, SelectField, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue };
