import { useCallback, type ReactElement } from "react";
import { MenuItem, MenuSeparator, MenuSubTrigger } from "@/components/ui/menu";
import {
  MAX_AGE_HOURS_CHOICES,
  MAX_PER_PROJECT_CHOICES,
  type SidebarWorkspaceLimit,
} from "./model";
import { useSidebarWorkspaceLimitStore } from "./store";

export const SIDEBAR_WORKSPACE_LIMIT_PAGE_ID = "custom-workspace-limit";

function countLabel(value: number | null): string {
  return value === null ? "All" : String(value);
}

function ageLabel(hours: number | null): string {
  if (hours === null) return "Any age";
  return hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
}

export function limitSummary(limit: SidebarWorkspaceLimit): string {
  if (limit.maxPerProject === null && limit.maxAgeHours === null) return "All";
  return [
    limit.maxPerProject === null ? null : countLabel(limit.maxPerProject),
    limit.maxAgeHours === null ? null : ageLabel(limit.maxAgeHours),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Root rows: the Recent toggle and the branch into the limit page. */
export function SidebarWorkspaceLimitRootItems(): ReactElement {
  const showRecent = useSidebarWorkspaceLimitStore((state) => state.showRecent);
  const toggleShowRecent = useSidebarWorkspaceLimitStore((state) => state.toggleShowRecent);
  const maxPerProject = useSidebarWorkspaceLimitStore((state) => state.maxPerProject);
  const maxAgeHours = useSidebarWorkspaceLimitStore((state) => state.maxAgeHours);
  return (
    <>
      <MenuItem
        selected={showRecent}
        closeOnSelect={false}
        onSelect={toggleShowRecent}
        testID="sidebar-display-show-recent"
      >
        Show Recent
      </MenuItem>
      <MenuSubTrigger
        id={SIDEBAR_WORKSPACE_LIMIT_PAGE_ID}
        value={limitSummary({ maxPerProject, maxAgeHours })}
        testID="sidebar-display-workspace-limit"
      >
        Per project
      </MenuSubTrigger>
    </>
  );
}

/** How many workspaces each project shows, then how old they may be. Both apply together. */
export function SidebarWorkspaceLimitPage(): ReactElement {
  const maxPerProject = useSidebarWorkspaceLimitStore((state) => state.maxPerProject);
  const maxAgeHours = useSidebarWorkspaceLimitStore((state) => state.maxAgeHours);
  const setMaxPerProject = useSidebarWorkspaceLimitStore((state) => state.setMaxPerProject);
  const setMaxAgeHours = useSidebarWorkspaceLimitStore((state) => state.setMaxAgeHours);
  return (
    <>
      {MAX_PER_PROJECT_CHOICES.map((value) => (
        <ChoiceItem
          key={`count-${value}`}
          value={value}
          label={value === null ? "All workspaces" : `At most ${value}`}
          selected={value === maxPerProject}
          onSelect={setMaxPerProject}
          testID={`sidebar-workspace-limit-count-${value ?? "all"}`}
        />
      ))}
      <MenuSeparator />
      {MAX_AGE_HOURS_CHOICES.map((value) => (
        <ChoiceItem
          key={`age-${value}`}
          value={value}
          label={value === null ? "Any age" : `Last ${ageLabel(value)}`}
          selected={value === maxAgeHours}
          onSelect={setMaxAgeHours}
          testID={`sidebar-workspace-limit-age-${value ?? "any"}`}
        />
      ))}
    </>
  );
}

function ChoiceItem({
  value,
  label,
  selected,
  onSelect,
  testID,
}: {
  value: number | null;
  label: string;
  selected: boolean;
  onSelect: (value: number | null) => void;
  testID: string;
}): ReactElement {
  const handleSelect = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <MenuItem selected={selected} closeOnSelect={false} onSelect={handleSelect} testID={testID}>
      {label}
    </MenuItem>
  );
}
