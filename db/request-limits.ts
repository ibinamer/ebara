import { getRuntimeD1Database } from "../lib/runtime-bindings";

export type RequestLimit = { count: number; allowed: boolean; remaining: number; resetAt: number };

/** Atomic counters shared across workers. Raw network addresses are never stored. */
export async function sharedRequestLimit(scope: string, identity: string, limit: number): Promise<RequestLimit | null> {
  const db = getRuntimeD1Database();
  if (!db) return null;
  const now = Date.now();
  const window = Math.floor(now / 60000);
  const resetAt = (window + 1) * 60000;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${scope}:${window}:${identity}`));
    const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const row = await db.prepare(`INSERT INTO request_limits(counter_key, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(counter_key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count`)
      .bind(key, resetAt, limit).first<{ count: number }>();
    // Bounded expiry cleanup avoids retaining request identifiers indefinitely.
    if (row?.count === 1) await db.prepare("DELETE FROM request_limits WHERE counter_key IN (SELECT counter_key FROM request_limits WHERE reset_at < ? LIMIT 100)")
      .bind(now - 60000).run();
    return { count: row?.count ?? limit, allowed: Boolean(row), remaining: Math.max(0, limit - (row?.count ?? limit)), resetAt };
  } catch {
    console.warn("request_limit_storage_unavailable", { scope });
    return { count: limit, allowed: false, remaining: 0, resetAt };
  }
}
