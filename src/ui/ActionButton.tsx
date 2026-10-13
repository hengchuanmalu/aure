import { Button as PrimitiveButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HoverHint } from "@/ui/HoverHint";
import type { ComponentProps,ReactNode } from "react";

// Shared desktop action: keep icon sizing and accessible names consistent.
export function Button({
  icon,
  children,
  className,
  variant = "outline",
  size,
  title,
  hint,
  ...props
}: ComponentProps<typeof PrimitiveButton> & {
  icon?: ReactNode;
  hint?: string | false;
}) {
  const text = hint === false ? undefined : hint ?? title;
  return (
    <HoverHint text={props.disabled ? undefined : text}>
      <PrimitiveButton
        {...props}
        type={props.type ?? "button"}
        variant={variant}
        size={size ?? (icon && !children ? "icon" : "default")}
        className={cn("jj-button", className)}
      >
        {icon}
        {children}
      </PrimitiveButton>
    </HoverHint>
  );
}
