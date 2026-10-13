"use client";
import {
  AnimatePresence,
  type Transition,
  type Variants,
  motion,
  MotionConfigContext,
  useIsPresent,
  type MotionProps,
  type HTMLMotionProps,
} from "motion/react";
import { cn } from "cn";
import {
  forwardRef,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Motion Primitives, MIT, ibelick, commit 120f64f6ca60348e251f929e9c81f11ccbe45eda.
// Local adaptation: typed imports, inert exiting controls, and optional measured
// height changes without scaling form controls or images.
const PresencePanel = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  function PresencePanel(props, ref) {
    const present = useIsPresent();
    const reduced = useContext(MotionConfigContext).reducedMotion === "always";
    return (
      <motion.div
        {...props}
        ref={ref}
        inert={!present}
        initial={reduced ? false : props.initial}
        animate={reduced ? { opacity: 1, x: 0 } : props.animate}
        exit={
          reduced
            ? { opacity: 0, x: 0, transition: { duration: 0 } }
            : props.exit
        }
        transition={reduced ? { duration: 0 } : props.transition}
        aria-hidden={!present || undefined}
        data-panel-present={present}
      />
    );
  },
);

export type TransitionPanelProps = {
  children: ReactNode[];
  className?: string;
  transition?: Transition;
  activeIndex: number;
  variants?: Variants;
  animateHeight?: boolean;
} & MotionProps;

export function TransitionPanel({
  children,
  className,
  transition,
  variants,
  activeIndex,
  animateHeight = false,
  ...motionProps
}: TransitionPanelProps) {
  const container = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const reduced = useContext(MotionConfigContext).reducedMotion === "always";
  useLayoutEffect(() => {
    if (!animateHeight) return;
    const panel = container.current?.querySelector<HTMLElement>(
      '[data-panel-present="true"]',
    );
    if (!panel) return;
    // Measure the intrinsic current panel, never the animated wrapper or an exit.
    const measure = () => {
      const limit = parseFloat(getComputedStyle(container.current!).maxHeight);
      setHeight(
        Number.isFinite(limit)
          ? Math.min(panel.offsetHeight, limit)
          : panel.offsetHeight,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeIndex, animateHeight]);
  return (
    <motion.div
      ref={container}
      className={cn(
        "relative",
        animateHeight && "motion-panel-resizing",
        className,
      )}
      initial={false}
      animate={animateHeight ? { height } : undefined}
      transition={reduced ? { duration: 0 } : transition}
    >
      <AnimatePresence
        initial={false}
        mode="popLayout"
        custom={motionProps.custom}
      >
        <PresencePanel
          key={activeIndex}
          variants={variants}
          transition={transition}
          initial="enter"
          animate="center"
          exit="exit"
          {...motionProps}
        >
          {children[activeIndex]}
        </PresencePanel>
      </AnimatePresence>
    </motion.div>
  );
}
