"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabasePublicConfig = {
  url: string;
  anonKey: string;
};

let browserClient: SupabaseClient | null = null;
let browserClientConfig = "";

export function createVocabularyClient({
  url,
  anonKey,
}: SupabasePublicConfig): SupabaseClient | null {
  if (!url || !anonKey) return null;

  const configKey = `${url}\n${anonKey}`;
  if (browserClient && browserClientConfig === configKey) return browserClient;

  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  browserClientConfig = configKey;
  return browserClient;
}
