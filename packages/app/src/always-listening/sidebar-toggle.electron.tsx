import { Mic2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useVoiceOptional } from "@/contexts/voice-context";
import { DictationStreamSender } from "@/dictation/dictation-stream-sender";
import { useDictationAudioSource } from "@/hooks/use-dictation-audio-source";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { PCM_DICTATION_FORMAT } from "@/hooks/use-dictation.shared";
import { WakeDictationController, type WakeDictationPhase } from "./controller";

type DisplayPhase = "off" | WakeDictationPhase | "error";

// CUSTOM(wake-dictation): Paseo's STT protocol transcribes one VAD-bounded utterance at a time.
export function WakeDictationSidebarToggle() {
  const serverId = useLocalDaemonServerId();
  const client = useHostRuntimeClient(serverId ?? "");
  const voice = useVoiceOptional();
  const [phase, setPhase] = useState<DisplayPhase>("off");
  const [error, setError] = useState<string | null>(null);
  const [lastCopied, setLastCopied] = useState(false);
  const controllerRef = useRef<WakeDictationController | null>(null);
  const senderRef = useRef<DictationStreamSender | null>(null);
  const generationRef = useRef(0);

  const audio = useDictationAudioSource({
    onPcmSegment: (pcm) => controllerRef.current?.pushPcm(pcm),
    onError: (reason) => {
      setError(reason.message);
      void stopRef.current("error");
    },
    onInterruption: () => {
      setError("Microphone interrupted");
      void stopRef.current("error");
    },
  });
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const stopRef = useRef<(nextPhase?: "off" | "error") => Promise<void>>(async () => {});

  const stop = useCallback(async (nextPhase: "off" | "error" = "off") => {
    generationRef.current += 1;
    controllerRef.current?.stop();
    controllerRef.current = null;
    senderRef.current?.cancel();
    senderRef.current?.dispose();
    senderRef.current = null;
    setPhase(nextPhase);
    await audioRef.current.stop();
  }, []);
  stopRef.current = stop;

  const start = useCallback(async () => {
    if (!client?.isConnected) {
      setError("Local Paseo host is disconnected");
      setPhase("error");
      return;
    }
    if (voice?.isVoiceMode) {
      setError("Leave voice mode before enabling wake dictation");
      setPhase("error");
      return;
    }
    const generation = ++generationRef.current;
    setError(null);
    setLastCopied(false);
    const controller = new WakeDictationController({
      transcribe: async (chunks) => {
        const sender = new DictationStreamSender({ client, format: PCM_DICTATION_FORMAT });
        senderRef.current = sender;
        try {
          for (const chunk of chunks) sender.enqueueSegment(chunk);
          const result = await sender.finish(sender.getFinalSeq());
          return result.text;
        } finally {
          sender.dispose();
          if (senderRef.current === sender) senderRef.current = null;
        }
      },
      copy: copyToClipboard,
      onPhase: setPhase,
      onCopied: () => setLastCopied(true),
      onError: (reason) => {
        if (generationRef.current !== generation) return;
        setError(reason.message);
        void stop("error");
      },
    });
    controllerRef.current = controller;
    try {
      await audioRef.current.start();
      if (generationRef.current !== generation) await audioRef.current.stop();
    } catch (reason) {
      if (generationRef.current !== generation) return;
      controller.stop();
      controllerRef.current = null;
      await audioRef.current.stop().catch(() => undefined);
      setError(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    }
  }, [client, stop, voice?.isVoiceMode]);

  useEffect(() => {
    if (phase !== "off" && phase !== "error" && (!client?.isConnected || voice?.isVoiceMode)) {
      void stop();
    }
  }, [client?.isConnected, phase, stop, voice?.isVoiceMode]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      controllerRef.current?.stop();
      senderRef.current?.cancel();
      senderRef.current?.dispose();
      void audioRef.current.stop();
    };
  }, []);

  const active = phase !== "off" && phase !== "error";
  let status = "Off";
  if (phase === "armed") status = lastCopied ? "Copied · waiting" : "Waiting";
  if (phase === "capturing") status = "Recording";
  if (phase === "processing") status = "Processing";
  if (phase === "error") status = "Error";
  const accessibilityLabel = error
    ? `Wake dictation: ${error}. Press to retry.`
    : `Wake dictation: ${status}. ${active ? "Press to stop." : "Press to start."}`;
  const handlePress = useCallback(() => {
    void (active ? stop() : start());
  }, [active, start, stop]);
  const trailing = useMemo(() => {
    let dotStyle = styles.off;
    if (phase === "armed") dotStyle = styles.armed;
    if (phase === "capturing" || phase === "processing") dotStyle = styles.capturing;
    return (
      <View style={styles.status}>
        <View style={[styles.dot, dotStyle]} />
        <Text style={styles.statusText}>{status}</Text>
      </View>
    );
  }, [phase, status]);

  return (
    <SidebarHeaderRow
      icon={Mic2}
      label="Wake dictation"
      onPress={handlePress}
      testID="sidebar-wake-dictation"
      variant="compact"
      accessibilityLabel={accessibilityLabel}
      trailing={trailing}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  status: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  dot: { width: 7, height: 7, borderRadius: theme.borderRadius.full },
  off: { backgroundColor: theme.colors.foregroundMuted },
  armed: { backgroundColor: theme.colors.statusDotWarning },
  capturing: { backgroundColor: theme.colors.statusDotSuccess },
  statusText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
