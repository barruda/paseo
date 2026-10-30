import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import type { ModalComponent, ModalContentProps, ModalProps } from "@getpaseo/plugin/client/ui";
import { usePluginRuntimeContextBridge } from "@getpaseo/plugin/client/host";
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { useWindowDimensions, type DimensionValue } from "react-native";
import { ToastApiProvider, useToast as useAppToast } from "@/contexts/toast-api-context";

interface ModalContextValue {
  open: boolean;
  dismiss(): void;
  header: {
    title: string;
    leading?: ReactNode;
  };
}

const ModalContext = createContext<ModalContextValue | null>(null);

function ModalRoot({ title, icon, open, onOpenChange, children }: ModalProps) {
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const dismiss = useCallback(() => onOpenChangeRef.current(false), []);
  const header = useMemo(() => ({ title, leading: icon }), [icon, title]);
  const value = useMemo(() => ({ open, dismiss, header }), [dismiss, header, open]);
  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

function useModalContext(): ModalContextValue {
  const context = useContext(ModalContext);
  if (!context) throw new Error("Modal.Content must be rendered inside Modal");
  return context;
}

function ModalContent({
  children,
  style,
  contentContainerStyle,
  scrollable = true,
  size = "default",
}: ModalContentProps) {
  const modal = useModalContext();
  // CUSTOM(plugin-modal-size)
  const { width } = useWindowDimensions();
  const large = size === "large";
  let desktopHeight: DimensionValue | undefined = scrollable ? undefined : "85%";
  if (large) desktopHeight = "80%";
  const queryClient = useQueryClient();
  const toast = useAppToast();
  const bridgePluginRuntime = usePluginRuntimeContextBridge();
  const contextBridge = useCallback(
    (content: ReactNode) => (
      <QueryClientProvider client={queryClient}>
        <ToastApiProvider api={toast}>{bridgePluginRuntime(content)}</ToastApiProvider>
      </QueryClientProvider>
    ),
    [bridgePluginRuntime, queryClient, toast],
  );
  const { AdaptiveModalSheet } =
    require("../../components/adaptive-modal-sheet") as typeof import("../../components/adaptive-modal-sheet");

  return (
    <AdaptiveModalSheet
      visible={modal.open}
      onClose={modal.dismiss}
      header={modal.header}
      contextBridge={contextBridge}
      bodyStyle={style}
      contentStyle={contentContainerStyle}
      scrollable={scrollable}
      desktopHeight={desktopHeight}
      desktopMaxWidth={large ? Math.round(width * 0.8) : undefined}
    >
      {children}
    </AdaptiveModalSheet>
  );
}

export const Modal: ModalComponent = Object.assign(ModalRoot, { Content: ModalContent });
