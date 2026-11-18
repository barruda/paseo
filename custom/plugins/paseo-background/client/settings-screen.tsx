import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
// Paseo 0.12 exposes these here; newer hosts retain this entry point as an alias.
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { BackgroundController } from "./controller";
import { defaults, sourceUri, withOpacity, type BackgroundSettings } from "../shared/settings";
import { presets } from "../shared/presets";
import { language, mountRange, pickImage, previewFilter } from "./web";
import { setCachedFile } from "../shared/file-cache";
import { saveImageRpc } from "../shared/rpc";

// A transparent pixel stands in while a local image loads from the host.
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function Range({ id, label, hint, value, min = 0, max = 100, step = 1, suffix = "%", accent, color, muted, onChange }: {
  id: string; label: string; hint: string; value: number; min?: number; max?: number; step?: number;
  suffix?: string; accent: string; color: string; muted: string; onChange(value: number): void;
}) {
  const node = useRef<unknown>(null);
  const handle = useRef<ReturnType<typeof mountRange> | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    handle.current = mountRange(node.current, { id, label, value, min, max, step, accent, onChange: (next) => change.current(next) });
    return () => { handle.current?.dispose(); handle.current = null; };
  }, [id, label, min, max, step, accent]);
  useEffect(() => { handle.current?.update(value); }, [value]);
  return (
    <View style={{ padding: 16, gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
        <Text style={{ color, fontSize: 14, fontWeight: "500" }}>{label}</Text>
        <Text style={{ color, fontSize: 13, fontVariant: ["tabular-nums"] }}>{Math.round(value)}{suffix}</Text>
      </View>
      <Text style={{ color: muted, fontSize: 12, lineHeight: 18 }}>{hint}</Text>
      <View ref={node as never} style={{ height: 32, justifyContent: "center" }} />
    </View>
  );
}

export function createSettingsScreen(controller: BackgroundController, client: PluginClientContext) {
  return function BackgroundSettingsScreen({ theme, layout }: PluginSurfaceProps) {
    const current = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
    const [draft, setDraft] = useState<BackgroundSettings>(current.values);
    const [revision, setRevision] = useState(current.revision);
    const [url, setUrl] = useState(current.values.source.kind === "url" ? current.values.source.url : "");
    const [inputError, setInputError] = useState("");
    const [message, setMessage] = useState("");
    const [picking, setPicking] = useState(false);
    const [pickError, setPickError] = useState("");
    const dirty = useRef(false);
    const session = useRef(Symbol("background-preview"));
    const previewImage = useRef<unknown>(null);
    const zh = language() === "zh";
    const t = (en: string, chinese: string) => zh ? chinese : en;
    const c = theme.colors;
    const pending = JSON.stringify(draft) !== JSON.stringify(current.values);

    useEffect(() => {
      if (!dirty.current) {
        setDraft(current.values);
        setRevision(current.revision);
        setUrl(current.values.source.kind === "url" ? current.values.source.url : "");
      }
    }, [current.revision, current.values]);
    useEffect(() => () => controller.cancelPreview(session.current), []);
    useEffect(() => previewFilter(previewImage.current, draft), [draft.blurRadius, draft.brightness]);

    function change(patch: Partial<BackgroundSettings>) {
      const next = { ...draft, ...patch };
      dirty.current = true;
      setDraft(next);
      setMessage("");
      controller.preview(session.current, next);
    }
    function discard() {
      const saved = controller.snapshot();
      dirty.current = false;
      setDraft(saved.values);
      setRevision(saved.revision);
      setUrl(saved.values.source.kind === "url" ? saved.values.source.url : "");
      setInputError("");
      setMessage("");
      controller.cancelPreview(session.current);
    }
    // CUSTOM(background-local-image)
    async function chooseFile() {
      setPicking(true);
      setPickError("");
      try {
        const picked = await pickImage();
        if (!picked) return;
        const { id } = await client.rpc(saveImageRpc, { mimeType: picked.mimeType, base64: picked.base64, name: picked.name });
        setCachedFile(id, picked.dataUrl);
        change({ enabled: true, source: { kind: "file", id, name: picked.name } });
      } catch (error) {
        setPickError(error instanceof Error ? error.message : String(error));
      } finally {
        setPicking(false);
      }
    }
    async function save() {
      if (await controller.save(draft, revision)) {
        dirty.current = false;
        const saved = controller.snapshot();
        setDraft(saved.values);
        setRevision(saved.revision);
        setMessage(t("Background saved", "背景已保存"));
      }
    }

    const button = { minHeight: 40, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, alignItems: "center" as const, justifyContent: "center" as const };
    const status = pending ? t("Unsaved preview", "未保存的预览") : t("Saved", "已保存");
    const runtimeText = {
      off: t("Background is off", "背景已关闭"),
      loading: t("Loading image…", "正在加载图片…"),
      active: t("Background applied", "背景已应用"),
      partial: t("This page has limited background support", "当前页面暂未完整适配背景"),
      error: t("Image could not be loaded. Check the address or choose a preset.", "图片加载失败，请检查地址或选择内置背景。"),
      "other-host": t("Using another host's background on this device", "当前设备正在使用另一台主机的背景"),
    }[current.runtime.status];

    if (current.loading) return <Text style={{ color: c.foregroundMuted }}>{t("Loading background settings…", "正在读取背景设置…")}</Text>;

    return (
      <View testID="paseo-background-settings" style={{ gap: 24, padding: layout.compact ? 16 : 28, maxWidth: 900, width: "100%", alignSelf: "center" }}>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <Text style={{ color: c.foreground, fontSize: 24, fontWeight: "600", letterSpacing: -0.5 }}>{t("A view of your own", "给工作区换个背景")}</Text>
            <View style={{ backgroundColor: c.surface1, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5 }}>
              <Text testID="background-draft-status" style={{ color: pending ? c.accent : c.foregroundMuted, fontSize: 11 }}>{status}</Text>
            </View>
          </View>
          <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 20 }}>{t("Choose a landscape, then adjust how much shows through your workspace.", "选择一张背景，调整图片与界面之间的层次。")}</Text>
        </View>

        <View style={{ height: layout.compact ? 174 : 210, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: c.border, backgroundColor: c.surface0 }}>
          <View ref={previewImage as never} style={{ position: "absolute", inset: 0 }}>
            <Image source={{ uri: sourceUri(draft) || PIXEL }} resizeMode={draft.fit} style={{ width: "100%", height: "100%", opacity: draft.enabled ? draft.imageOpacity : 0 }} />
          </View>
          <View style={{ flex: 1, flexDirection: "row" }}>
            <View style={{ width: "27%", padding: 14, gap: 12, backgroundColor: draft.enabled ? withOpacity(c.surface1, draft.surfaceOpacity) ?? c.surface1 : c.surface1, borderRightWidth: 1, borderRightColor: c.border }}>
              <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>PASEO</Text>
              {[0, 1, 2].map((item) => <View key={item} style={{ height: 5, borderRadius: 2, width: item === 1 ? "68%" : "90%", backgroundColor: c.foregroundMuted, opacity: 0.3 }} />)}
              <View style={{ marginTop: 4, height: 22, borderRadius: 4, backgroundColor: c.surface2 }} />
            </View>
            <View style={{ flex: 1, padding: layout.compact ? 14 : 22, justifyContent: "center", gap: 10, backgroundColor: draft.enabled ? withOpacity(c.surface0, draft.surfaceOpacity) ?? c.surface0 : c.surface0 }}>
              <Text style={{ color: c.foreground, fontSize: layout.compact ? 16 : 20, fontWeight: "500" }}>{t("Space to focus.", "留一点风景，专注手上的事。")}</Text>
              <Text style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 17 }}>{t("Text stays clear. Your background stays yours.", "只改变背景，文字和操作保持清晰。")}</Text>
              <View style={{ height: 28, borderRadius: 6, backgroundColor: c.surface2, marginTop: 6, borderWidth: 1, borderColor: c.border }} />
            </View>
          </View>
        </View>

        <SettingsCard>
          <SettingsSwitch label={t("Enable background", "启用背景")} hint={runtimeText} value={draft.enabled} onValueChange={(enabled) => change({ enabled })} testID="background-enabled" />
        </SettingsCard>

        <SettingsSection title={t("Landscapes", "选择背景")} info={t("Included with the plugin. No image service required.", "随插件提供，无需连接外部图片服务。") }>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {presets.map((preset) => {
              const selected = draft.source.kind === "preset" && draft.source.id === preset.id;
              return (
                <Pressable key={preset.id} testID={`background-preset-${preset.id}`} accessibilityRole="button" accessibilityLabel={zh ? preset.zh : preset.name} aria-pressed={selected}
                  onPress={() => change({ source: { kind: "preset", id: preset.id }, enabled: true })}
                  style={{ width: "31.5%", flexGrow: 1, minWidth: 100, borderWidth: selected ? 2 : 1, borderColor: selected ? c.accent : c.border, borderRadius: 9, overflow: "hidden", backgroundColor: c.surface1 }}>
                  <Image source={{ uri: preset.uri }} resizeMode="cover" style={{ height: layout.compact ? 65 : 78, width: "100%" }} />
                  <View style={{ paddingHorizontal: 9, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                    <Text numberOfLines={1} style={{ color: selected ? c.foreground : c.foregroundMuted, fontSize: 11 }}>{zh ? preset.zh : preset.name}</Text>
                    {selected ? <Icon name="Check" size={12} color={c.accent} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={{ gap: 8, marginTop: 8 }}>
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("Or use an image from this computer", "或使用本机图片")}</Text>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Pressable testID="background-choose-file" accessibilityRole="button" disabled={picking} onPress={() => { void chooseFile(); }}
                style={{ ...button, backgroundColor: c.surface2, borderWidth: draft.source.kind === "file" ? 2 : 1, borderColor: draft.source.kind === "file" ? c.accent : c.border, opacity: picking ? 0.5 : 1 }}>
                <Text style={{ color: c.foreground, fontSize: 12 }}>{picking ? t("Uploading…", "正在上传…") : t("Choose local image…", "选择本地图片…")}</Text>
              </Pressable>
              {draft.source.kind === "file" ? (
                <View testID="background-file-selected" style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
                  <Icon name="Check" size={12} color={c.accent} />
                  <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, flexShrink: 1 }}>{draft.source.name || t("Local image", "本地图片")}</Text>
                </View>
              ) : null}
            </View>
            {pickError ? <Text accessibilityRole="alert" testID="background-file-error" style={{ color: c.statusDanger, fontSize: 12 }}>{pickError}</Text> : null}
            <Text style={{ color: c.foregroundMuted, fontSize: 12, marginTop: 4 }}>{t("Or use an HTTPS image address", "或使用 HTTPS 图片地址")}</Text>
            <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 8 }}>
              <TextInput testID="background-url" accessibilityLabel={t("Image URL", "图片地址")} value={url} onChangeText={setUrl} placeholder="https://example.com/background.jpg" autoCapitalize="none"
                style={{ flex: 1, minHeight: 40, borderWidth: 1, borderColor: inputError ? c.statusDanger : c.border, borderRadius: 7, color: c.foreground, backgroundColor: c.surface2, paddingHorizontal: 12, fontSize: 12 }} />
              <Pressable testID="background-use-url" accessibilityRole="button" onPress={() => {
                if (!/^https:\/\/[^\s]+$/i.test(url.trim())) { setInputError(t("Enter a complete HTTPS image address.", "请输入完整的 HTTPS 图片地址。")); return; }
                setInputError(""); change({ enabled: true, source: { kind: "url", url: url.trim() } });
              }} style={{ ...button, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ color: c.foreground, fontSize: 12 }}>{t("Use image", "使用图片")}</Text>
              </Pressable>
            </View>
            {inputError ? <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 12 }}>{inputError}</Text> : null}
          </View>
        </SettingsSection>

        <SettingsSection title={t("Blend & detail", "层次与细节")}>
          <SettingsCard>
            <Range id="imageOpacity" label={t("Image strength", "图片强度")} hint={t("Lower values fade the image into the theme.", "数值越低，图片越淡。")} value={draft.imageOpacity * 100} onChange={(value) => change({ imageOpacity: value / 100 })} accent={c.accent} color={c.foreground} muted={c.foregroundMuted} />
            <Range id="surfaceOpacity" label={t("Interface background", "界面底色")} hint={t("Lower values reveal more of the image. Text remains opaque.", "数值越低，图片越明显；文字透明度保持不变。")} value={draft.surfaceOpacity * 100} onChange={(value) => change({ surfaceOpacity: value / 100 })} accent={c.accent} color={c.foreground} muted={c.foregroundMuted} />
            <Range id="blurRadius" label={t("Blur", "图片模糊")} hint={t("Soften detail behind your work.", "柔化细节，减少背景干扰。")} value={draft.blurRadius} max={24} suffix="px" onChange={(blurRadius) => change({ blurRadius })} accent={c.accent} color={c.foreground} muted={c.foregroundMuted} />
            <Range id="brightness" label={t("Brightness", "图片亮度")} hint={t("Adjust the image without changing the app's theme.", "只调节图片亮度，保留应用主题。")} value={draft.brightness * 100} min={40} max={140} onChange={(value) => change({ brightness: value / 100 })} accent={c.accent} color={c.foreground} muted={c.foregroundMuted} />
            <SettingsSelect label={t("Image fit", "缩放方式")} value={draft.fit} options={[{ label: t("Fill the view", "覆盖区域"), value: "cover" }, { label: t("Show the whole image", "完整显示"), value: "contain" }]} onValueChange={(fit) => change({ fit })} testID="background-fit" />
            <SettingsSelect label={t("Position", "图片位置")} value={draft.position} options={([ ["center", "Center", "居中"], ["top", "Top", "顶部"], ["bottom", "Bottom", "底部"], ["left", "Left", "左侧"], ["right", "Right", "右侧"] ] as const).map(([value, en, chinese]) => ({ value, label: t(en, chinese) }))} onValueChange={(position) => change({ position })} testID="background-position" />
          </SettingsCard>
        </SettingsSection>

        {current.error ? <View style={{ gap: 8 }}>
          <Text testID="background-save-error" accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 12, lineHeight: 18 }}>{current.error}</Text>
          <Pressable accessibilityRole="button" onPress={() => { void controller.refresh().then(discard); }}><Text style={{ color: c.accent }}>{t("Reload saved values", "重新读取保存值")}</Text></Pressable>
        </View> : null}
        {current.runtime.status === "error" ? <Text accessibilityRole="alert" testID="background-image-error" style={{ color: c.statusWarning, fontSize: 12 }}>{runtimeText}</Text> : null}
        {current.runtime.status === "other-host" ? <Pressable accessibilityRole="button" onPress={() => controller.claim()}><Text style={{ color: c.accent }}>{t("Use this host on this device", "在此设备使用当前主机的背景")}</Text></Pressable> : null}

        <View style={{ gap: 12, paddingTop: 4 }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Pressable testID="background-save" accessibilityRole="button" disabled={current.saving || !pending} onPress={() => { void save(); }} style={{ ...button, backgroundColor: c.accent, opacity: current.saving || !pending ? 0.5 : 1 }}>
              <Text style={{ color: c.accentForeground, fontSize: 13, fontWeight: "500" }}>{current.saving ? t("Saving…", "正在保存…") : t("Save background", "保存背景")}</Text>
            </Pressable>
            <Pressable testID="background-discard" accessibilityRole="button" disabled={current.saving} onPress={discard} style={{ ...button, backgroundColor: c.surface1 }}>
              <Text style={{ color: c.foreground, fontSize: 13 }}>{t("Discard", "取消预览")}</Text>
            </Pressable>
            {message ? <Text accessibilityLiveRegion="polite" testID="background-saved-message" style={{ color: c.statusSuccess, fontSize: 12, flexShrink: 1 }}>{message}</Text> : null}
          </View>
          <Pressable testID="background-reset" accessibilityRole="button" onPress={() => change({ ...defaults(), profileId: draft.profileId })} style={{ alignSelf: "flex-start", paddingVertical: 6 }}>
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("Restore defaults", "恢复默认值")}</Text>
          </Pressable>
          <Text style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 17 }}>{t("Saved changes are shared by clients connected to this host. Previews stay on this device. Desktop and web only.", "保存后同步到连接此主机的客户端；未保存的预览仅影响当前设备。支持桌面与 Web。")}</Text>
        </View>
      </View>
    );
  };
}
