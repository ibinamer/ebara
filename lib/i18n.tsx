"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

export type Locale = "en" | "ar";

export const LOCALE_STORAGE_KEY = "ebara:locale";

const en = {
  "app.name": "EBARA",

  "auth.badge": "Private by default",
  "auth.heroLine1": "Every word.",
  "auth.heroLine2": "Never lost.",

  "demo.caption":
    "A short preview: saved English words shown with their Arabic meanings, then a new word being looked up and added to the collection.",
  "auth.heroSubtitle":
    "A calm, personal vault for every English word you learn—and nothing you don’t need.",
  "auth.login.eyebrow": "Welcome back",
  "auth.login.title": "Open your box.",
  "auth.login.subtitle": "Your words are right where you left them.",
  "auth.login.button": "Log in",
  "auth.signup.eyebrow": "A home for every word",
  "auth.signup.title": "Create your box.",
  "auth.signup.subtitle": "One quiet place for every English word you learn.",
  "auth.signup.button": "Create account",
  "auth.forgot.eyebrow": "Password reset",
  "auth.forgot.title": "Find your way back.",
  "auth.forgot.subtitle": "We’ll email you a secure link to reset your password.",
  "auth.forgot.button": "Send reset link",
  "auth.update.eyebrow": "Choose a new password",
  "auth.update.title": "Secure your box.",
  "auth.update.subtitle": "Use at least eight characters for your new password.",
  "auth.update.button": "Update password",
  "auth.email": "Email",
  "auth.emailPlaceholder": "you@example.com",
  "auth.password": "Password",
  "auth.newPassword": "New password",
  "auth.confirmPassword": "Confirm password",
  "auth.passwordPlaceholder": "At least 8 characters",
  "auth.confirmPlaceholder": "Repeat your new password",
  "auth.forgotLink": "Forgot password?",
  "auth.or": "or",
  "auth.continueGuest": "Continue without an account",
  "auth.guestNote":
    "Your words stay on this device. Create an account later to sync across devices.",
  "auth.newHere": "New here?",
  "auth.createBox": "Create your box",
  "auth.backToLogin": "Back to login",
  "auth.checkInbox": "Check your inbox to confirm your account, then come back to log in.",
  "auth.resetSent": "Reset link sent. Check your inbox.",
  "auth.passwordUpdated": "Password updated. Your box is secure.",
  "auth.errShortPassword": "Use at least eight characters.",
  "auth.errMismatch": "Passwords do not match.",
  "auth.errGeneric": "Something went wrong. Please try again.",

  "header.guest": "Guest · saved on this device",
  "header.preview": "Preview",
  "header.logout": "Log out",
  "header.loginOrCreate": "Log in or create account",
  "header.settings": "Settings",
  "header.guestAccount": "Guest account",
  "header.previewAccount": "Preview account",

  "dash.eyebrow": "Your private word collection",
  "dash.titleLine1": "My",
  "dash.titleLine2": "EBARA.",

  "stats.total": "Words saved",
  "stats.week": "Added this week",
  "stats.streak": "Day streak",
  "stats.streakHint": "Days in a row you saved a word",

  "search.placeholder": "Search words or Arabic meanings",
  "search.clear": "Clear search",
  "search.results": "Search results",
  "search.saved": "Saved words",
  "search.match": "match",
  "search.matches": "matches",

  "filter.sort": "Sort",
  "filter.newest": "Newest first",
  "filter.oldest": "Oldest first",
  "filter.alphabetical": "A–Z",

  "word.pronunciation": "Pronunciation",
  "word.ipa": "IPA",
  "word.arabic": "Arabic meaning",
  "word.definition": "Definition",
  "word.type": "Word type",
  "word.added": "Added",
  "word.pronounce": "Pronounce {word}",
  "word.delete": "Delete {word}",
  "word.closeDetails": "Close word details",
  "word.notes": "Notes",
  "word.notesPlaceholder": "Where did you hear it? Anything you want to remember…",
  "word.saveNote": "Save note",
  "word.notesSaveError": "Couldn't save your note. Please try again.",

  "pos.noun": "Noun",
  "pos.verb": "Verb",
  "pos.adjective": "Adjective",
  "pos.adverb": "Adverb",
  "pos.pronoun": "Pronoun",
  "pos.preposition": "Preposition",
  "pos.conjunction": "Conjunction",
  "pos.interjection": "Interjection",
  "pos.determiner": "Determiner",
  "pos.article": "Article",
  "pos.numeral": "Numeral",
  "pos.exclamation": "Exclamation",
  "pos.phrase": "Phrase",
  "pos.word": "Word",

  "add.open": "Add word",
  "add.eyebrowCapture": "A new word",
  "add.eyebrowReview": "Word ready",
  "add.question": "What did you learn?",
  "add.hint":
    "Type an English word or phrase, or say it out loud. We’ll find its meaning and definition.",
  "add.placeholder": "Type a word or phrase",
  "add.inputLabel": "English word or phrase",
  "add.voice": "Add word by voice",
  "add.stopVoice": "Stop listening",
  "add.listening": "Listening… say a word or short phrase",
  "add.didYouMean": "Did you mean?",
  "add.recommended": "Recommended",
  "add.lookup": "Look up word",
  "add.lookingUp": "Looking up…",
  "add.save": "Save to my box",
  "add.saving": "Saving…",
  "add.tryAnother": "Try another",
  "add.close": "Close add word",
  "add.errOneWord": "Enter an English word or short phrase.",
  "add.errDuplicate": "This is already in your box.",
  "add.errNotFound": "We couldn’t find that word or phrase.",
  "add.errVoiceUnsupported":
    "Voice input isn’t supported in this browser. You can still type the word.",
  "add.errMicBlocked":
    "Microphone access was blocked. Allow it in your browser, then try again.",
  "add.errVoiceUnclear": "I couldn’t hear that clearly. Try once more or type the word.",
  "add.errSaveFailed": "We couldn’t save this word.",

  "empty.readyTitle": "Your box is ready",
  "empty.readyBody": "Save the first word you want to remember. It only takes a moment.",
  "empty.addFirst": "Add your first word",
  "empty.noResultsTitle": "No words found",
  "empty.noResultsBody": "Nothing matches “{query}”. Try another word or Arabic meaning.",

  "delete.title": "Remove “{word}”?",
  "delete.body":
    "This word and its dictionary details will be permanently removed from your box.",
  "delete.keep": "Keep word",
  "delete.confirm": "Remove",

  "toast.saved": "{word} is safe in your box.",
  "toast.removed": "{word} was removed.",
  "toast.loadError": "We couldn’t load your words. Please try again.",
  "toast.deleteError": "We couldn’t delete this word. Please try again.",
  "toast.connectSupabase": "Connect Supabase to enable private accounts.",

  "settings.title": "Settings",
  "settings.subtitle": "Choose how EBARA reads.",
  "settings.language": "Language",
  "settings.account": "Account",
  "settings.signedInAs": "Signed in as",
  "settings.guestMode": "Guest · words saved on this device only",
  "settings.previewMode": "Preview · connect Supabase to save words",
  "settings.close": "Close settings",

  "loading.opening": "Opening your box…",
  "loading.words": "Loading words",

  "footer.credit": "Dictionary data from {dictionary} and Arabic meanings from {wiktionary} (CC BY-SA).",
} as const;

