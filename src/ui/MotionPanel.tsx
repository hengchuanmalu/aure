import { TransitionPanel } from "@/components/motion-primitives/transition-panel";
import { useUiMotion } from "@/ui/useUiMotion";
import { type ReactNode } from "react";

/** Local form/settings content only. Routes, media and virtual grids stay mounted. */
export function MotionPanel({
  index,
  children,
  className,
  immediateExit = false,
  animateHeight = false,
}: {
  index: number;
  children: ReactNode;
  className?: string;
  immediateExit?: boolean;
  animateHeight?: boolean;
}) {
  const { reduced, transitions } = useUiMotion();
  const panels: ReactNode[] = [];
  panels[index] = children;
  return (
    <TransitionPanel
      activeIndex={index}
      animateHeight={animateHeight}
      className={className}
      transition={transitions.content}
      custom={{ reduced, immediateExit }}
      variants={{
        enter: {
          opacity: reduced ? 1 : 0,
          x: reduced || animateHeight ? 0 : 6,
        },
        center: { opacity: 1, x: 0 },
        exit: (target: { reduced: boolean; immediateExit: boolean }) => ({
          opacity: 0,
          x: 0,
          transition: {
            duration:
              reduced || target.reduced || immediateExit || target.immediateExit
                ? 0
                : 0.1,
          },
        }),
      }}
    >
      {panels}
    </TransitionPanel>
  );
}
