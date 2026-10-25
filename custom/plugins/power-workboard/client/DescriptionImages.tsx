// CUSTOM(workboard-images): thumbnails of the images a description references, shown under the
// description field. Press one to see it larger; × removes its reference from the text.
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { findImageRefs, type ImageRef } from "../shared/images";
import { readImageRpc } from "../shared/rpc";

type ImageState =
  | { status: "loading" }
  | { status: "ready"; uri: string }
  | { status: "missing" };

// Images never change once saved, so each is fetched once per app session.
const loaded = new Map<string, Promise<string>>();

export function DescriptionImages({
  text,
  editable,
  theme,
  labels,
  onRemove,
}: {
  text: string;
  editable: boolean;
  theme: PluginSurfaceProps["theme"];
  labels: { remove: string; missing: string };
  onRemove(ref: ImageRef): void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const refs = findImageRefs(text);
  if (refs.length === 0) return null;
  return (
    <View style={styles.strip}>
      {refs.map((ref, index) => (
        <Thumbnail
          // The same image can be referenced twice, so the position is part of the key.
          key={`${ref.path}:${index}`}
          path={ref.path}
          large={expanded === `${ref.path}:${index}`}
          editable={editable}
          theme={theme}
          labels={labels}
          onToggle={() =>
            setExpanded((current) =>
              current === `${ref.path}:${index}`
                ? null
                : `${ref.path}:${index}`,
            )
          }
          onRemove={() => onRemove(ref)}
        />
      ))}
    </View>
  );
}

function Thumbnail({
  path,
  large,
  editable,
  theme,
  labels,
  onToggle,
  onRemove,
}: {
  path: string;
  large: boolean;
  editable: boolean;
  theme: PluginSurfaceProps["theme"];
  labels: { remove: string; missing: string };
  onToggle(): void;
  onRemove(): void;
}) {
  const rpc = useRpc(readImageRpc);
  const read = useRef(rpc);
  read.current = rpc;
  const [image, setImage] = useState<ImageState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    let request = loaded.get(path);
    if (!request) {
      request = read.current({ path }).then((result) => result.dataUri);
      loaded.set(path, request);
      // A failed read is retried the next time the image is shown.
      request.catch(() => loaded.delete(path));
    }
    request.then(
      (uri) => !cancelled && setImage({ status: "ready", uri }),
      () => !cancelled && setImage({ status: "missing" }),
    );
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <View
      style={[
        large ? styles.large : styles.thumb,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
      ]}
    >
      {image.status === "ready" ? (
        <Pressable
          accessibilityRole="imagebutton"
          onPress={onToggle}
          style={styles.fill}
        >
          <Image
            source={{ uri: image.uri }}
            resizeMode={large ? "contain" : "cover"}
            style={styles.fill}
          />
        </Pressable>
      ) : (
        <Text style={[styles.message, { color: theme.colors.foregroundMuted }]}>
          {image.status === "missing" ? labels.missing : "…"}
        </Text>
      )}
      {editable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.remove}
          onPress={onRemove}
          style={[styles.remove, { backgroundColor: theme.colors.surface2 }]}
        >
          <Text style={{ color: theme.colors.foreground }}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumb: {
    width: 120,
    height: 90,
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  large: {
    width: "100%",
    height: 360,
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  fill: { width: "100%", height: "100%" },
  message: { fontSize: 12, padding: 6, textAlign: "center" },
  remove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
});
