"use client";
import { cn } from "cn";
import { AnimatePresence, type Transition, motion } from "motion/react";
import {
  Children,
  cloneElement,
  type ReactElement,
  type MouseEvent,
  useState,
  useId,
} from "react";

// Motion Primitives, MIT, ibelick, commit 120f64f6ca60348e251f929e9c81f11ccbe45eda.
// Local adaptation: controlled selection, preserve handlers and inline contents,
// and disable shared layout when the app/system requests reduced motion.
type BackgroundChild = ReactElement<{
  "data-id": string;
  "data-checked"?: string;
  className?: string;
  children?: React.ReactNode;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
}>;

export type AnimatedBackgroundProps = {
  children: BackgroundChild[] | BackgroundChild;
  value?: string | null;
  defaultValue?: string;
  onValueChange?: (newActiveId: string | null) => void;
  className?: string;
  transition?: Transition;
  enableHover?: boolean;
  reduced?: boolean;
};

export function AnimatedBackground({
  children,
  value,
  defaultValue,
  onValueChange,
  className,
  transition,
  enableHover = false,
  reduced = false,
}: AnimatedBackgroundProps) {
  const [internalId, setActiveId] = useState<string | null>(
    defaultValue ?? null,
  );
  const activeId = value === undefined ? internalId : value;
  const uniqueId = useId();

  const handleSetActiveId = (id: string | null) => {
    setActiveId(id);

    if (onValueChange) {
      onValueChange(id);
    }
  };

  return Children.map(children, (child) => {
    const id = child.props["data-id"];

    const interactionProps = enableHover
      ? {
          onMouseEnter: (event: MouseEvent<HTMLElement>) => {
            child.props.onMouseEnter?.(event);
            if (!event.defaultPrevented) handleSetActiveId(id);
          },
          onMouseLeave: (event: MouseEvent<HTMLElement>) => {
            child.props.onMouseLeave?.(event);
            if (!event.defaultPrevented) handleSetActiveId(null);
          },
        }
      : {
          onClick: (event: MouseEvent<HTMLElement>) => {
            child.props.onClick?.(event);
            if (!event.defaultPrevented) handleSetActiveId(id);
          },
        };

    return cloneElement(
      child,
      {
        key: id,
        className: cn("relative inline-flex", child.props.className),
        "data-checked": activeId === id ? "true" : "false",
        ...interactionProps,
      },
      <>
        <AnimatePresence initial={false}>
          {activeId === id && (
            <motion.span
              layoutId={reduced ? undefined : `background-${uniqueId}`}
              aria-hidden="true"
              className={cn("absolute inset-0", className)}
              transition={reduced ? { duration: 0 } : transition}
              initial={{ opacity: defaultValue ? 1 : 0 }}
              animate={{
                opacity: 1,
              }}
              exit={{
                opacity: 0,
              }}
            />
          )}
        </AnimatePresence>
        {child.props.children}
      </>,
    );
  });
}
