import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Image } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { computeAttachmentZoomSize } from "./attachment-thumbnail-zoom-size";

// CUSTOM(attachment-thumbnail-zoom): hovering an image thumbnail shows the whole image, so a
// pasted screenshot reads at a glance without opening the lightbox.

function useImageSize(uri: string): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled) setSize({ width, height });
      },
      () => {
        if (!cancelled) setSize({ width: 0, height: 0 });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return size;
}

function AttachmentZoomImage({ uri, thumbnailSize }: { uri: string; thumbnailSize: number }) {
  const imageSize = useImageSize(uri);
  const source = useMemo(() => ({ uri }), [uri]);
  const style = useMemo(
    () => [
      styles.image,
      computeAttachmentZoomSize({
        thumbnailSize,
        imageWidth: imageSize?.width ?? 0,
        imageHeight: imageSize?.height ?? 0,
      }),
    ],
    [imageSize, thumbnailSize],
  );
  if (!imageSize) return null;
  return <Image source={source} style={style} resizeMode="contain" />;
}

/** Wraps an image thumbnail so hovering it (web only) shows the image magnified above it. */
export function AttachmentThumbnailZoom({
  uri,
  thumbnailSize,
  children,
}: {
  uri: string;
  thumbnailSize: number;
  children: ReactNode;
}) {
  return (
    <HoverCard>
      <HoverCardTrigger>{children}</HoverCardTrigger>
      <HoverCardContent
        placement="top"
        alignment="start"
        offset={8}
        style={styles.surface}
        testID="attachment-thumbnail-zoom"
      >
        <AttachmentZoomImage uri={uri} thumbnailSize={thumbnailSize} />
      </HoverCardContent>
    </HoverCard>
  );
}

const styles = StyleSheet.create((theme) => ({
  surface: {
    overflow: "hidden",
    borderRadius: theme.borderRadius.md,
  },
  image: {
    backgroundColor: theme.colors.surface1,
  },
}));
