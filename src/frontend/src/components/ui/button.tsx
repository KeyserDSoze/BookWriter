import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const variants = cva("inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: {
      default: "bg-emerald-600 text-white hover:bg-emerald-500",
      secondary: "border border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700",
      outline: "border border-slate-400 bg-transparent hover:bg-slate-200 dark:border-slate-600 dark:hover:bg-slate-800",
      ghost: "hover:bg-slate-200 dark:hover:bg-slate-800",
      destructive: "bg-red-700 text-white hover:bg-red-600",
    },
    size: { default: "h-11", icon: "size-11 p-0", sm: "h-9 min-h-9 px-3" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof variants> & { asChild?: boolean };

export function Button({ asChild = false, className, size, variant, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" className={cn(variants({ variant, size, className }))} {...props} />;
}
