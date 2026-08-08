"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Languages,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mic,
  Plus,
  Search,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createVocabularyClient } from "@/lib/supabase";

type WordRecord = {
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

type DictionaryEntry = Pick<
  WordRecord,
  | "word"
  | "meaning_ar"
  | "definition_en"
  | "pronunciation"
  | "ipa"
  | "part_of_speech"
  | "example_sentence"
>;

type AuthMode = "login" | "signup" | "forgot" | "update";
type AddStep = "capture" | "review";

type SpeechAlternative = { transcript: string; confidence: number };
type SpeechResultEventLike = {
  results: ArrayLike<
    ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }
  >;
};
type SpeechErrorEventLike = { error: string };
type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

const DEMO_WORDS: WordRecord[] = [
  {
    id: "demo-perseverance",
    user_id: "demo-user",
    word: "perseverance",
    meaning_ar: "المثابرة",
    definition_en: "Continued effort to do or achieve something despite difficulties or failure.",
    pronunciation: "per-suh-VEER-uhns",
    ipa: "/ˌpɜː.səˈvɪə.rəns/",
    part_of_speech: "noun",
    example_sentence: "Her perseverance helped her finish the difficult project.",
    created_at: "2026-08-01T14:42:00.000Z",
  },
  {
    id: "demo-serendipity",
    user_id: "demo-user",
    word: "serendipity",
    meaning_ar: "صدفة سعيدة",
    definition_en: "The pleasant discovery of something valuable or interesting by chance.",
    pronunciation: "ser-uhn-DIP-uh-tee",
    ipa: "/ˌser.ənˈdɪp.ə.ti/",
    part_of_speech: "noun",
    example_sentence: "Finding that quiet bookshop was pure serendipity.",
    created_at: "2026-07-31T14:16:00.000Z",
  },
  {
    id: "demo-subtle",
    user_id: "demo-user",
    word: "subtle",
    meaning_ar: "دقيق، غير واضح",
    definition_en: "So delicate or precise that it is difficult to notice or describe.",
    pronunciation: "SUHT-l",
    ipa: "/ˈsʌt.əl/",
    part_of_speech: "adjective",
    example_sentence: "The room had a subtle scent of cedar.",
    created_at: "2026-07-29T11:05:00.000Z",
  },
  {
    id: "demo-gentle",
    user_id: "demo-user",
    word: "gentle",
    meaning_ar: "لطيف، رقيق",
    definition_en: "Kind, calm, or soft in manner or effect.",
    pronunciation: "JEN-tl",
    ipa: "/ˈdʒen.təl/",
    part_of_speech: "adjective",
    example_sentence: "She gave the door a gentle push.",
    created_at: "2026-07-25T12:31:00.000Z",
  },
];

const DEMO_DICTIONARY: Record<string, DictionaryEntry> = {
  perseverance: {
    word: "perseverance",
    meaning_ar: "المثابرة",
    definition_en: "Continued effort to do or achieve something despite difficulties or failure.",
    pronunciation: "per-suh-VEER-uhns",
    ipa: "/ˌpɜː.səˈvɪə.rəns/",
    part_of_speech: "noun",
    example_sentence: "Her perseverance helped her finish the difficult project.",
  },
  perserverance: {
    word: "perseverance",
    meaning_ar: "المثابرة",
    definition_en: "Continued effort to do or achieve something despite difficulties or failure.",
    pronunciation: "per-suh-VEER-uhns",
    ipa: "/ˌpɜː.səˈvɪə.rəns/",
    part_of_speech: "noun",
    example_sentence: "Her perseverance helped her finish the difficult project.",
  },
  curious: {
    word: "curious",
    meaning_ar: "فضولي",
    definition_en: "Eager to know or learn something.",
    pronunciation: "KYOOR-ee-uhs",
    ipa: "/ˈkjʊə.ri.əs/",
    part_of_speech: "adjective",
    example_sentence: "The curious child asked another question.",
  },
};

const GUEST_WORDS_STORAGE_KEY = "vocabulary-box:guest-words";
const GUEST_ACTIVE_STORAGE_KEY = "vocabulary-box:guest-active";

