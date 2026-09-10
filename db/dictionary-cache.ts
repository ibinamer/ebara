import { getRuntimeD1Database } from "../lib/runtime-bindings";

const VERSION = "dictionary-v5";
export async function readDictionaryCache(word: string): Promise<unknown | null> {
  try {
    const db = getRuntimeD1Database();
    const row = await db?.prepare("SELECT payload FROM dictionary_cache WHERE cache_key = ? AND expires_at > ?")
      .bind(`${VERSION}:${word}`, Date.now()).first<{ payload: string }>();
    return row ? JSON.parse(row.payload) : null;
  } catch { return null; }
}

export async function writeDictionaryCache(word: string, data: unknown): Promise<void> {
  try {
    const db = getRuntimeD1Database();
    await db?.prepare(`INSERT INTO dictionary_cache(cache_key, payload, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, expires_at=excluded.expires_at`)
      .bind(`${VERSION}:${word}`, JSON.stringify(data), Date.now() + 30 * 86400000).run();
    await db?.prepare("DELETE FROM dictionary_cache WHERE cache_key IN (SELECT cache_key FROM dictionary_cache WHERE expires_at <= ? LIMIT 100)")
      .bind(Date.now()).run();
  } catch { console.warn("dictionary_cache_write_failed"); }
}
