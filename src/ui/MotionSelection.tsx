import {
  AnimatedBackground,
  type AnimatedBackgroundProps,
} from "@/components/motion-primitives/animated-background";
import { useUiMotion } from "@/ui/useUiMotion";

/** Click selection within one group; hover does not move the background. */
export function MotionSelection({
  value,
  children,
}: Pick<AnimatedBackgroundProps, "value" | "children">) {
  const { reduced } = useUiMotion();
  return (
    <AnimatedBackground
      value={value}
      reduced={reduced}
      className="motion-selection"
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
    >
      {children}
    </AnimatedBackground>
  );
}
