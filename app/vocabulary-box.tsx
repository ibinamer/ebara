"use client";

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Languages,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mic,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
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
import { AppMark } from "./components/AppMark";
import { DashboardStats } from "./components/DashboardStats";
import { DeleteDialog } from "./components/DeleteDialog";
import { Dialog, DialogClose } from "./components/Dialog";
import { EmptyState, type EmptyKind } from "./components/EmptyState";
import { Filters } from "./components/Filters";
import { SettingsDialog } from "./components/SettingsDialog";
import { WordRow } from "./components/WordRow";
import { WordDetailsDialog } from "./components/WordDetailsDialog";
import { WordFacts, WordHeadline } from "./components/WordFacts";
import { StatsSkeleton, WordGridSkeleton } from "./components/Skeletons";
import { useI18n, type Translate } from "@/lib/i18n";
import { capitalize, normalizeCandidate } from "@/lib/speech";
import { createVocabularyClient } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import {
  calculateStats,
  countWordTypes,
  normalizeType,
  sortWords,
  type DictionaryEntry,
  type SortOrder,
  type WordRecord,
} from "@/lib/words";

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

/** One word, or several separated by single spaces — "catch up", "get it". */
const TERM_PATTERN = /^[a-z]+(?:['-][a-z]+)*(?: [a-z]+(?:['-][a-z]+)*)*$/;
const MAX_TERM_WORDS = 6;

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
    part_of_speech: normalized.includes(" ") ? "phrase" : "word",
    example_sentence: "",
  };
}

/**
 * Compact language + theme switches, used only before sign-in. Inside the app
 * both live in Settings, but the auth screen has no Settings dialog — dropping
 * them here would leave an Arabic reader no way to switch language until after
 * they had already signed in.
 */
function QuickControls() {
  const { t, locale, setLocale } = useI18n();
  const { resolved, setPreference } = useTheme();

  return (
    <>
      <button
        type="button"
        onClick={() => setLocale(locale === "en" ? "ar" : "en")}
        className="icon-button"
        aria-label={t("settings.language")}
        title={t("settings.language")}
      >
        <span className="text-[11px] font-bold leading-none">
          {locale === "en" ? "ع" : "EN"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}
        className="icon-button"
        aria-label={t("settings.theme")}
        title={t("settings.theme")}
      >
        {resolved === "dark" ? (
          <Sun size={16} aria-hidden="true" />
        ) : (
          <Moon size={16} aria-hidden="true" />
        )}
      </button>
    </>
  );
}