export type TranslationKey = keyof typeof en;

type Dictionary = Record<TranslationKey, string>;

/**
 * Saudi Arabic, not Modern Standard Arabic and not a literal translation of the
 * English. Interface labels stay short and clean; conversational wording is
 * used where the app is talking to the learner. The learner's collection is
 * always "مكتبتك" — never "مجموعتك" or a literal "صندوق".
 */
const ar: Dictionary = {
  "app.name": "EBARA",

  "auth.badge": "خصوصيتك أولاً",
  "auth.heroLine1": "كل كلمة",
  "auth.heroLine2": "ما تضيع أبد.",

  "demo.caption":
    "عرض سريع: كلمات إنجليزية محفوظة مع معانيها بالعربي، وبعدين كلمة جديدة ندوّر عليها وتنحفظ بالمكتبة.",
  "auth.heroSubtitle":
    "مكتبة بسيطة وخاصة فيك، تجمع كل كلمة إنجليزية تتعلمها — بدون أي زيادة ما تحتاجها.",
  "auth.login.eyebrow": "حياك الله",
  "auth.login.title": "افتح مكتبتك.",
  "auth.login.subtitle": "كلماتك بانتظارك، مثل ما تركتها.",
  "auth.login.button": "تسجيل الدخول",
  "auth.signup.eyebrow": "مكان لكل كلمة",
  "auth.signup.title": "ابدأ مكتبتك.",
  "auth.signup.subtitle": "مكان واحد يجمع كل كلمة إنجليزية تتعلمها.",
  "auth.signup.button": "إنشاء حساب",
  "auth.forgot.eyebrow": "استعادة كلمة المرور",
  "auth.forgot.title": "نرجّعك لمكتبتك.",
  "auth.forgot.subtitle": "بنرسل لك رابط آمن تغيّر منه كلمة المرور.",
  "auth.forgot.button": "أرسل الرابط",
  "auth.update.eyebrow": "كلمة مرور جديدة",
  "auth.update.title": "أمّن حسابك.",
  "auth.update.subtitle": "اختر كلمة مرور من ٨ أحرف على الأقل.",
  "auth.update.button": "تحديث كلمة المرور",
  "auth.email": "البريد الإلكتروني",
  "auth.emailPlaceholder": "you@example.com",
  "auth.password": "كلمة المرور",
  "auth.newPassword": "كلمة المرور الجديدة",
  "auth.confirmPassword": "تأكيد كلمة المرور",
  "auth.passwordPlaceholder": "٨ أحرف على الأقل",
  "auth.confirmPlaceholder": "أعد كتابة كلمة المرور",
  "auth.forgotLink": "نسيت كلمة المرور؟",
  "auth.or": "أو",
  "auth.continueGuest": "ادخل بدون حساب",
  "auth.guestNote":
    "كلماتك بتنحفظ على هذا الجهاز. تقدر تسوي حساب بعدين وتزامنها على بقية أجهزتك.",
  "auth.newHere": "أول مرة معنا؟",
  "auth.createBox": "أنشئ مكتبتك",
  "auth.backToLogin": "رجوع لتسجيل الدخول",
  "auth.checkInbox": "راجع بريدك عشان تأكد حسابك، وبعدها ارجع سجّل دخولك.",
  "auth.resetSent": "أرسلنا لك الرابط. راجع بريدك.",
  "auth.passwordUpdated": "تم تحديث كلمة المرور.",
  "auth.errShortPassword": "كلمة المرور لازم ٨ أحرف على الأقل.",
  "auth.errMismatch": "كلمتا المرور غير متطابقتين.",
  "auth.errGeneric": "صار خطأ. جرّب مرة ثانية.",

  "header.guest": "زائر · محفوظة بهذا الجهاز",
  "header.preview": "معاينة",
  "header.logout": "تسجيل الخروج",
  "header.loginOrCreate": "سجّل دخولك أو أنشئ حساب",
  "header.settings": "الإعدادات",
  "header.guestAccount": "حساب زائر",
  "header.previewAccount": "حساب معاينة",

  "dash.eyebrow": "مكتبتك الخاصة",
  "dash.titleLine1": "مكتبتي في",
  "dash.titleLine2": "EBARA.",

  "stats.total": "كلمة محفوظة",
  "stats.week": "أضفتها هالأسبوع",
  "stats.streak": "أيام متتالية",
  "stats.streakHint": "عدد الأيام اللي أضفت فيها كلمة ورا بعض",

  "search.placeholder": "دوّر على كلمة أو معناها بالعربي",
  "search.clear": "مسح البحث",
  "search.results": "نتائج البحث",
  "search.saved": "كلماتك المحفوظة",
  "search.match": "نتيجة",
  "search.matches": "نتيجة",

  "filter.sort": "الترتيب",
  "filter.newest": "الأحدث أولاً",
  "filter.oldest": "الأقدم أولاً",
  "filter.alphabetical": "أبجدياً",

  "word.pronunciation": "النطق",
  "word.ipa": "الرموز الصوتية",
  "word.arabic": "المعنى بالعربي",
  "word.definition": "التعريف",
  "word.type": "نوع الكلمة",
  "word.added": "أضفتها في",
  "word.pronounce": "استمع لنطق {word}",
  "word.delete": "احذف {word}",
  "word.closeDetails": "إغلاق",
  "word.notes": "ملاحظات",
  "word.notesPlaceholder": "وين سمعتها؟ أو أي شي تبي تتذكره…",
  "word.saveNote": "احفظ الملاحظة",
  "word.notesSaveError": "ما قدرنا نحفظ ملاحظتك. حاول مرة ثانية.",

  "pos.noun": "اسم",
  "pos.verb": "فعل",
  "pos.adjective": "صفة",
  "pos.adverb": "ظرف",
  "pos.pronoun": "ضمير",
  "pos.preposition": "حرف جر",
  "pos.conjunction": "حرف عطف",
  "pos.interjection": "أداة تعجب",
  "pos.determiner": "أداة تخصيص",
  "pos.article": "أداة تعريف",
  "pos.numeral": "عدد",
  "pos.exclamation": "تعجب",
  "pos.phrase": "عبارة",
  "pos.word": "كلمة",

  "add.open": "أضف كلمة",
  "add.eyebrowCapture": "كلمة جديدة",
  "add.eyebrowReview": "الكلمة جاهزة",
  "add.question": "وش تعلمت اليوم؟",
  "add.hint": "اكتب كلمة أو عبارة إنجليزية أو انطقها، وبنجيب لك معناها وتعريفها.",
  "add.placeholder": "اكتب كلمة أو عبارة",
  "add.inputLabel": "كلمة أو عبارة إنجليزية",
  "add.voice": "أضف كلمة بصوتك",
  "add.stopVoice": "إيقاف الاستماع",
  "add.listening": "نسمعك… قل كلمة أو عبارة قصيرة",
  "add.didYouMean": "تقصد؟",
  "add.recommended": "الأقرب",
  "add.lookup": "دوّر عليها",
  "add.lookingUp": "ندوّر…",
  "add.save": "احفظها بمكتبتي",
  "add.saving": "نحفظ…",
  "add.tryAnother": "جرّب كلمة ثانية",
  "add.close": "إغلاق",
  "add.errOneWord": "اكتب كلمة أو عبارة إنجليزية قصيرة.",
  "add.errDuplicate": "هذي عندك من قبل.",
  "add.errNotFound": "ما لقينا هالكلمة أو العبارة.",
  "add.errVoiceUnsupported":
    "الإدخال الصوتي ما يشتغل بهذا المتصفح، بس تقدر تكتب الكلمة.",
  "add.errMicBlocked": "المايك محظور. اسمح له من إعدادات المتصفح وجرّب مرة ثانية.",
  "add.errVoiceUnclear": "ما سمعناها زين. جرّب مرة ثانية أو اكتبها.",
  "add.errSaveFailed": "ما قدرنا نحفظ الكلمة.",

  "empty.readyTitle": "مكتبتك جاهزة",
  "empty.readyBody": "يلا أضف أول كلمة تبي تحفظها، ما تاخذ منك دقيقة.",
  "empty.addFirst": "أضف أول كلمة",
  "empty.noResultsTitle": "ما لقينا شيء",
  "empty.noResultsBody": "ما لقينا كلمات تطابق «{query}». جرّب كلمة أو معنى ثاني.",

  "delete.title": "متأكد إنك تبي تحذف «{word}»؟",
  "delete.body": "بتنحذف الكلمة وكل تفاصيلها من مكتبتك نهائياً.",
  "delete.keep": "لا، خلّها",
  "delete.confirm": "احذف",

  "toast.saved": "تمت إضافة {word} لمكتبتك.",
  "toast.removed": "تم حذف {word}.",
  "toast.loadError": "ما قدرنا نحمّل كلماتك. جرّب مرة ثانية.",
  "toast.deleteError": "ما قدرنا نحذف الكلمة. جرّب مرة ثانية.",
  "toast.connectSupabase": "اربط Supabase عشان تفعّل الحسابات الخاصة.",

  "settings.title": "الإعدادات",
  "settings.subtitle": "خلّ EBARA يقرأ بلغتك.",
  "settings.language": "اللغة",
  "settings.account": "الحساب",
  "settings.signedInAs": "مسجّل دخولك بـ",
  "settings.guestMode": "زائر · كلماتك محفوظة بهذا الجهاز فقط",
  "settings.previewMode": "معاينة · اربط Supabase عشان تحفظ كلماتك",
  "settings.close": "إغلاق",

  "loading.opening": "نفتح مكتبتك…",
  "loading.words": "نحمّل الكلمات",

  "footer.credit": "بيانات القاموس من {dictionary} والمعاني العربية من {wiktionary} (CC BY-SA).",
};

