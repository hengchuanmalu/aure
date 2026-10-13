import { useUiMotion } from "@/ui/useUiMotion";
import { motion,useIsPresent } from "motion/react";
import { useLayoutEffect,useRef,type ReactNode } from "react";

/** M-09/18: only the local region changes height; exiting controls stop accepting input. */
export function MotionCollapse({
  children,
  className,
  returnFocus,
}: {
  children: ReactNode;
  className: string;
  returnFocus?: string;
}) {
  const { reduced, transitions } = useUiMotion();
  const present = useIsPresent();
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!present && element.current?.contains(document.activeElement)) {
      document
        .querySelector<HTMLElement>(returnFocus || "#main-content")
        ?.focus({ preventScroll: true });
    }
  }, [present, returnFocus]);
  return (
    <motion.div
      ref={element}
      className={className}
      inert={!present}
      aria-hidden={!present}
      initial={{ opacity: reduced ? 1 : 0, height: reduced ? "auto" : 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: reduced ? "auto" : 0 }}
      transition={transitions.presence}
    >
      {children}
    </motion.div>
  );
}
