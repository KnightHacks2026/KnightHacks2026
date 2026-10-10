import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

const buttonVariants = cva("ui-button inline-flex items-center justify-center", {
  variants: {
    variant: { default: "ui-button--default", outline: "ui-button--outline", ghost: "ui-button--ghost" },
    size: { default: "ui-button--default-size", sm: "ui-button--sm", icon: "ui-button--icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return <Component
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />;
  },
);
Button.displayName = "Button";

export { buttonVariants };
