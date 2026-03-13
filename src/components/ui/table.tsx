import * as React from "react";
import { cn } from "@/lib/cn";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div data-slot="table-container" className="relative w-full overflow-auto rounded-[inherit]">
      <table
        ref={ref}
        data-slot="table"
        className={cn("w-full min-w-[640px] border-separate border-spacing-0 caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    data-slot="table-header"
    className={cn(
      "[&_tr]:border-b [&_tr]:border-[color:var(--border-strong)] [&_tr]:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--accent),transparent_72%),color-mix(in_oklab,var(--card),transparent_6%))]",
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    data-slot="table-body"
    className={cn(
      "[&_tr:last-child]:border-0 [&_tr:nth-child(2n)]:bg-[color:color-mix(in_oklab,var(--accent),transparent_95%)] [&_tr]:border-b [&_tr]:border-[color:color-mix(in_oklab,var(--foreground),transparent_91%)]",
      className,
    )}
    {...props}
  />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    data-slot="table-footer"
    className={cn(
      "border-t border-[color:var(--border-strong)] bg-[color:color-mix(in_oklab,var(--accent),transparent_76%)] font-medium",
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      data-slot="table-row"
      className={cn(
        "transition-[background-color,transform] duration-200 hover:bg-[color:color-mix(in_oklab,var(--accent),transparent_80%)] data-[state=selected]:bg-[color:color-mix(in_oklab,var(--accent),transparent_76%)]",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      data-slot="table-head"
      className={cn(
        "font-subheader h-12 px-5 text-left align-middle text-[10px] text-muted-foreground first:pl-6 last:pr-6",
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      data-slot="table-cell"
      className={cn("px-5 py-4 align-middle text-sm leading-relaxed first:pl-6 last:pr-6", className)}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} data-slot="table-caption" className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