export default function Ebara({
  supabaseUrl,
  supabaseAnonKey,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  const { t } = useI18n();
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
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [selectedWord, setSelectedWord] = useState<WordRecord | null>(null);
  const [wordToDelete, setWordToDelete] = useState<WordRecord | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      setToast(t("toast.loadError"));
    } else {
      setWords((data ?? []) as WordRecord[]);
    }
    setIsLoadingWords(false);
  }, [demoMode, supabase, t]);

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

  const wordTypes = useMemo(() => countWordTypes(words), [words]);
  const stats = useMemo(() => calculateStats(words), [words]);

  // Derived, so deleting the last word of a type cannot strand the filter.
  const activeType =
    selectedType && wordTypes.some((item) => item.type === selectedType)
      ? selectedType
      : null;

  const filteredWords = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    let result = words;

    if (query) {
      result = result.filter(
        (entry) =>
          entry.word.toLocaleLowerCase().includes(query) ||
          entry.meaning_ar.includes(query),
      );
    }

    if (activeType) {
      result = result.filter(
        (entry) => normalizeType(entry.part_of_speech) === activeType,
      );
    }

    return sortWords(result, sortOrder);
  }, [activeType, searchQuery, sortOrder, words]);

  async function handleLogout() {
    if (guestMode) {
      window.localStorage.removeItem(GUEST_ACTIVE_STORAGE_KEY);
      setGuestMode(false);
      setWords([]);
      return;
    }
    if (demoMode || !supabase) {
      setToast(t("toast.connectSupabase"));
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
      throw new Error(t("add.errDuplicate"));
    }

    if (demoMode || !supabase || !session) {
      const previewWord: WordRecord = {
        ...dictionaryEntry,
        id: `demo-${Date.now()}`,
        user_id: guestMode ? "guest-user" : "demo-user",
        created_at: new Date().toISOString(),
      };
      setWords((current) => [previewWord, ...current]);
      setToast(t("toast.saved", { word: capitalize(previewWord.word) }));
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
      if (error.code === "23505") throw new Error(t("add.errDuplicate"));
      throw new Error(error.message || t("add.errSaveFailed"));
    }

    setWords((current) => [data as WordRecord, ...current]);
    setToast(t("toast.saved", { word: capitalize(dictionaryEntry.word) }));
  }

  async function handleDelete() {
    if (!wordToDelete) return;
    const target = wordToDelete;

    if (!demoMode && supabase && session) {
      const { error } = await supabase.from("words").delete().eq("id", target.id);
      if (error) {
        setToast(t("toast.deleteError"));
        return;
      }
    }

    setWords((current) => current.filter((entry) => entry.id !== target.id));
    setWordToDelete(null);
    if (selectedWord?.id === target.id) setSelectedWord(null);
    setToast(t("toast.removed", { word: capitalize(target.word) }));
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

  const emptyKind: EmptyKind = !words.length
    ? "empty"
    : searchQuery.trim()
      ? "no-results"
      : "no-filter-match";

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="mx-auto flex h-14 max-w-[64rem] items-center justify-between gap-4 px-5 sm:h-16 sm:px-8">
          <div className="flex min-w-0 items-baseline gap-3">
            <AppMark size="sm" />
            {(demoMode || guestMode) && (
              <span className="badge hidden truncate sm:inline">
                {guestMode ? t("header.guest") : t("header.preview")}
              </span>
            )}
          </div>

          <div className="flex items-center gap-0.5">
            <span
              className="badge me-2 hidden not-italic sm:inline"
              style={{ color: "var(--text-faint)" }}
            >
              {session?.user.email ??
                (guestMode ? t("header.guestAccount") : t("header.previewAccount"))}
            </span>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="icon-button"
              aria-label={t("header.settings")}
              title={t("header.settings")}
            >
              <Settings size={16} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="icon-button"
              aria-label={guestMode ? t("header.loginOrCreate") : t("header.logout")}
              title={guestMode ? t("header.loginOrCreate") : t("header.logout")}
            >
              <LogOut size={16} className="flip-rtl" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[64rem] px-5 pb-28 pt-12 sm:px-8 sm:pt-16">
        {/*
          The page opens on the collection itself rather than a title block.
          The heading names the section, the colophon captions it, and the two
          sit on one baseline — the masthead of a page, not a hero.
        */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
          <h1 className="type-heading" style={{ color: "var(--text)" }}>
            {searchQuery.trim() ? t("search.results") : t("search.saved")}
          </h1>
          {isLoadingWords ? <StatsSkeleton /> : <DashboardStats stats={stats} />}
        </div>

        <div className="mt-9 grid gap-x-8 gap-y-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="search-field">
            <Search
              size={16}
              className="shrink-0"
              style={{ color: "var(--text-faint)" }}
              aria-hidden="true"
            />
            <span className="sr-only">{t("search.placeholder")}</span>
            <input
              type="search"
              dir="auto"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("search.placeholder")}
              autoComplete="off"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="icon-button size-7"
                aria-label={t("search.clear")}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </label>

          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="primary-button justify-self-start sm:justify-self-auto"
          >
            {t("add.open")}
          </button>
        </div>

        {words.length > 0 && (
          <div className="mt-7">
            <Filters
              types={wordTypes}
              activeType={activeType}
              onTypeChange={setSelectedType}
              sort={sortOrder}
              onSortChange={setSortOrder}
              totalCount={words.length}
            />
          </div>
        )}

        {/* The one weighted rule on the page: where the glossary begins. */}
        <hr className="rule-accent mt-3" />

        {isLoadingWords ? (
          <WordGridSkeleton />
        ) : filteredWords.length ? (
          <ul className="glossary">
            {filteredWords.map((entry, index) => (
              <WordRow
                key={entry.id}
                entry={entry}
                index={index}
                onOpen={() => setSelectedWord(entry)}
                onDelete={() => setWordToDelete(entry)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            kind={emptyKind}
            query={searchQuery}
            onAdd={() => setAddOpen(true)}
            onClearFilter={() => setSelectedType(null)}
          />
        )}
      </section>

      <footer
        className="type-caption mx-auto max-w-[1180px] border-t px-4 py-7 sm:px-8"
        style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
      >
        <p className="max-w-2xl">
          <FooterCredit t={t} />
        </p>
      </footer>

      {addOpen && (
        <AddWordDialog
          session={session}
          demoMode={demoMode}
          savedWords={words}
          onClose={() => setAddOpen(false)}
          onSave={handleSave}
        />
      )}

      {selectedWord && (
        <WordDetailsDialog
          entry={selectedWord}
          onClose={() => setSelectedWord(null)}
          onDelete={() => setWordToDelete(selectedWord)}
        />
      )}

      {wordToDelete && (
        <DeleteDialog
          entry={wordToDelete}
          onCancel={() => setWordToDelete(null)}
          onConfirm={handleDelete}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          accountEmail={session?.user.email}
          guestMode={guestMode}
          demoMode={demoMode}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <span
            className="grid size-5 shrink-0 place-items-center rounded-full"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            <Check size={12} strokeWidth={3} aria-hidden="true" />
          </span>
          {toast}
        </div>
      )}
    </main>
  );
}

function FooterCredit({ t }: { t: Translate }) {
  const parts = t("footer.credit").split(/(\{dictionary\}|\{wiktionary\})/);

  return (
    <>
      {parts.map((part, index) => {
        if (part === "{dictionary}") {
          return (
            <a
              key={index}
              className="underline underline-offset-2"
              href="https://dictionaryapi.dev/"
              target="_blank"
              rel="noreferrer"
            >
              Free Dictionary API
            </a>
          );
        }
        if (part === "{wiktionary}") {
          return (
            <a
              key={index}
              className="underline underline-offset-2"
              href="https://en.wiktionary.org/"
              target="_blank"
              rel="noreferrer"
            >
              Wiktionary
            </a>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function LoadingScreen() {
  const { t } = useI18n();

  return (
    <main className="app-shell grid place-items-center">
      <div
        className="flex items-center gap-2.5 text-sm"
        style={{ color: "var(--text-muted)" }}
        role="status"
      >
        <LoaderCircle
          size={17}
          className="animate-spin"
          style={{ color: "var(--accent-text)" }}
          aria-hidden="true"
        />
        {t("loading.opening")}
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
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const copy = {
    eyebrow: t(`auth.${mode}.eyebrow`),
    title: t(`auth.${mode}.title`),
    subtitle: t(`auth.${mode}.subtitle`),
    button: t(`auth.${mode}.button`),
  };

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
        setMessage(t("auth.checkInbox"));
      } else if (mode === "forgot") {
        const { error: resetError } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/?reset=1`,
        });
        if (resetError) throw resetError;
        setMessage(t("auth.resetSent"));
      } else {
        if (password.length < 8) throw new Error(t("auth.errShortPassword"));
        if (password !== confirmPassword) throw new Error(t("auth.errMismatch"));
        const { error: updateError } = await client.auth.updateUser({ password });
        if (updateError) throw updateError;
        setMessage(t("auth.passwordUpdated"));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("auth.errGeneric"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="app-shell px-4 py-6 sm:px-8">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-[1180px] flex-col">
        <div className="flex items-center justify-between gap-3">
          <AppMark size="sm" />
          <div className="flex items-center gap-1.5">
            <QuickControls />
            {mode !== "login" && mode !== "update" && (
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="ghost-button ms-1"
              >
                {t("auth.login.button")}
                <ArrowRight size={15} className="flip-rtl" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="grid flex-1 items-center gap-10 py-10 sm:py-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
          <div className="max-w-[600px]">
            <p className="flex items-center gap-2">
              <LockKeyhole size={13} aria-hidden="true" style={{ color: "var(--accent-text)" }} />
              <span className="eyebrow">{t("auth.badge")}</span>
            </p>
            <h1 className="type-display mt-5" style={{ color: "var(--text)" }}>
              {t("auth.heroLine1")}
              <span className="block" style={{ color: "var(--text-faint)" }}>
                {t("auth.heroLine2")}
              </span>
            </h1>
            <p
              className="type-body-lg mt-6 max-w-md"
              style={{ color: "var(--text-muted)" }}
            >
              {t("auth.heroSubtitle")}
            </p>
          </div>

          <div className="panel w-full max-w-[27rem] justify-self-start p-6 sm:p-7 lg:justify-self-end">
            <div className="mb-6">
              <p className="eyebrow">{copy.eyebrow}</p>
              <h2 className="type-heading mt-2" style={{ color: "var(--text)" }}>
                {copy.title}
              </h2>
              <p className="type-body mt-1.5" style={{ color: "var(--text-muted)" }}>
                {copy.subtitle}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {mode !== "update" && (
                <label className="block">
                  <span className="field-label">{t("auth.email")}</span>
                  <input
                    type="email"
                    dir="ltr"
                    className="field-input"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("auth.emailPlaceholder")}
                    autoComplete="email"
                    required
                  />
                </label>
              )}

              {mode !== "forgot" && (
                <label className="block">
                  <span className="field-label">
                    {mode === "update" ? t("auth.newPassword") : t("auth.password")}
                  </span>
                  <input
                    type="password"
                    dir="ltr"
                    className="field-input"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={t("auth.passwordPlaceholder")}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    minLength={8}
                    required
                  />
                </label>
              )}

              {mode === "update" && (
                <label className="block">
                  <span className="field-label">{t("auth.confirmPassword")}</span>
                  <input
                    type="password"
                    dir="ltr"
                    className="field-input"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder={t("auth.confirmPlaceholder")}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </label>
              )}

              {mode === "login" && (
                <div className="flex justify-end">
                  <button type="button" onClick={() => switchMode("forgot")} className="link-button text-sm">
                    {t("auth.forgotLink")}
                  </button>
                </div>
              )}

              {error && (
                <div className="notice error-notice" role="alert">
                  <CircleAlert size={15} className="mt-px shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}
              {message && (
                <div className="notice success-notice" role="status">
                  <Check size={15} className="mt-px shrink-0" aria-hidden="true" />
                  <span>{message}</span>
                </div>
              )}

              <button type="submit" className="primary-button w-full" disabled={isSubmitting}>
                {isSubmitting && (
                  <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
                )}
                {copy.button}
                {!isSubmitting && <ArrowRight size={16} className="flip-rtl" aria-hidden="true" />}
              </button>
            </form>

            {(mode === "login" || mode === "signup") && (
              <div className="mt-5">
                <div
                  className="type-label mb-4 flex items-center gap-3"
                  style={{ color: "var(--text-faint)" }}
                >
                  <span className="h-px flex-1" style={{ background: "var(--border)" }} />
                  {t("auth.or")}
                  <span className="h-px flex-1" style={{ background: "var(--border)" }} />
                </div>
                <button type="button" onClick={onContinueGuest} className="secondary-button w-full">
                  {t("auth.continueGuest")}
                </button>
                <p
                  className="type-caption mt-3 text-center"
                  style={{ color: "var(--text-faint)" }}
                >
                  {t("auth.guestNote")}
                </p>
              </div>
            )}

            {mode === "login" && (
              <p className="mt-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                {t("auth.newHere")}{" "}
                <button type="button" onClick={() => switchMode("signup")} className="link-button">
                  {t("auth.createBox")}
                </button>
              </p>
            )}

            {(mode === "forgot" || mode === "update") && (
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="link-button mt-5 flex items-center gap-2 text-sm"
              >
                <ArrowLeft size={15} className="flip-rtl" aria-hidden="true" />
                {t("auth.backToLogin")}
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function AddWordDialog({
  session,
  demoMode,
  savedWords,
  onClose,
  onSave,
}: {
  session: Session | null;
  demoMode: boolean;
  savedWords: WordRecord[];
  onClose: () => void;
  onSave: (word: DictionaryEntry) => Promise<void>;
}) {
  const { t } = useI18n();
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

  useEffect(() => {
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timeout);
  }, []);

  // Always release the microphone and pending timer when the dialog goes away.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      if (listeningTimeoutRef.current) window.clearTimeout(listeningTimeoutRef.current);
    };
  }, []);

  async function lookupWord(candidate: string) {
    const normalized = normalizeCandidate(candidate);
    if (
      !normalized ||
      normalized.length > 80 ||
      normalized.split(" ").length > MAX_TERM_WORDS ||
      !TERM_PATTERN.test(normalized)
    ) {
      setError(t("add.errOneWord"));
      return;
    }

    const existingWord = savedWords.find(
      (entry) => normalizeCandidate(entry.word) === normalized,
    );
    if (existingWord) {
      setError(t("add.errDuplicate"));
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
          throw new Error(apiMessage || t("add.errNotFound"));
        }
        result = payload.data ?? payload;
      }

      setDraft(result.word);
      setDictionaryEntry(result);
      setStep("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("add.errNotFound"));
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
      setError(t("add.errVoiceUnsupported"));
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
        event.error === "not-allowed" ? t("add.errMicBlocked") : t("add.errVoiceUnclear"),
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
        (item, index, array) =>
          array.findIndex((candidate) => candidate.transcript === item.transcript) === index,
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
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("add.errSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && draft.trim() && !isProcessing) void lookupWord(draft);
  }

  return (
    <Dialog
      onClose={onClose}
      labelledBy="add-word-title"
      className="add-dialog"
      dismissible={!isProcessing && !isSaving}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">
            {step === "capture" ? t("add.eyebrowCapture") : t("add.eyebrowReview")}
          </p>
          {step === "capture" ? (
            <h2
              id="add-word-title"
              className="type-heading mt-2"
              style={{ color: "var(--text)" }}
            >
              {t("add.question")}
            </h2>
          ) : (
            <div className="mt-2">
              <WordHeadline
                id="add-word-title"
                word={dictionaryEntry?.word ?? ""}
                partOfSpeech={dictionaryEntry?.part_of_speech}
                size="md"
              />
            </div>
          )}
        </div>
        <DialogClose label={t("add.close")} onClick={onClose} />
      </div>

      {step === "capture" ? (
        <div className="mt-7">
          <p className="type-body max-w-md" style={{ color: "var(--text-muted)" }}>
            {t("add.hint")}
          </p>

          <div className={`capture-field mt-5 ${isListening ? "is-listening" : ""}`}>
            <input
              ref={inputRef}
              type="text"
              dir="ltr"
              value={draft}
              onChange={(event) => {
                setDraft(normalizeCandidate(event.target.value));
                setVoiceAlternatives([]);
                setError(null);
              }}
              onKeyDown={handleDraftKeyDown}
              placeholder={t("add.placeholder")}
              autoComplete="off"
              spellCheck="false"
              aria-label={t("add.inputLabel")}
            />
            <button
              type="button"
              onClick={isListening ? () => recognitionRef.current?.stop() : startListening}
              className="voice-button"
              aria-label={isListening ? t("add.stopVoice") : t("add.voice")}
            >
              {isListening ? (
                <span className="voice-pulse" aria-hidden="true" />
              ) : (
                <Mic size={18} aria-hidden="true" />
              )}
            </button>
          </div>

          {isListening && (
            <div
              className="mt-3 flex items-center gap-2 text-sm"
              style={{ color: "var(--accent-text)" }}
              role="status"
            >
              <span
                className="size-1.5 animate-pulse rounded-full"
                style={{ background: "currentColor" }}
              />
              {t("add.listening")}
            </div>
          )}

          {voiceAlternatives.length > 1 && (
            <div className="mt-5">
              <p className="type-caption mb-2.5" style={{ color: "var(--text-muted)" }}>
                {t("add.didYouMean")}
              </p>
              <div className="flex flex-wrap gap-2">
                {voiceAlternatives.map((alternative, index) => (
                  <button
                    key={alternative.transcript}
                    type="button"
                    onClick={() => setDraft(alternative.transcript)}
                    className="chip"
                    aria-pressed={draft === alternative.transcript}
                  >
                    <span dir="ltr" className="bidi-isolate">
                      {alternative.transcript}
                    </span>
                    {index === 0 && <span className="chip-count">{t("add.recommended")}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <DialogError message={error} />}

          <div className="mt-7 flex justify-end">
            <button
              type="button"
              onClick={() => void lookupWord(draft)}
              className="primary-button min-w-36"
              disabled={!draft.trim() || isProcessing || isListening}
            >
              {isProcessing ? (
                <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
              ) : (
                <Languages size={16} aria-hidden="true" />
              )}
              {isProcessing ? t("add.lookingUp") : t("add.lookup")}
            </button>
          </div>
        </div>
      ) : dictionaryEntry ? (
        <div className="mt-7">
          <WordFacts entry={dictionaryEntry} />

          {error && <DialogError message={error} />}

          <div className="mt-7 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={() => {
                setStep("capture");
                setError(null);
              }}
              className="secondary-button"
            >
              <ArrowLeft size={15} className="flip-rtl" aria-hidden="true" />
              {t("add.tryAnother")}
            </button>
            <button
              type="button"
              onClick={() => void saveWord()}
              className="primary-button"
              disabled={isSaving}
            >
              {isSaving ? (
                <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus size={17} aria-hidden="true" />
              )}
              {isSaving ? t("add.saving") : t("add.save")}
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function DialogError({ message }: { message: string }) {
  return (
    <div className="notice error-notice mt-4" role="alert">
      <CircleAlert size={15} className="mt-px shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
