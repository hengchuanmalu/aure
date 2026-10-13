import { type Database } from "@/domain/types";

export function recommendationSettings(settings: Database["settings"]) {
  const interval = settings.recommendationIntervalSeconds;
  const transition = settings.recommendationTransitionMs;
  return {
    automatic: settings.recommendationAutoRotate !== false,
    intervalSeconds:
      interval && [3, 6, 10, 15, 30, 60].includes(interval) ? interval : 6,
    transitionMs:
      transition && [400, 800, 1200].includes(transition) ? transition : 800,
    pauseOnHover: settings.recommendationPauseOnHover !== false,
  };
}
