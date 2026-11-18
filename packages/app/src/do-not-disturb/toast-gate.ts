// CUSTOM(do-not-disturb): errors still show, they report a failure of something the user just did.
import type { ToastVariant } from "@/components/toast-host";

export function shouldSuppressToast(variant: ToastVariant, dndActive: boolean): boolean {
  return dndActive && variant !== "error";
}
