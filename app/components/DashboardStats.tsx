"use client";

import { formatNumber, useI18n, type TranslationKey } from "@/lib/i18n";
import type { CollectionStats } from "@/lib/words";

/**
 * The collection's figures, set as a single line of type.
 *
 * These were four tiles; the numbers are unchanged, but a row of boxed stats is
 * the most template-like thing a page like this can have, and it competes with
 * the vocabulary for attention. As a colophon line it reads as a caption to the
 * collection instead of a control panel above it.
 *
 * Every figure is still derived from stored columns only — `created_at` for the
 * weekly count and streak, `part_of_speech` for the type count.
 */
export function DashboardStats({ stats }: { stats: CollectionStats }) {
  const { t, locale } = useI18n();

  const items: { key: TranslationKey; value: number; hint?: TranslationKey }[] = [
    { key: "stats.total", value: stats.total },
    { key: "stats.week", value: stats.addedThisWeek },
    { key: "stats.streak", value: stats.streakDays, hint: "stats.streakHint" },
    { key: "stats.types", value: stats.typeCount },
  ];

  return (
    <dl className="colophon">
      {items.map(({ key, value, hint }) => (
        <div key={key} className="colophon-item" title={hint ? t(hint) : undefined}>
          <dd className="colophon-value m-0">{formatNumber(value, locale)}</dd>
          <dt className="colophon-label">{t(key)}</dt>
        </div>
      ))}
    </dl>
  );
}
