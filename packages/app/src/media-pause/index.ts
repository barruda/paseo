// CUSTOM(media-pause): voice mode and dictation pause playing media through the desktop host,
// which resumes it once nothing holds the pause.
import { useEffect } from "react";
import { getDesktopHost } from "@/desktop/host";

let holders = 0;

function setCaptureActive(active: boolean) {
  getDesktopHost()
    ?.media?.setCaptureActive?.(active)
    .catch((error) => console.warn("[media-pause] failed to toggle media", error));
}

export function holdMediaPause(): () => void {
  holders += 1;
  if (holders === 1) setCaptureActive(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) setCaptureActive(false);
  };
}

export function usePauseMediaWhile(active: boolean): void {
  useEffect(() => (active ? holdMediaPause() : undefined), [active]);
}
