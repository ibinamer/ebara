"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabasePublicConfig = {
  url: string;
  anonKey: string;
};

export function createVocabularyClient({
  url,
  anonKey,
}: SupabasePublicConfig): SupabaseClient | null {
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
