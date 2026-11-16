// CUSTOM(settings-filter): pure matching and ranking for the settings sidebar filter.
import {
  compareMatchScores,
  fuzzyPolicyForToken,
  scoreMatch,
  type MatchScore,
} from "@getpaseo/protocol/search/text-match";

export interface SearchableItem {
  id: string;
  label: string;
  /** Titles, labels and hints of the settings that live inside the item's page. */
  terms: string[];
}

export interface SearchableGroup<Item extends SearchableItem = SearchableItem> {
  id: string;
  label: string;
  items: Item[];
}

export type FilteredItem<Item extends SearchableItem = SearchableItem> = Item & {
  /** The content term that made the item match, when its label did not. */
  matchedTerm: string | null;
};

export interface FilteredGroup<Item extends SearchableItem = SearchableItem> {
  id: string;
  label: string;
  items: FilteredItem<Item>[];
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function tokenize(query: string): string[] {
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function worst(a: MatchScore, b: MatchScore): MatchScore {
  return compareMatchScores(a, b) >= 0 ? a : b;
}

function best(a: MatchScore | null, b: MatchScore | null): MatchScore | null {
  if (!a) return b;
  if (!b) return a;
  return compareMatchScores(a, b) <= 0 ? a : b;
}

/**
 * The group name ("App", "Host", "Bruno's Customizations") only matches a token that starts one of
 * its words, so a short token like "to" does not pull in the whole group through "customizations".
 */
function scoreGroupLabel(token: string, groupLabel: string): MatchScore | null {
  const score = scoreMatch(token, groupLabel, { subsequence: false });
  if (!score) return null;
  const startsWord = groupLabel.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(token));
  return startsWord ? score : null;
}

interface ItemMatch {
  labelClass: boolean;
  score: MatchScore;
  matchedTerm: string | null;
}

function matchItem(
  tokens: string[],
  label: string,
  groupLabel: string,
  terms: { raw: string; normalized: string }[],
): ItemMatch | null {
  let labelClass = true;
  let overall: MatchScore | null = null;
  let bestTerm: { score: MatchScore; raw: string } | null = null;
  for (const token of tokens) {
    const fuzzy = fuzzyPolicyForToken(token);
    const fromLabel = best(scoreMatch(token, label, { fuzzy }), scoreGroupLabel(token, groupLabel));
    if (fromLabel) {
      overall = overall ? worst(overall, fromLabel) : fromLabel;
      continue;
    }
    let tokenTerm: { score: MatchScore; raw: string } | null = null;
    for (const term of terms) {
      const score = scoreMatch(token, term.normalized, { fuzzy, subsequence: false });
      if (score && (!tokenTerm || compareMatchScores(score, tokenTerm.score) < 0)) {
        tokenTerm = { score, raw: term.raw };
      }
    }
    if (!tokenTerm) return null;
    labelClass = false;
    overall = overall ? worst(overall, tokenTerm.score) : tokenTerm.score;
    if (!bestTerm || compareMatchScores(tokenTerm.score, bestTerm.score) < 0) bestTerm = tokenTerm;
  }
  if (!overall) return null;
  return { labelClass, score: overall, matchedTerm: labelClass ? null : (bestTerm?.raw ?? null) };
}

export function filterSettingsSidebar<Item extends SearchableItem>(
  groups: SearchableGroup<Item>[],
  query: string,
): FilteredGroup<Item>[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return groups.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item, matchedTerm: null })),
    }));
  }
  const result: FilteredGroup<Item>[] = [];
  for (const group of groups) {
    const groupLabel = normalizeSearchText(group.label);
    const matched: { item: FilteredItem<Item>; match: ItemMatch; index: number }[] = [];
    group.items.forEach((item, index) => {
      const terms = item.terms.map((raw) => ({ raw, normalized: normalizeSearchText(raw) }));
      const match = matchItem(tokens, normalizeSearchText(item.label), groupLabel, terms);
      if (match) matched.push({ item: { ...item, matchedTerm: match.matchedTerm }, match, index });
    });
    if (matched.length === 0) continue;
    matched.sort((a, b) => {
      if (a.match.labelClass !== b.match.labelClass) return a.match.labelClass ? -1 : 1;
      if (a.match.labelClass) {
        const byScore = compareMatchScores(a.match.score, b.match.score);
        if (byScore !== 0) return byScore;
      }
      return a.index - b.index;
    });
    result.push({ id: group.id, label: group.label, items: matched.map((entry) => entry.item) });
  }
  return result;
}
