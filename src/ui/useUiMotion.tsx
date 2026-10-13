import { useData } from '@/state/data-context';
import { MotionConfig,type Transition } from "motion/react";
import {
createContext,
useContext,
useLayoutEffect,
useSyncExternalStore,
type ReactNode,
} from "react";

// Project recipes for M-07/08/09/12. These are implementation defaults,
// not personal Motion Tokens. CSS equivalents live in design/tokens/tokens.css.
const ease = [0.16, 1, 0.3, 1] as const;
const recipes = {
  feedback: { duration: 0.12, ease },
  selection: { duration: 0.18, ease },
  presence: { duration: 0.22, ease },
  reflow: { duration: 0.22, ease },
  content: { duration: 0.2, ease },
} satisfies Record<string, Transition>;
type MotionPolicy = { reduced: boolean; transitions: typeof recipes };
const fullPolicy: MotionPolicy = { reduced: false, transitions: recipes };
const reducedPolicy: MotionPolicy = {
  reduced: true,
  transitions: Object.fromEntries(
    Object.entries(recipes).map(([name, value]) => [
      name,
      { ...value, duration: 0 },
    ]),
  ) as typeof recipes,
};
const MotionContext = createContext<MotionPolicy>(fullPolicy);
const preference = () => window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribe = (notify: () => void) => {
  const media = preference();
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

export function UiMotionProvider({ children }: { children: ReactNode }) {
  const { db } = useData();
  const systemReduced = useSyncExternalStore(
    subscribe,
    () => preference().matches,
    () => false,
  );
  const reduced = db.settings.reducedMotion || systemReduced;
  const policy = reduced ? reducedPolicy : fullPolicy;
  // Portalled Radix surfaces live outside the data provider's DOM wrapper.
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
    return () => {
      delete document.documentElement.dataset.motion;
    };
  }, [reduced]);
  return (
    <MotionContext.Provider value={policy}>
      <MotionConfig
        reducedMotion={reduced ? "always" : "never"}
        transition={policy.transitions.presence}
      >
        {children}
      </MotionConfig>
    </MotionContext.Provider>
  );
}

export function useUiMotion() {
  return useContext(MotionContext);
}
