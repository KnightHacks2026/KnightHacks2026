import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

const badgeVariants = cva("ui-badge inline-flex items-center", {
  variants: { tone: {
    neutral: "ui-badge--neutral", danger: "ui-badge--danger", warning: "ui-badge--warning",
    success: "ui-badge--success", violet: "ui-badge--violet",
  } },
  defaultVariants: { tone: "neutral" },
});

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ tone, className, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}

export { badgeVariants };
