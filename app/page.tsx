import Ebara from "./vocabulary-box";

export const dynamic = "force-dynamic";

export default function Home() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ??
    process.env.SUPABASE_URL?.trim() ??
    "";
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    process.env.SUPABASE_ANON_KEY?.trim() ??
    "";

  return (
    <Ebara supabaseUrl={supabaseUrl} supabaseAnonKey={supabaseAnonKey} />
  );
}
