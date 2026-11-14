import { normalizeText } from "./text";

/**
 * One piece of recorded evidence, in domain-neutral terms.
 * DIRA maps an observation to this; Kazi will map a workplace note to it.
 */
export interface EvidenceItem {
  id: string;
  /** What kind of evidence this is (DIRA: the observation type). Signals are formed per group. */
  group: string;
  /** Who recorded it. Independent observers are what make evidence stronger. */
  observer: string;
  /** The day it happened, as YYYY-MM-DD. */
  date: string;
  /** Where or in what activity it happened. Null or blank is not a context. */
  context: string | null;
  /** The words that count: the reviewed text when there is one, otherwise the original. */
  text: string;
  /** True once a human has reviewed it. Only reviewed items count as evidence. */
  reviewed: boolean;
  /** An optional, tentative tag. It is only reported when every item in the group agrees. */
  theme: string | null;
}

export interface CorroborationConfig {
  /** Fewer distinct items than this is under-corroborated. */
  minDistinct: number;
  /** Fewer different observers than this is under-corroborated. */
  minObservers: number;
  /** Fewer different contexts than this is under-corroborated. */
  minContexts: number;
  /** Fewer different dates than this is under-corroborated. */
  minPeriods: number;
  /** A group needs at least this many distinct items AND dates to count as a repeated signal. */
  minRepeats: number;
}

/** The thresholds DIRA has always used. */
export const DEFAULT_CORROBORATION: CorroborationConfig = {
  minDistinct: 3,
  minObservers: 2,
  minContexts: 2,
  minPeriods: 3,
  minRepeats: 2,
};

export interface GroupSummary {
  group: string;
  ids: string[];
  eligibleIds: string[];
  awaitingReviewIds: string[];
}

export interface CorroborationSignal {
  kind: "single" | "repeated";
  group: string;
  theme: string | null;
  ids: string[];
  /** Ids whose wording differs, when the distinct items are not all worded the same. */
  variationIds: string[];
  distinctDates: number;
  distinctObservers: number;
  distinctContexts: number;
  /** Ids dropped as exact repeats of another item (same observer, date, group, context and text). */
  duplicateIds: string[];
  status: "under_corroborated" | "more_corroborated";
}

/** Keep the first item for each id. */
export function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

/** Group items by kind and split the ones a human has reviewed from the ones still waiting. */
export function groupByCategory(items: readonly EvidenceItem[]): GroupSummary[] {
  const groups = new Map<string, GroupSummary>();
  for (const item of uniqueById(items)) {
    let group = groups.get(item.group);
    if (!group) {
      group = { group: item.group, ids: [], eligibleIds: [], awaitingReviewIds: [] };
      groups.set(item.group, group);
    }
    group.ids.push(item.id);
    (item.reviewed ? group.eligibleIds : group.awaitingReviewIds).push(item.id);
  }
  return [...groups.values()].sort((left, right) => left.group.localeCompare(right.group));
}

/**
 * Decide, per group, how well the reviewed evidence is corroborated.
 * Exact repeats (same observer, date, group, context and text) are removed first.
 * Paraphrases are NOT detected: two real events worded differently count as two.
 * Signals are returned weakest first.
 */
export function corroborate(
  items: readonly EvidenceItem[],
  config: CorroborationConfig = DEFAULT_CORROBORATION,
): CorroborationSignal[] {
  const reviewedByGroup = new Map<string, EvidenceItem[]>();
  for (const item of uniqueById(items)) {
    if (!item.reviewed) continue;
    const list = reviewedByGroup.get(item.group) ?? [];
    list.push(item);
    reviewedByGroup.set(item.group, list);
  }

  const signals: CorroborationSignal[] = [];
  for (const [group, groupItems] of reviewedByGroup) {
    const seenEvents = new Set<string>();
    const distinct: EvidenceItem[] = [];
    const duplicateIds: string[] = [];
    for (const item of groupItems) {
      const eventKey = [
        item.observer,
        item.date,
        item.group,
        normalizeText(item.context ?? ""),
        normalizeText(item.text),
      ].join("\u0000");
      if (seenEvents.has(eventKey)) {
        duplicateIds.push(item.id);
      } else {
        seenEvents.add(eventKey);
        distinct.push(item);
      }
    }

    const dates = new Set(distinct.map((item) => item.date));
    const observers = new Set(distinct.map((item) => item.observer));
    const contexts = new Set(
      distinct.map((item) => normalizeText(item.context ?? "")).filter(Boolean),
    );
    const wordings = new Set(distinct.map((item) => normalizeText(item.text)));
    const underCorroborated =
      distinct.length < config.minDistinct ||
      observers.size < config.minObservers ||
      contexts.size < config.minContexts ||
      dates.size < config.minPeriods;

    const themes = new Set(
      groupItems
        .map((item) => item.theme?.trim())
        .filter((theme): theme is string => Boolean(theme))
        .map(normalizeText),
    );
    const theme =
      themes.size === 1
        ? (groupItems.find((item) => item.theme?.trim())?.theme?.trim() ?? null)
        : null;

    signals.push({
      kind:
        distinct.length < config.minRepeats || dates.size < config.minRepeats
          ? "single"
          : "repeated",
      group,
      theme,
      ids: distinct.map((item) => item.id),
      variationIds: wordings.size > 1 ? distinct.map((item) => item.id) : [],
      distinctDates: dates.size,
      distinctObservers: observers.size,
      distinctContexts: contexts.size,
      duplicateIds,
      status: underCorroborated ? "under_corroborated" : "more_corroborated",
    });
  }

  const gaps = (signal: CorroborationSignal) =>
    Number(signal.distinctObservers < config.minObservers) +
    Number(signal.distinctContexts < config.minContexts) +
    Number(signal.distinctDates < config.minPeriods);
  return signals.sort(
    (left, right) => gaps(right) - gaps(left) || left.ids.length - right.ids.length,
  );
}
