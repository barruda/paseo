import { describe, expect, it } from "vitest";
import type { ToastVariant } from "@/components/toast-host";
import { shouldSuppressToast } from "./toast-gate";

describe("shouldSuppressToast", () => {
  it.each(["default", "info", "success", "warning"] as ToastVariant[])(
    "suppresses %s while active",
    (variant) => {
      expect(shouldSuppressToast(variant, true)).toBe(true);
    },
  );

  it("never suppresses errors", () => {
    expect(shouldSuppressToast("error", true)).toBe(false);
  });

  it.each(["default", "info", "success", "warning", "error"] as ToastVariant[])(
    "never suppresses %s when inactive",
    (variant) => {
      expect(shouldSuppressToast(variant, false)).toBe(false);
    },
  );
});