const dictionaries: Record<Locale, Dictionary> = { en, ar };

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ar";
}

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export type Translate = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

type I18nValue = {
  locale: Locale;
  dir: "ltr" | "rtl";
  isRtl: boolean;
  setLocale: (locale: Locale) => void;
  t: Translate;
};

const I18nContext = createContext<I18nValue | null>(null);

/**
 * The stored locale is external browser state, so it is read through
 * `useSyncExternalStore`. The server snapshot is always English, which matches
 * the pre-paint bootstrap script and keeps hydration stable.
 */
const localeListeners = new Set<() => void>();

function subscribeLocale(onChange: () => void) {
  localeListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    localeListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : "en";
  } catch {
    return "en";
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, readStoredLocale, () => "en" as Locale);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Ignore write failures; the choice still applies for this session.
    }
    localeListeners.forEach((listener) => listener());
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => interpolate(dictionaries[locale][key] ?? key, vars),
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      dir: locale === "ar" ? "rtl" : "ltr",
      isRtl: locale === "ar",
      setLocale,
      t,
    }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

/** Translates a dictionary part of speech, falling back to the raw value. */
export function translatePartOfSpeech(t: Translate, partOfSpeech: string): string {
  const key = `pos.${partOfSpeech.trim().toLowerCase()}` as TranslationKey;
  const translated = t(key);
  return translated === key ? partOfSpeech : translated;
}

export function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US").format(value);
}
