// CUSTOM(packages): the "Packages" board view. One rail per open package, each with the board's
// usual columns, plus a last rail for tickets without a package. Cards keep the same renderer, so
// selection, chips and menus work here too.
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  cardsForStage,
  type Board,
  type Card,
  type Group,
  type PackageView,
} from "../shared/model";
import { groupColorValue } from "./colors";
import { packageCardPointer, packageRailPointer } from "./web";
import type { strings } from "./strings";

export function PackagesView({
  board,
  cards,
  packages,
  groups,
  t,
  theme,
  onOpenPackage,
  onOpenCard,
  onLongPressCard,
  onAssignCard,
  renderCard,
}: {
  board: Board;
  cards: readonly Card[];
  packages: readonly PackageView[];
  groups: readonly Group[];
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  onOpenPackage(pkg: PackageView): void;
  onOpenCard(card: Card): void;
  onLongPressCard(card: Card): void;
  /** A card dropped on a rail: a package id, or null for the "No package" rail. */
  onAssignCard(packageId: string | null, cardId: string): void;
  renderCard(card: Card): ReactNode;
}) {
  // CUSTOM(packages): the rail under the pointer while a card is dragged, web and desktop only.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const open = packages.filter((pkg) => pkg.status === "open");
  const rails: {
    id: string | null;
    name: string;
    projectName: string;
    color: string;
    progress: string;
    gate: string | null;
    suspect: boolean;
  }[] = [
    ...open.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      projectName: pkg.projectName,
      color: groupColorValue(pkg.color, theme),
      progress: t.packages.progress
        .replace("{merged}", String(pkg.merged))
        .replace("{total}", String(pkg.total)),
      gate: gateLabel(pkg, t),
      suspect: pkg.suspectTaskIds.length > 0,
    })),
    {
      id: null,
      name: t.packages.noPackage,
      projectName: "",
      color: theme.colors.foregroundMuted,
      progress: "",
      gate: null,
      suspect: false,
    },
  ];
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="workboard-packages-view"
    >
      {rails.map((rail) => {
        const railCards = cards.filter((card) =>
          rail.id === null ? !card.packageId : card.packageId === rail.id,
        );
        const pkg = rail.id
          ? open.find((item) => item.id === rail.id)
          : undefined;
        return (
          <View
            key={rail.id ?? "none"}
            {...packageRailPointer(
              (cardId) => onAssignCard(rail.id, cardId),
              (over) => setDropTarget(over ? (rail.id ?? "none") : null),
            )}
            style={[
              styles.rail,
              {
                borderColor:
                  dropTarget === (rail.id ?? "none")
                    ? theme.colors.accent
                    : theme.colors.border,
                borderWidth: dropTarget === (rail.id ?? "none") ? 2 : 1,
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={rail.name}
              disabled={!pkg}
              onPress={() => pkg && onOpenPackage(pkg)}
              style={({ pressed }) => [
                styles.railHeader,
                pressed && pkg && { backgroundColor: theme.colors.surface2 },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: rail.color }]} />
              <Text
                numberOfLines={1}
                style={[styles.railName, { color: theme.colors.foreground }]}
              >
                {rail.name}
              </Text>
              {rail.projectName ? (
                <Text
                  numberOfLines={1}
                  style={[styles.meta, { color: theme.colors.foregroundMuted }]}
                >
                  {rail.projectName}
                </Text>
              ) : null}
              {rail.progress ? (
                <Text
                  style={[styles.meta, { color: theme.colors.foregroundMuted }]}
                >
                  {rail.progress}
                </Text>
              ) : null}
              {rail.gate ? (
                <Text
                  style={[
                    styles.chip,
                    {
                      color: rail.suspect
                        ? theme.colors.statusDanger
                        : theme.colors.foregroundMuted,
                      borderColor: rail.suspect
                        ? theme.colors.statusDanger
                        : theme.colors.border,
                    },
                  ]}
                >
                  {rail.gate}
                </Text>
              ) : null}
              {rail.suspect ? (
                <Text
                  style={[
                    styles.chip,
                    {
                      color: theme.colors.statusDanger,
                      borderColor: theme.colors.statusDanger,
                    },
                  ]}
                >
                  {t.packages.suspect}
                </Text>
              ) : null}
              {pkg ? (
                <Text style={[styles.meta, { color: theme.colors.accent }]}>
                  {t.packages.detailTitle}
                </Text>
              ) : null}
            </Pressable>
            {railCards.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.columns}
              >
                {groups.map((group) => {
                  const inGroup = cardsForStage(
                    railCards,
                    group.id,
                    board.cardOrderByStage,
                  );
                  return (
                    <View key={group.id} style={styles.column}>
                      <Text
                        style={[
                          styles.columnTitle,
                          { color: theme.colors.foregroundMuted },
                        ]}
                      >
                        {group.name ?? group.id}
                      </Text>
                      {inGroup.map((card) => (
                        <Pressable
                          key={card.id}
                          accessibilityRole="button"
                          accessibilityHint={t.packages.dropToPackage.replace(
                            "{name}",
                            rail.name,
                          )}
                          onPress={() => onOpenCard(card)}
                          onLongPress={() => onLongPressCard(card)}
                          style={styles.cardSlot}
                          {...packageCardPointer(card.id)}
                        >
                          {renderCard(card)}
                        </Pressable>
                      ))}
                    </View>
                  );
                })}
              </ScrollView>
            ) : (
              <Text
                style={[styles.meta, { color: theme.colors.foregroundMuted }]}
              >
                {rail.id ? t.packages.noTickets : t.packages.noPackages}
              </Text>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function gateLabel(
  pkg: PackageView,
  t: ReturnType<typeof strings>,
): string | null {
  const run = pkg.lastRun;
  if (!run) return t.packages.gateNone;
  if (run.status === "running") return t.packages.gateRunning;
  if (run.status === "passed") return t.packages.gatePassed;
  if (run.status === "failed") return t.packages.gateFailed;
  if (run.status === "missing-deps") return t.packages.gateMissingDeps;
  return t.packages.gateError;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 12, gap: 12 },
  rail: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  railHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  railName: { fontWeight: "600", maxWidth: 260 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  meta: { fontSize: 12 },
  chip: {
    fontSize: 11,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  columns: { gap: 10, paddingBottom: 4 },
  column: { width: 220, gap: 6 },
  columnTitle: { fontSize: 11, textTransform: "uppercase" },
  cardSlot: { borderRadius: 10 },
});
