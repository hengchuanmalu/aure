import { Tooltip } from "radix-ui";
import type { ReactElement,ReactNode } from "react";

export function HoverHintProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider
      delayDuration={0}
      skipDelayDuration={0}
      disableHoverableContent
    >
      {children}
    </Tooltip.Provider>
  );
}

// One surface and positioning contract for controls, filenames and sidebar entries.
// asChild keeps the real control in place, including its ref, focus and layout.
export function HoverHint({
  text,
  side = "bottom",
  children,
}: {
  text?: string;
  side?: "bottom" | "right" | "top" | "left";
  children: ReactElement;
}) {
  if (!text) return children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        asChild
        onFocus={(event) => {
          // Pointer-initiated navigation may restore focus; only keyboard focus opens a hint.
          if (!event.currentTarget.matches(":focus-visible"))
            event.preventDefault();
        }}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="hover-hint"
          side={side}
          sideOffset={4}
          collisionPadding={8}
          avoidCollisions
          hideWhenDetached
        >
          {text}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
