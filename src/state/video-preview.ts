/** Only one card owns hover playback; viewers and layout changes can stop it. */
let activeStop: (() => void) | undefined;

export function stopPreviews() {
  activeStop?.();
}

export function claimPreview(stop: () => void) {
  stopPreviews();
  activeStop = stop;
}

export function releasePreview(stop: () => void) {
  if (activeStop === stop) activeStop = undefined;
}
