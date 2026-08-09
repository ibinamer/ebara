export type WordRecord = {
  id: string;
  user_id: string;
  word: string;
  meaning_ar: string;
  definition_en: string;
  pronunciation: string;
  ipa: string;
  part_of_speech: string;
  example_sentence: string;
  created_at: string;
};

export type DictionaryEntry = Pick<
  WordRecord,
  | "word"
  | "meaning_ar"
  | "definition_en"
  | "pronunciation"
  | "ipa"
  | "part_of_speech"
  | "example_sentence"
>;

export type SortOrder = "newest" | "oldest" | "alphabetical";

export type WordTypeCount = { type: string; count: number };

export type CollectionStats = {
  total: number;
  addedThisWeek: number;
  streakDays: number;
  typeCount: number;
};

/** Local calendar day key, so streaks follow the learner's own timezone. */
function dayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Consecutive days ending today (or yesterday, so an in-progress day is not
 * punished) on which at least one word was saved.
 */
export function calculateStreak(words: WordRecord[], now = new Date()): number {
  if (!words.length) return 0;

  const days = new Set(words.map((entry) => dayKey(entry.created_at)));
  days.delete("");
  if (!days.size) return 0;

  let cursor = new Date(now);
  if (!days.has(dayKey(cursor))) {
    cursor = addDays(cursor, -1);
    if (!days.has(dayKey(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function countAddedSince(words: WordRecord[], days: number, now = new Date()): number {
  const cutoff = addDays(now, -days).getTime();
  return words.filter((entry) => {
    const time = new Date(entry.created_at).getTime();
    return !Number.isNaN(time) && time >= cutoff;
  }).length;
}

export function normalizeType(value: string): string {
  return value.trim().toLowerCase();
}

/** Word types come straight from the stored `part_of_speech` column. */
export function countWordTypes(words: WordRecord[]): WordTypeCount[] {
  const counts = new Map<string, number>();
  for (const entry of words) {
    const type = normalizeType(entry.part_of_speech);
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export function calculateStats(words: WordRecord[], now = new Date()): CollectionStats {
  return {
    total: words.length,
    addedThisWeek: countAddedSince(words, 7, now),
    streakDays: calculateStreak(words, now),
    typeCount: countWordTypes(words).length,
  };
}

export function sortWords(words: WordRecord[], order: SortOrder): WordRecord[] {
  const sorted = [...words];
  if (order === "alphabetical") {
    return sorted.sort((a, b) => a.word.localeCompare(b.word));
  }
  return sorted.sort((a, b) => {
    const left = new Date(a.created_at).getTime();
    const right = new Date(b.created_at).getTime();
    return order === "oldest" ? left - right : right - left;
  });
}
