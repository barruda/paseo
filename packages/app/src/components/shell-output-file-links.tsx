// CUSTOM(shell-output-files): a "Logs:" row above a shell tool call's command, linking the files
// the command writes or reads back (see shell-output-files.ts), so the whole log is a click away
// when the agent only printed `head -150` of it. Each link is a chat file link: clicking opens the
// file in a tab, hovering shows the full path and the usual actions.
import { useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AssistantFileLinkSource } from "@/assistant-file-links/resolver";
import { AssistantMarkdownCodeLink } from "@/assistant-file-links/link";
import { useHasAssistantFileLinkResolver } from "@/assistant-file-links/provider";
import { isWeb } from "@/constants/platform";
import { shellOutputFiles } from "./shell-output-files";

export function ShellOutputFileLinks({
  command,
  cwd,
}: {
  command: string;
  cwd: string | undefined;
}): ReactElement | null {
  const hasResolver = useHasAssistantFileLinkResolver();
  const files = useMemo(() => shellOutputFiles(command, cwd), [command, cwd]);
  if (!isWeb || !hasResolver || files.length === 0) return null;
  return (
    <View style={styles.row} testID="shell-output-files">
      <Text style={styles.label}>Logs:</Text>
      {files.map((path) => (
        <ShellOutputFileLink key={path} path={path} />
      ))}
    </View>
  );
}

function ShellOutputFileLink({ path }: { path: string }) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const source = useMemo<AssistantFileLinkSource>(
    () => ({ href: path, text: name, sourceType: "inline-code" }),
    [name, path],
  );
  return (
    <Text style={styles.text}>
      <AssistantMarkdownCodeLink
        source={source}
        inheritedStyles={styles.text}
        codeInlineStyle={styles.code}
        linkStyle={styles.link}
      >
        {name}
      </AssistantMarkdownCodeLink>
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.spacing[2],
    rowGap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  text: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  code: {
    fontFamily: theme.fontFamily.mono,
  },
  link: {
    color: theme.colors.accentBright,
  },
}));
