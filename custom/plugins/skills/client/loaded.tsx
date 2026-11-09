// CUSTOM(skills-loaded): the "Skills and MCPs Loaded" tab of the composer popover. Shows what
// the agent's session file says is in its context: skills, and MCP servers with their tools.

import { type PluginHostProps, useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { z } from "zod";

import { loadedSkills, type LoadedMcpServerSchema, type LoadedSkillSchema } from "../shared/skills";

type Theme = PluginHostProps["theme"];
type LoadedResult = z.infer<(typeof loadedSkills)["output"]>;
type LoadedSkill = z.infer<typeof LoadedSkillSchema>;
type LoadedMcpServer = z.infer<typeof LoadedMcpServerSchema>;

const GROUPS: ReadonlyArray<{ group: LoadedSkill["group"]; label: string }> = [
  { group: "custom", label: "Your skills" },
  { group: "described", label: "Name + description" },
  { group: "name-only", label: "Name only" },
];

const CATEGORY_LABEL: Record<LoadedSkill["category"], string> = {
  custom: "user custom",
  plugin: "plugin",
  bundled: "bundled",
};

const STATUS_LABEL: Record<LoadedMcpServer["status"], string> = {
  loaded: "loaded",
  "needs-auth": "needs auth",
  pending: "pending",
  failed: "failed",
  configured: "configured",
  disabled: "disabled",
};

function formatDate(iso: string | null): string {
  if (!iso) return "unknown date";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function sourceLine(data: LoadedResult): string {
  switch (data.source) {
    case "session":
      return `From this session's file, written ${formatDate(data.sessionDate)}.`;
    case "last-session":
      return `This agent has no session file yet. From your last session in this project, ${formatDate(data.sessionDate)}.`;
    case "none":
      return "Nothing is known yet: no session of this project was found.";
    case "unsupported":
      return `Only Claude and Codex session files are read; this agent runs ${data.provider}.`;
  }
}

function makeStyles(theme: Theme) {
  return {
    note: { color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 8 },
    section: { color: theme.colors.foreground, fontSize: 14, marginTop: 12, marginBottom: 4 },
    group: {
      color: theme.colors.foregroundMuted,
      fontSize: 12,
      textTransform: "uppercase" as const,
      marginTop: 8,
      marginBottom: 2,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      paddingVertical: 4,
    },
    name: { color: theme.colors.foreground, fontSize: 13, flexShrink: 1 },
    spacer: { flex: 1 },
    badge: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    badgeText: { fontSize: 11, color: theme.colors.foregroundMuted },
    category: { fontSize: 11, color: theme.colors.foregroundMuted, minWidth: 70, textAlign: "right" as const },
    detail: { color: theme.colors.foregroundMuted, fontSize: 12, marginBottom: 4 },
    error: { color: theme.colors.statusDanger, fontSize: 12, marginBottom: 4 },
  };
}

type Styles = ReturnType<typeof makeStyles>;

function Badge({ styles, label, color }: { styles: Styles; label: string; color?: string }) {
  return (
    <View style={[styles.badge, color ? { borderColor: color } : null]}>
      <Text style={[styles.badgeText, color ? { color } : null]}>{label}</Text>
    </View>
  );
}

function statusColor(theme: Theme, status: LoadedMcpServer["status"]): string {
  if (status === "loaded") return theme.colors.statusSuccess;
  if (status === "failed") return theme.colors.statusDanger;
  if (status === "pending" || status === "needs-auth") return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

function serverDetail(server: LoadedMcpServer): string | null {
  const parts: string[] = [];
  if (server.toolCount !== null) {
    parts.push(`${server.toolCount} ${server.toolCount === 1 ? "tool" : "tools"}`);
    if (server.toolCount > 0 && server.fullSchemaCount !== null) {
      parts.push(`${server.fullSchemaCount} full schema`, `${server.toolCount - server.fullSchemaCount} name only`);
    }
  }
  if (server.instructions !== null) {
    parts.push(server.instructions ? "instructions in context" : "no instructions");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function SkillsSection({ styles, skills }: { styles: Styles; skills: LoadedSkill[] }) {
  return (
    <View>
      <Text style={styles.section}>Skills ({skills.length})</Text>
      {skills.length === 0 ? <Text style={styles.note}>No skill list in the session file.</Text> : null}
      {GROUPS.map(({ group, label }) => {
        const rows = skills.filter((skill) => skill.group === group);
        if (rows.length === 0) return null;
        return (
          <View key={group}>
            <Text style={styles.group}>
              {label} ({rows.length})
            </Text>
            {rows.map((skill) => (
              <View key={skill.name} style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>
                  {skill.name}
                </Text>
                <View style={styles.spacer} />
                <Badge styles={styles} label={skill.hasDescription ? "name + description" : "name only"} />
                <Text style={styles.category}>{CATEGORY_LABEL[skill.category]}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function McpSection({ theme, styles, data }: { theme: Theme; styles: Styles; data: LoadedResult }) {
  const servers = data.mcpServers;
  return (
    <View>
      <Text style={styles.section}>MCP servers ({servers.length})</Text>
      {data.mcpSource === "config" ? (
        <Text style={styles.note}>
          Codex records no MCP state in its session file. These are the servers in config.toml.
        </Text>
      ) : null}
      {servers.length === 0 ? <Text style={styles.note}>No MCP server in the session file.</Text> : null}
      {servers.map((server) => {
        const detail = serverDetail(server);
        return (
          <View key={server.name}>
            <View style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {server.name}
              </Text>
              <View style={styles.spacer} />
              <Badge styles={styles} label={STATUS_LABEL[server.status]} color={statusColor(theme, server.status)} />
            </View>
            {detail ? <Text style={styles.detail}>{detail}</Text> : null}
            {server.error ? (
              <Text style={styles.error} numberOfLines={2}>
                {server.error}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function LoadedView({ theme, agentId }: { theme: Theme; agentId: string }) {
  const callLoaded = useRpc(loadedSkills);
  // No cache across openings: the session file grows with every turn.
  const query = useQuery({
    queryKey: ["skills-loaded", agentId],
    queryFn: () => callLoaded({ agentId }),
    retry: false,
    staleTime: 0,
  });
  const styles = useMemo(() => makeStyles(theme), [theme]);

  if (query.isPending) return <ActivityIndicator color={theme.colors.foregroundMuted} />;
  if (query.isError) return <Text style={styles.error}>{(query.error as Error).message}</Text>;

  const data = query.data;
  return (
    <View>
      <Text style={styles.note}>{sourceLine(data)}</Text>
      {data.source === "session" || data.source === "last-session" ? (
        <SkillsSection styles={styles} skills={data.skills} />
      ) : null}
      {data.source !== "unsupported" && (data.mcpServers.length > 0 || data.source !== "none") ? (
        <McpSection theme={theme} styles={styles} data={data} />
      ) : null}
    </View>
  );
}