function normalizeCandidate(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function speakWord(value: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(value);
  utterance.lang = "en-US";
  utterance.rate = 0.86;
  window.speechSynthesis.speak(utterance);
}

function fallbackDictionaryEntry(value: string): DictionaryEntry {
  const normalized = normalizeCandidate(value);
  const known = DEMO_DICTIONARY[normalized];
  if (known) return known;

  return {
    word: normalized,
    meaning_ar: "معنى تجريبي",
    definition_en: "Dictionary details are available after the live services are connected.",
    pronunciation: "",
    ipa: "",
    part_of_speech: "word",
    example_sentence: "",
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function getInitial(email?: string) {
  return (email?.trim().charAt(0) || "V").toUpperCase();
}

function AppMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3" aria-label="Vocabulary Box">
      <span
        className={`grid shrink-0 place-items-center rounded-[14px] border border-emerald-300/20 bg-emerald-400 text-[#04110b] shadow-[0_10px_35px_rgba(52,211,153,0.2)] ${
          compact ? "size-9" : "size-11"
        }`}
      >
        <BookOpen size={compact ? 17 : 20} strokeWidth={2.2} aria-hidden="true" />
      </span>
      <span className={`${compact ? "text-sm" : "text-base"} font-semibold tracking-[-0.02em] text-white`}>
        Vocabulary Box
      </span>
    </div>
  );
}

export default function VocabularyBox({
  supabaseUrl,
  supabaseAnonKey,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  const supabase = useMemo(
    () => createVocabularyClient({ url: supabaseUrl, anonKey: supabaseAnonKey }),
    [supabaseUrl, supabaseAnonKey],
  );
  const demoMode = !supabase;
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(demoMode);
  const [guestMode, setGuestMode] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [words, setWords] = useState<WordRecord[]>(demoMode ? DEMO_WORDS : []);
  const [isLoadingWords, setIsLoadingWords] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWord, setSelectedWord] = useState<WordRecord | null>(null);
  const [wordToDelete, setWordToDelete] = useState<WordRecord | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadWords = useCallback(async () => {
    if (!supabase || demoMode) return;
    setIsLoadingWords(true);
    const { data, error } = await supabase
      .from("words")
      .select(
        "id,user_id,word,meaning_ar,definition_en,pronunciation,ipa,part_of_speech,example_sentence,created_at",
      )
      .order("created_at", { ascending: false });

    if (error) {
      setToast("We couldn’t load your words. Please try again.");
    } else {
      setWords((data ?? []) as WordRecord[]);
    }
    setIsLoadingWords(false);
  }, [demoMode, supabase]);

  useEffect(() => {
    if (!supabase || demoMode) return;

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
      if (data.session) {
        window.localStorage.removeItem(GUEST_ACTIVE_STORAGE_KEY);
        setGuestMode(false);
        void loadWords();
      } else if (window.localStorage.getItem(GUEST_ACTIVE_STORAGE_KEY) === "true") {
        try {
          const stored = window.localStorage.getItem(GUEST_WORDS_STORAGE_KEY);
          setWords(stored ? (JSON.parse(stored) as WordRecord[]) : []);
        } catch {
          setWords([]);
        }
        setGuestMode(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthReady(true);
      if (event === "PASSWORD_RECOVERY") setAuthMode("update");
      if (nextSession && event === "SIGNED_IN") {
        window.localStorage.removeItem(GUEST_ACTIVE_STORAGE_KEY);
        setGuestMode(false);
        void loadWords();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [demoMode, loadWords, supabase]);

  useEffect(() => {
    if (demoMode || session || !guestMode) return;
    window.localStorage.setItem(GUEST_WORDS_STORAGE_KEY, JSON.stringify(words));
  }, [demoMode, guestMode, session, words]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const filteredWords = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return words;
    return words.filter(
      (entry) =>
        entry.word.toLocaleLowerCase().includes(query) ||
        entry.meaning_ar.includes(query),
    );
  }, [searchQuery, words]);

  async function handleLogout() {
    if (guestMode) {
      window.localStorage.removeItem(GUEST_ACTIVE_STORAGE_KEY);
      setGuestMode(false);
      setWords([]);
      return;
    }
    if (demoMode || !supabase) {
      setToast("Connect Supabase to enable private accounts.");
      return;
    }
    await supabase.auth.signOut();
    setWords([]);
  }

  function continueAsGuest() {
    let storedWords: WordRecord[] = [];
    try {
      const stored = window.localStorage.getItem(GUEST_WORDS_STORAGE_KEY);
      if (stored) storedWords = JSON.parse(stored) as WordRecord[];
    } catch {
      storedWords = [];
    }
    window.localStorage.setItem(GUEST_ACTIVE_STORAGE_KEY, "true");
    setWords(storedWords);
    setGuestMode(true);
  }

  async function handleSave(dictionaryEntry: DictionaryEntry) {
    if (words.some((entry) => entry.word.toLowerCase() === dictionaryEntry.word.toLowerCase())) {
      throw new Error("This word is already in your box.");
    }

    if (demoMode || !supabase || !session) {
      const previewWord: WordRecord = {
        ...dictionaryEntry,
        id: `demo-${Date.now()}`,
        user_id: guestMode ? "guest-user" : "demo-user",
        created_at: new Date().toISOString(),
      };
      setWords((current) => [previewWord, ...current]);
      setToast(`${capitalize(previewWord.word)} is safe in your box.`);
      return;
    }

    const { data, error } = await supabase
      .from("words")
      .insert({
        user_id: session.user.id,
        word: dictionaryEntry.word,
        meaning_ar: dictionaryEntry.meaning_ar,
        definition_en: dictionaryEntry.definition_en,
        pronunciation: dictionaryEntry.pronunciation,
        ipa: dictionaryEntry.ipa,
        part_of_speech: dictionaryEntry.part_of_speech,
        example_sentence: dictionaryEntry.example_sentence,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") throw new Error("This word is already in your box.");
      throw new Error(error.message || "We couldn’t save this word.");
    }

    setWords((current) => [data as WordRecord, ...current]);
    setToast(`${capitalize(dictionaryEntry.word)} is safe in your box.`);
  }

  async function handleDelete() {
    if (!wordToDelete) return;
    const target = wordToDelete;

    if (!demoMode && supabase && session) {
      const { error } = await supabase.from("words").delete().eq("id", target.id);
      if (error) {
        setToast("We couldn’t delete this word. Please try again.");
        return;
      }
    }

    setWords((current) => current.filter((entry) => entry.id !== target.id));
    setWordToDelete(null);
    if (selectedWord?.id === target.id) setSelectedWord(null);
    setToast(`${capitalize(target.word)} was removed.`);
  }

  if (!authReady) return <LoadingScreen />;

  if (!demoMode && !session && !guestMode) {
    return (
      <AuthScreen
        client={supabase}
        mode={authMode}
        onModeChange={setAuthMode}
        onContinueGuest={continueAsGuest}
      />
    );
  }

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#050806] text-white">
      <div className="ambient-glow" aria-hidden="true" />

      <header className="relative z-10 border-b border-white/[0.06]">
        <div className="mx-auto flex h-[76px] max-w-[1180px] items-center justify-between px-5 sm:px-8">
          <AppMark compact />

          <div className="flex items-center gap-2.5">
            {(demoMode || guestMode) && (
              <span className="hidden rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium tracking-wide text-white/45 sm:inline-flex">
                {guestMode ? "Guest · saved on this device" : "Preview"}
              </span>
            )}
            <div
              className="grid size-9 place-items-center rounded-full border border-emerald-300/15 bg-emerald-400/10 text-xs font-semibold text-emerald-300"
              aria-label={session?.user.email ?? (guestMode ? "Guest account" : "Preview account")}
            >
              {getInitial(session?.user.email)}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="icon-button"
              aria-label={guestMode ? "Log in or create account" : "Log out"}
              title={guestMode ? "Log in or create account" : "Log out"}
            >
              <LogOut size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <section className="relative z-[1] mx-auto max-w-[1180px] px-5 pb-20 pt-14 sm:px-8 sm:pt-20 lg:pt-24">
        <div className="max-w-4xl">
          <div className="mb-5 flex items-center gap-2.5 text-xs font-medium uppercase tracking-[0.18em] text-emerald-300/75">
            <LockKeyhole size={13} aria-hidden="true" />
            Your private word collection
          </div>
          <h1 className="text-balance text-[clamp(2.75rem,8vw,6.7rem)] font-semibold leading-[0.91] tracking-[-0.072em] text-[#f3f7f4]">
            My Vocabulary
            <span className="block text-white/32">Box.</span>
          </h1>
          <div className="mt-7 flex items-baseline gap-3 sm:mt-9">
            <span className="text-3xl font-semibold tracking-[-0.04em] text-emerald-300 sm:text-4xl">
              {words.length}
            </span>
            <span className="text-sm text-white/42">
              {words.length === 1 ? "word saved" : "words saved"}
            </span>
          </div>
        </div>

        <div className="mt-10 grid gap-3 sm:mt-14 sm:grid-cols-[1fr_auto]">
          <label className="search-field group">
            <Search
              size={18}
              className="shrink-0 text-white/30 transition-colors group-focus-within:text-emerald-300"
              aria-hidden="true"
            />
            <span className="sr-only">Search words or Arabic meanings</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search words or Arabic meanings"
              autoComplete="off"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="grid size-7 place-items-center rounded-full text-white/35 transition hover:bg-white/5 hover:text-white"
                aria-label="Clear search"
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </label>
          <button type="button" onClick={() => setAddOpen(true)} className="primary-button sm:min-w-40">
            <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
            Add word
          </button>
        </div>

        <div className="mt-10 flex items-end justify-between border-b border-white/[0.07] pb-4 sm:mt-14">
          <h2 className="text-sm font-medium tracking-[-0.01em] text-white/70">
            {searchQuery ? "Search results" : "Saved words"}
          </h2>
          {searchQuery && (
            <span className="text-xs text-white/30">
              {filteredWords.length} {filteredWords.length === 1 ? "match" : "matches"}
            </span>
          )}
        </div>

        {isLoadingWords ? (
          <WordGridSkeleton />
        ) : filteredWords.length ? (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredWords.map((entry, index) => (
              <WordCard
                key={entry.id}
                entry={entry}
                index={index}
                onOpen={() => setSelectedWord(entry)}
                onDelete={() => setWordToDelete(entry)}
              />
            ))}
          </div>
        ) : (
          <EmptyState searchQuery={searchQuery} onAdd={() => setAddOpen(true)} />
        )}
      </section>

      <footer className="relative z-[1] mx-auto flex max-w-[1180px] flex-col gap-3 border-t border-white/[0.05] px-5 py-8 text-[11px] leading-5 text-white/25 sm:px-8">
        <p className="max-w-2xl">
          Dictionary data from{" "}
          <a className="transition hover:text-white/45" href="https://dictionaryapi.dev/" target="_blank" rel="noreferrer">
            Free Dictionary API
          </a>{" "}
          and Arabic meanings from{" "}
          <a className="transition hover:text-white/45" href="https://en.wiktionary.org/" target="_blank" rel="noreferrer">
            Wiktionary
          </a>{" "}
          (CC BY-SA).
        </p>
      </footer>

      <AddWordDialog
        open={addOpen}
        session={session}
        demoMode={demoMode}
        savedWords={words}
        onClose={() => setAddOpen(false)}
        onSave={handleSave}
      />

      {selectedWord && (
        <WordDetailsDialog entry={selectedWord} onClose={() => setSelectedWord(null)} />
      )}

      {wordToDelete && (
        <DeleteDialog
          entry={wordToDelete}
          onCancel={() => setWordToDelete(null)}
          onConfirm={handleDelete}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <span className="grid size-5 place-items-center rounded-full bg-emerald-400 text-[#04110b]">
            <Check size={13} strokeWidth={3} aria-hidden="true" />
          </span>
          {toast}
        </div>
      )}
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#050806] text-white">
      <div className="flex items-center gap-3 text-sm text-white/50" role="status">
        <LoaderCircle size={18} className="animate-spin text-emerald-300" aria-hidden="true" />
        Opening your box…
      </div>
    </main>
  );
}

function AuthScreen({
  client,
  mode,
  onModeChange,
  onContinueGuest,
}: {
  client: SupabaseClient;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onContinueGuest: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const copy = {
    login: {
      eyebrow: "Welcome back",
      title: "Open your box.",
      subtitle: "Your words are right where you left them.",
      button: "Log in",
    },
    signup: {
      eyebrow: "A home for every word",
      title: "Create your box.",
      subtitle: "One quiet place for every English word you learn.",
      button: "Create account",
    },
    forgot: {
      eyebrow: "Password reset",
      title: "Find your way back.",
      subtitle: "We’ll email you a secure link to reset your password.",
      button: "Send reset link",
    },
    update: {
      eyebrow: "Choose a new password",
      title: "Secure your box.",
      subtitle: "Use at least eight characters for your new password.",
      button: "Update password",
    },
  }[mode];

  function switchMode(nextMode: AuthMode) {
    setError(null);
    setMessage(null);
    setPassword("");
    setConfirmPassword("");
    onModeChange(nextMode);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        const { error: signInError } = await client.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      } else if (mode === "signup") {
        const { error: signUpError } = await client.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        setMessage("Check your inbox to confirm your account, then come back to log in.");
      } else if (mode === "forgot") {
        const { error: resetError } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/?reset=1`,
        });
        if (resetError) throw resetError;
        setMessage("Reset link sent. Check your inbox.");
      } else {
        if (password.length < 8) throw new Error("Use at least eight characters.");
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        const { error: updateError } = await client.auth.updateUser({ password });
        if (updateError) throw updateError;
        setMessage("Password updated. Your box is secure.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#050806] px-5 py-8 text-white sm:px-8">
      <div className="auth-glow" aria-hidden="true" />
      <div className="relative z-[1] mx-auto flex min-h-[calc(100dvh-4rem)] max-w-[1180px] flex-col">
        <div className="flex items-center justify-between">
          <AppMark compact />
          {mode !== "login" && mode !== "update" && (
            <button type="button" onClick={() => switchMode("login")} className="text-button">
              Log in
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="grid flex-1 items-center gap-14 py-14 lg:grid-cols-[1.08fr_0.92fr] lg:gap-24">
          <div className="max-w-[620px]">
            <p className="mb-5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-300/75">
              <LockKeyhole size={13} aria-hidden="true" />
              Private by default
            </p>
            <h1 className="text-balance text-[clamp(3.6rem,9vw,7.8rem)] font-semibold leading-[0.86] tracking-[-0.078em] text-[#f4f7f5]">
              Every word.
              <span className="block text-white/28">Never lost.</span>
            </h1>
            <p className="mt-8 max-w-md text-base leading-7 text-white/42 sm:text-lg">
              A calm, personal vault for every English word you learn—and nothing you don’t need.
            </p>
          </div>

          <div className="auth-card">
            <div className="mb-8">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-emerald-300/65">
                {copy.eyebrow}
              </p>
              <h2 className="text-3xl font-semibold tracking-[-0.045em] text-white sm:text-[2.15rem]">
                {copy.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/40">{copy.subtitle}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode !== "update" && (
                <label className="auth-field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </label>
              )}

              {mode !== "forgot" && (
                <label className="auth-field">
                  <span>{mode === "update" ? "New password" : "Password"}</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    minLength={8}
                    required
                  />
                </label>
              )}

              {mode === "update" && (
                <label className="auth-field">
                  <span>Confirm password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repeat your new password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
              )}

              {mode === "login" && (
                <div className="flex justify-end">
                  <button type="button" onClick={() => switchMode("forgot")} className="link-button">
                    Forgot password?
                  </button>
                </div>
              )}

              {error && (
                <div className="notice error-notice" role="alert">
                  <CircleAlert size={16} aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}
              {message && (
                <div className="notice success-notice" role="status">
                  <Check size={16} aria-hidden="true" />
                  <span>{message}</span>
                </div>
              )}

              <button type="submit" className="primary-button w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
                ) : null}
                {copy.button}
                {!isSubmitting && <ArrowRight size={17} aria-hidden="true" />}
              </button>
            </form>

            {(mode === "login" || mode === "signup") && (
              <div className="mt-4">
                <div className="mb-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-white/20">
                  <span className="h-px flex-1 bg-white/[0.07]" />
                  or
                  <span className="h-px flex-1 bg-white/[0.07]" />
                </div>
                <button type="button" onClick={onContinueGuest} className="secondary-button w-full">
                  Continue without an account
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
                <p className="mt-3 text-center text-xs leading-5 text-white/28">
                  Your words stay on this device. Create an account later to sync across devices.
                </p>
              </div>
            )}

            {mode === "login" && (
              <p className="mt-6 text-center text-sm text-white/35">
                New here?{" "}
                <button type="button" onClick={() => switchMode("signup")} className="link-button">
                  Create your box
                </button>
              </p>
            )}

            {(mode === "forgot" || mode === "update") && (
              <button type="button" onClick={() => switchMode("login")} className="mt-6 flex items-center gap-2 text-sm text-white/40 transition hover:text-white">
                <ArrowLeft size={15} aria-hidden="true" />
                Back to login
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function WordCard({
  entry,
  index,
  onOpen,
  onDelete,
}: {
  entry: WordRecord;
  index: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="word-card group" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <button type="button" onClick={onOpen} className="flex min-h-52 w-full flex-col p-6 pb-12 text-left sm:min-h-56 sm:p-7 sm:pb-12">
        <div className="flex items-start justify-between gap-3">
          <time
            dateTime={entry.created_at}
            className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/25"
          >
            {formatDate(entry.created_at)}
          </time>
          <ChevronRight
            size={17}
            className="translate-x-1 text-white/15 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
            aria-hidden="true"
          />
        </div>

        <div className="mt-auto">
          <h3 className="break-words text-[clamp(1.65rem,4vw,2.25rem)] font-semibold leading-tight tracking-[-0.045em] text-[#f1f5f2] transition-colors group-hover:text-emerald-200">
            {entry.word}
          </h3>
          <p lang="ar" dir="rtl" className="mt-3 w-fit text-base leading-7 text-white/42">
            {entry.meaning_ar}
          </p>
        </div>
      </button>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="absolute bottom-5 right-5 grid size-9 place-items-center rounded-full text-white/18 transition-all hover:bg-red-400/10 hover:text-red-300 focus-visible:text-red-300 group-hover:text-white/26"
        aria-label={`Delete ${entry.word}`}
      >
        <Trash2 size={15} aria-hidden="true" />
      </button>
    </article>
  );
}

function EmptyState({ searchQuery, onAdd }: { searchQuery: string; onAdd: () => void }) {
  return (
    <div className="mt-5 flex min-h-72 flex-col items-center justify-center rounded-[28px] border border-dashed border-white/[0.09] bg-white/[0.018] px-6 text-center">
      <span className="mb-5 grid size-12 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.035] text-white/28">
        {searchQuery ? <Search size={20} aria-hidden="true" /> : <BookOpen size={20} aria-hidden="true" />}
      </span>
      <h3 className="text-xl font-semibold tracking-[-0.03em] text-white/80">
        {searchQuery ? "No words found" : "Your box is ready"}
      </h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-white/35">
        {searchQuery
          ? `Nothing matches “${searchQuery}”. Try another word or Arabic meaning.`
          : "Save the first word you want to remember. It only takes a moment."}
      </p>
      {!searchQuery && (
        <button type="button" onClick={onAdd} className="secondary-button mt-6">
          <Plus size={16} aria-hidden="true" />
          Add your first word
        </button>
      )}
    </div>
  );
}

function WordGridSkeleton() {
  return (
    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading words">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div key={item} className="min-h-56 animate-pulse rounded-[24px] border border-white/[0.05] bg-white/[0.025] p-7">
          <div className="h-3 w-24 rounded-full bg-white/[0.045]" />
          <div className="mt-28 h-7 w-3/5 rounded-full bg-white/[0.06]" />
          <div className="mt-4 h-4 w-2/5 rounded-full bg-white/[0.045]" />
        </div>
      ))}
    </div>
  );
}

function AddWordDialog({
  open,
  session,
  demoMode,
  savedWords,
  onClose,
  onSave,
}: {
  open: boolean;
  session: Session | null;
  demoMode: boolean;
  savedWords: WordRecord[];
  onClose: () => void;
  onSave: (word: DictionaryEntry) => Promise<void>;
}) {
  const [step, setStep] = useState<AddStep>("capture");
  const [draft, setDraft] = useState("");
  const [voiceAlternatives, setVoiceAlternatives] = useState<SpeechAlternative[]>([]);
  const [dictionaryEntry, setDictionaryEntry] = useState<DictionaryEntry | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const listeningTimeoutRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (listeningTimeoutRef.current) window.clearTimeout(listeningTimeoutRef.current);
    listeningTimeoutRef.current = null;
    setStep("capture");
    setDraft("");
    setVoiceAlternatives([]);
    setDictionaryEntry(null);
    setIsListening(false);
    setIsProcessing(false);
    setIsSaving(false);
    setError(null);
  }, []);

  const closeDialog = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 80);
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(timeout);
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !isProcessing && !isSaving) closeDialog();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, isProcessing, isSaving, closeDialog]);

  async function lookupWord(candidate: string) {
    const normalized = normalizeCandidate(candidate);
    if (
      !normalized ||
      normalized.length > 80 ||
      !/^[a-z]+(?:['-][a-z]+)*$/.test(normalized)
    ) {
      setError("Enter one English word.");
      return;
    }

    const existingWord = savedWords.find(
      (entry) => normalizeCandidate(entry.word) === normalized,
    );
    if (existingWord) {
      setError("This word is already in your box.");
      return;
    }

    setError(null);
    setIsProcessing(true);
    try {
      let result: DictionaryEntry;
      if (demoMode) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        result = fallbackDictionaryEntry(normalized);
      } else {
        const response = await fetch("/api/dictionary", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ word: normalized }),
        });
        const payload = (await response.json()) as DictionaryEntry & {
          error?: string | { message?: string };
          message?: string;
          data?: DictionaryEntry;
        };
        if (!response.ok) {
          const apiMessage =
            typeof payload.error === "string"
              ? payload.error
              : payload.error?.message ?? payload.message;
          throw new Error(apiMessage || "We couldn’t find that word.");
        }
        result = payload.data ?? payload;
      }

      setDraft(result.word);
      setDictionaryEntry(result);
      setStep("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn’t find that word.");
    } finally {
      setIsProcessing(false);
    }
  }

  function startListening() {
    setError(null);
    const browserWindow = window as SpeechRecognitionWindow;
    const SpeechRecognitionAPI =
      browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setError("Voice input isn’t supported in this browser. You can still type the word.");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 5;
    recognition.onstart = () => {
      setIsListening(true);
      listeningTimeoutRef.current = window.setTimeout(() => recognition.stop(), 9_000);
    };
    recognition.onend = () => {
      setIsListening(false);
      if (listeningTimeoutRef.current) window.clearTimeout(listeningTimeoutRef.current);
      listeningTimeoutRef.current = null;
    };
    recognition.onerror = (event) => {
      setIsListening(false);
      setError(
        event.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in your browser, then try again."
          : "I couldn’t hear that clearly. Try once more or type the word.",
      );
    };
    recognition.onresult = (event) => {
      const finalResult = event.results[event.results.length - 1];
      const alternatives = Array.from({ length: finalResult.length }, (_, index) => {
        const item = finalResult[index];
        return {
          transcript: normalizeCandidate(item.transcript),
          confidence: item.confidence,
        };
      }).filter((item) => item.transcript);

      const unique = alternatives.filter(
        (item, index, array) => array.findIndex((candidate) => candidate.transcript === item.transcript) === index,
      );
      setVoiceAlternatives(unique);
      if (unique[0]) setDraft(unique[0].transcript);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  async function saveWord() {
    if (!dictionaryEntry) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSave(dictionaryEntry);
      closeDialog();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn’t save this word.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && draft.trim() && !isProcessing) void lookupWord(draft);
  }

  if (!open) return null;

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}>
      <section className="dialog-panel add-dialog" role="dialog" aria-modal="true" aria-labelledby="add-word-title">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.17em] text-emerald-300/65">
              {step === "capture" ? "A new word" : "Word ready"}
            </p>
            <h2 id="add-word-title" className="text-3xl font-semibold tracking-[-0.045em] text-white sm:text-4xl">
              {step === "capture" ? "What did you learn?" : dictionaryEntry?.word}
            </h2>
          </div>
          <button type="button" onClick={closeDialog} className="icon-button" aria-label="Close add word">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {step === "capture" ? (
          <div className="mt-9">
            <p className="max-w-md text-sm leading-6 text-white/40">
              Type an English word, or say it out loud. We’ll find its meaning and definition.
            </p>

            <div className={`capture-field mt-7 ${isListening ? "is-listening" : ""}`}>
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(event) => {
                  setDraft(normalizeCandidate(event.target.value));
                  setVoiceAlternatives([]);
                  setError(null);
                }}
                onKeyDown={handleDraftKeyDown}
                placeholder="Type a word"
                autoComplete="off"
                spellCheck="false"
                aria-label="English word"
              />
              <button
                type="button"
                onClick={isListening ? () => recognitionRef.current?.stop() : startListening}
                className="voice-button"
                aria-label={isListening ? "Stop listening" : "Add word by voice"}
              >
                {isListening ? <span className="voice-pulse" aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
              </button>
            </div>

            {isListening && (
              <div className="mt-4 flex items-center gap-2 text-sm text-emerald-300" role="status">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-300" />
                Listening… say one word
              </div>
            )}

            {voiceAlternatives.length > 1 && (
              <div className="mt-6">
                <p className="mb-3 text-xs font-medium text-white/38">Did you mean?</p>
                <div className="flex flex-wrap gap-2">
                  {voiceAlternatives.map((alternative, index) => (
                    <button
                      key={alternative.transcript}
                      type="button"
                      onClick={() => setDraft(alternative.transcript)}
                      className={`suggestion-chip ${draft === alternative.transcript ? "selected" : ""}`}
                    >
                      {alternative.transcript}
                      {index === 0 && <span>Recommended</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <DialogError message={error} />}

            <div className="mt-9 flex justify-end">
              <button
                type="button"
                onClick={() => void lookupWord(draft)}
                className="primary-button min-w-36"
                disabled={!draft.trim() || isProcessing || isListening}
              >
                {isProcessing ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <Languages size={17} aria-hidden="true" />}
                {isProcessing ? "Looking up…" : "Look up word"}
              </button>
            </div>
          </div>
        ) : dictionaryEntry ? (
          <div className="mt-7">
            <div className="rounded-[22px] border border-white/[0.07] bg-black/20 p-5 sm:p-6">
              {(dictionaryEntry.pronunciation || dictionaryEntry.ipa) && (
                <div className="mb-6 grid gap-5 border-b border-white/[0.07] pb-6 sm:grid-cols-2">
                  {dictionaryEntry.pronunciation && (
                    <div>
                      <p className="detail-label">Pronunciation</p>
                      <button
                        type="button"
                        onClick={() => speakWord(dictionaryEntry.word)}
                        className="pronunciation-button mt-3"
                        aria-label={`Pronounce ${dictionaryEntry.word}`}
                      >
                        <Volume2 size={16} aria-hidden="true" />
                        {dictionaryEntry.pronunciation}
                      </button>
                    </div>
                  )}
                  {dictionaryEntry.ipa && (
                    <div>
                      <p className="detail-label">IPA</p>
                      <p className="mt-3 font-mono text-sm leading-7 text-emerald-200/80">
                        {dictionaryEntry.ipa}
                      </p>
                    </div>
                  )}
                </div>
              )}
              <p className="detail-label">Arabic meaning</p>
              <p lang="ar" dir="rtl" className="mt-4 w-fit text-2xl font-medium leading-9 text-white/90">
                {dictionaryEntry.meaning_ar}
              </p>
              <div className="mt-6 border-t border-white/[0.07] pt-6">
                <p className="detail-label">Definition</p>
                <p className="mt-3 text-sm leading-6 text-white/60">
                  {dictionaryEntry.definition_en}
                </p>
              </div>
            </div>

            {error && <DialogError message={error} />}

            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <button type="button" onClick={() => setStep("capture")} className="secondary-button">
                <ArrowLeft size={16} aria-hidden="true" />
                Try another
              </button>
              <button type="button" onClick={() => void saveWord()} className="primary-button" disabled={isSaving}>
                {isSaving ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
                {isSaving ? "Saving…" : "Save to my box"}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function DialogError({ message }: { message: string }) {
  return (
    <div className="notice error-notice mt-5" role="alert">
      <CircleAlert size={16} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function WordDetailsDialog({ entry, onClose }: { entry: WordRecord; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const handleKey = (event: globalThis.KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog-panel details-dialog" role="dialog" aria-modal="true" aria-labelledby="word-title">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.17em] text-white/30">
              Added <time dateTime={entry.created_at}>{formatDate(entry.created_at)}</time>
            </p>
            <h2 id="word-title" className="break-words text-[clamp(2.8rem,10vw,5.6rem)] font-semibold leading-[0.92] tracking-[-0.065em] text-[#f2f6f3]">
              {entry.word}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close word details">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {(entry.pronunciation || entry.ipa) && (
          <section className="mt-9 grid gap-6 rounded-[22px] border border-white/[0.07] bg-black/20 p-5 sm:grid-cols-2 sm:p-6">
            {entry.pronunciation && (
              <div>
                <p className="detail-label">Pronunciation</p>
                <button
                  type="button"
                  onClick={() => speakWord(entry.word)}
                  className="pronunciation-button mt-3"
                  aria-label={`Pronounce ${entry.word}`}
                >
                  <Volume2 size={16} aria-hidden="true" />
                  {entry.pronunciation}
                </button>
              </div>
            )}
            {entry.ipa && (
              <div>
                <p className="detail-label">IPA</p>
                <p className="mt-3 font-mono text-base leading-7 text-emerald-200/80">
                  {entry.ipa}
                </p>
              </div>
            )}
          </section>
        )}

        <section className="mt-10 border-t border-white/[0.07] pt-9">
          <p className="detail-label">Arabic meaning</p>
          <p
            lang="ar"
            dir="rtl"
            className="mt-4 w-fit text-3xl font-medium leading-10 text-white/90"
          >
            {entry.meaning_ar}
          </p>
        </section>

        <section className="mt-9 border-t border-white/[0.07] pt-9">
          <p className="detail-label">Definition</p>
          <p className="mt-4 max-w-2xl text-base leading-7 text-white/68">
            {entry.definition_en}
          </p>
        </section>

        {entry.example_sentence && (
          <section className="mt-9 border-t border-white/[0.07] pt-9">
            <p className="detail-label">Example</p>
            <p className="mt-4 max-w-2xl text-base italic leading-7 text-white/62">
              “{entry.example_sentence}”
            </p>
          </section>
        )}
      </section>
    </div>
  );
}

function DeleteDialog({
  entry,
  onCancel,
  onConfirm,
}: {
  entry: WordRecord;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => event.key === "Escape" && onCancel();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  async function remove() {
    setIsDeleting(true);
    await onConfirm();
    setIsDeleting(false);
  }

  return (
    <div className="dialog-layer z-[70]" role="presentation">
      <section className="dialog-panel max-w-md" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
        <span className="grid size-11 place-items-center rounded-2xl border border-red-300/10 bg-red-400/10 text-red-300">
          <Trash2 size={19} aria-hidden="true" />
        </span>
        <h2 id="delete-title" className="mt-6 text-2xl font-semibold tracking-[-0.04em] text-white">
          Remove “{entry.word}”?
        </h2>
        <p id="delete-description" className="mt-3 text-sm leading-6 text-white/42">
          This word and its dictionary details will be permanently removed from your box.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} className="secondary-button justify-center">
            Keep word
          </button>
          <button type="button" onClick={() => void remove()} className="danger-button" disabled={isDeleting}>
            {isDeleting ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : null}
            Remove
          </button>
        </div>
      </section>
    </div>
  );
}
