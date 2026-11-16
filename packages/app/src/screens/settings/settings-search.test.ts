import { describe, expect, it } from "vitest";
import { filterSettingsSidebar, type SearchableGroup } from "./settings-search";

const GROUPS: SearchableGroup[] = [
  {
    id: "app",
    label: "App",
    items: [
      { id: "general", label: "General", terms: ["Language", "Default send"] },
      { id: "appearance", label: "Appearance", terms: ["Interface size", "Code font"] },
      { id: "notifications", label: "Notifications", terms: ["Play sound"] },
      { id: "about", label: "About", terms: ["Release channel"] },
    ],
  },
  {
    id: "host",
    label: "Host",
    items: [
      { id: "projects", label: "Projects", terms: ["Configurações do projeto"] },
      { id: "agents", label: "Agents", terms: ["Enable Paseo tools"] },
    ],
  },
];

function idsOf(group: { items: { id: string }[] }): string[] {
  return group.items.map(toId);
}

function toId(item: { id: string }): string {
  return item.id;
}

function hasTerm(item: { matchedTerm: string | null }): boolean {
  return item.matchedTerm !== null;
}

function ids(query: string): string[] {
  return filterSettingsSidebar(GROUPS, query).flatMap((group) =>
    group.items.map((item) => item.id),
  );
}

describe("filterSettingsSidebar", () => {
  it("returns everything unchanged for an empty query", () => {
    const result = filterSettingsSidebar(GROUPS, "   ");
    expect(result.map(idsOf)).toEqual([
      ["general", "appearance", "notifications", "about"],
      ["projects", "agents"],
    ]);
    expect(result.flatMap((group) => group.items).filter(hasTerm)).toEqual([]);
  });

  it("matches labels by subsequence and typo", () => {
    expect(ids("ntfc")).toEqual(["notifications"]);
    expect(ids("apperance")).toEqual(["appearance"]);
  });

  it("reports the content term when only content matched", () => {
    const result = filterSettingsSidebar(GROUPS, "font size");
    const items = result.flatMap((group) => group.items);
    expect(items.map((item) => item.id)).toEqual(["appearance"]);
    expect(items[0].matchedTerm).not.toBeNull();
  });

  it("ranks label matches before content-only matches", () => {
    const groups: SearchableGroup[] = [
      {
        id: "g",
        label: "Group",
        items: [
          { id: "a", label: "Alpha", terms: ["Notifications"] },
          { id: "b", label: "Notifications", terms: [] },
        ],
      },
    ];
    const items = filterSettingsSidebar(groups, "notifications")[0].items;
    expect(items.map((item) => item.id)).toEqual(["b", "a"]);
    expect(items[1].matchedTerm).toBe("Notifications");
  });

  it("keeps the whole group when the group label matches", () => {
    expect(ids("host")).toEqual(["projects", "agents"]);
  });

  it("matches the group label only at the start of one of its words", () => {
    const groups: SearchableGroup[] = [
      {
        id: "bruno",
        label: "Bruno's Customizations",
        items: [{ id: "tabs", label: "Tabs", terms: [] }],
      },
    ];
    expect(filterSettingsSidebar(groups, "custom")[0].items.map(toId)).toEqual(["tabs"]);
    expect(filterSettingsSidebar(groups, "zations")).toEqual([]);
  });

  it("lets tokens match across label and content", () => {
    expect(ids("appearance code")).toEqual(["appearance"]);
    expect(ids("general language")).toEqual(["general"]);
    expect(ids("general code")).toEqual([]);
  });

  it("ignores diacritics on both sides", () => {
    expect(ids("configuracoes")).toEqual(["projects"]);
    expect(ids("configurações")).toEqual(["projects"]);
  });

  it("returns no groups when nothing matches", () => {
    expect(filterSettingsSidebar(GROUPS, "zzzzqq")).toEqual([]);
  });
});
