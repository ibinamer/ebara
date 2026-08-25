"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppMark } from "./AppMark";
import { useI18n } from "@/lib/i18n";

type LegalSection = {
  title: string;
  paragraphs?: string[];
  items?: string[];
};

type LegalCopy = {
  title: string;
  summary: string;
  updated: string;
  sections: LegalSection[];
};

const privacyCopy: Record<"en" | "ar", LegalCopy> = {
  en: {
    title: "Privacy notice",
    summary: "What EBARA collects, why it is needed, and the choices you have.",
    updated: "Last updated: 25 August 2026",
    sections: [
      {
        title: "Who controls your data",
        paragraphs: [
          "The operator identified below controls the personal data processed by EBARA. EBARA is a personal vocabulary service, not an advertising or social platform.",
        ],
      },
      {
        title: "Data we process",
        items: [
          "Account data: your display name, email address, encrypted authentication credentials, account identifiers, and session information.",
          "Vocabulary data: saved words, expressions or short sentences, Arabic meanings, definitions when available, pronunciation and IPA, part of speech, examples, personal notes, and timestamps.",
          "Technical data needed for security and delivery, such as IP address, browser details, request logs, and rate-limit records.",
          "Guest data: words and language preference stored only in your browser until you clear them or create an account.",
        ],
      },
      {
        title: "Why we process it",
        paragraphs: [
          "We process the minimum data needed to create and secure your account, save and retrieve your private vocabulary, perform dictionary lookups, answer support requests, prevent abuse, and meet legal obligations. Account data is required for cross-device saving; guest use is optional and stays on that device.",
        ],
      },
      {
        title: "Voice input",
        paragraphs: [
          "Voice input uses speech-recognition features provided by your browser or device. EBARA receives the recognized text, not a stored recording, and never saves voice audio in its database. Your browser or operating-system provider may process the audio under its own privacy terms.",
        ],
      },
      {
        title: "Service providers and international processing",
        paragraphs: [
          "Supabase provides authentication and database hosting. The current EBARA database region is Tokyo, Japan, so account and vocabulary data may be processed outside Saudi Arabia. A lookup may send the word, expression, short sentence, or definition and ordinary request metadata to Free Dictionary API, Wikimedia/Wiktionary, Microsoft Azure Translator, Datamuse, or MyMemory as needed. We do not send your email address or your complete library to these providers.",
          "Each provider applies its own terms and privacy notice. EBARA does not sell personal data and does not use your vocabulary for targeted advertising.",
        ],
      },
      {
        title: "Retention and security",
        paragraphs: [
          "Account and vocabulary data are kept while your account remains active, unless a longer period is required by law. Deleting a word removes it from your active library. Deleting your account removes the account and its vocabulary records; backup copies may remain temporarily under the hosting provider’s retention process.",
          "EBARA uses encrypted connections and owner-scoped database rules so signed-in users can access only their own records. No online service can guarantee absolute security.",
        ],
      },
      {
        title: "Your choices and rights",
        items: [
          "Access your saved data inside the app.",
          "Download a commonly readable JSON copy from Settings.",
          "Correct personal notes or delete individual words.",
          "Delete your account and associated vocabulary from Settings.",
          "Ask the operator about access, correction, deletion, or withdrawal of consent using the contact below.",
        ],
      },
      {
        title: "Children",
        paragraphs: [
          "EBARA is not directed to children under 13. A parent or legal guardian should supervise use where local law requires it.",
        ],
      },
      {
        title: "Changes",
        paragraphs: [
          "Material changes will be shown in the service or communicated to account holders when appropriate. The date above identifies the current version.",
        ],
      },
    ],
  },
  ar: {
    title: "إشعار الخصوصية",
    summary: "وش نجمع في EBARA، وليش نحتاجه، والخيارات المتاحة لك.",
    updated: "آخر تحديث: ٢٥ أغسطس ٢٠٢٦",
    sections: [
      {
        title: "جهة التحكم ببياناتك",
        paragraphs: [
          "المشغّل الموضّح أدناه هو جهة التحكم بالبيانات الشخصية التي تعالجها EBARA. الخدمة مكتبة مفردات شخصية، وليست منصة إعلانات أو شبكة اجتماعية.",
        ],
      },
      {
        title: "البيانات اللي نعالجها",
        items: [
          "بيانات الحساب: اسم العرض، بريدك الإلكتروني، بيانات الدخول المشفّرة، معرّفات الحساب، ومعلومات الجلسة.",
          "بيانات المكتبة: الكلمات أو العبارات أو الجمل القصيرة المحفوظة، والمعاني والتعريفات عند توفرها، والنطق والـ IPA، ونوع المدخل، والأمثلة، وملاحظاتك، وتاريخ الإضافة.",
          "بيانات تقنية لازمة للحماية وتشغيل الخدمة، مثل عنوان IP ونوع المتصفح وسجلات الطلبات وحدود الاستخدام.",
          "بيانات الزائر: الكلمات واللغة المختارة محفوظة داخل متصفحك فقط إلى أن تمسحها أو تنشئ حساباً.",
        ],
      },
      {
        title: "ليش نعالجها",
        paragraphs: [
          "نعالج أقل قدر لازم لإنشاء الحساب وحمايته، وحفظ مكتبتك الخاصة واسترجاعها، والبحث في القواميس، والرد على الدعم، ومنع إساءة الاستخدام، والالتزام بالمتطلبات النظامية. الحساب مطلوب للحفظ بين الأجهزة، أما وضع الزائر فاختياري ومحفوظ في نفس الجهاز.",
        ],
      },
      {
        title: "الإدخال الصوتي",
        paragraphs: [
          "الإدخال الصوتي يعتمد على ميزة التعرّف على الكلام في متصفحك أو جهازك. تستقبل EBARA النص الناتج فقط، ولا تحفظ التسجيل الصوتي في قاعدة البيانات. قد يعالج مزوّد المتصفح أو نظام التشغيل الصوت بحسب سياسة الخصوصية الخاصة به.",
        ],
      },
      {
        title: "مقدمو الخدمة والمعالجة خارج المملكة",
        paragraphs: [
          "توفّر Supabase تسجيل الدخول وقاعدة البيانات. منطقة قاعدة بيانات EBARA الحالية في طوكيو باليابان، لذلك قد تُعالج بيانات الحساب والمكتبة خارج المملكة العربية السعودية. وقد ترسل عملية البحث الكلمة أو العبارة أو الجملة القصيرة أو التعريف وبيانات الطلب المعتادة، بحسب الحاجة، إلى Free Dictionary API أو Wikimedia/Wiktionary أو Microsoft Azure Translator أو Datamuse أو MyMemory. ما نرسل بريدك ولا مكتبتك كاملة لهالخدمات.",
          "كل مزوّد يطبّق شروطه وسياسة خصوصيته. EBARA ما تبيع بياناتك الشخصية ولا تستخدم كلماتك للإعلانات الموجّهة.",
        ],
      },
      {
        title: "الاحتفاظ والحماية",
        paragraphs: [
          "نحتفظ ببيانات الحساب والمكتبة طوال بقاء حسابك فعالاً، إلا إذا تطلب النظام مدة أطول. حذف كلمة يزيلها من مكتبتك النشطة. حذف الحساب يزيل الحساب وكلماته، وقد تبقى نسخ مؤقتة في النسخ الاحتياطية بحسب سياسة مزوّد الاستضافة.",
          "تستخدم EBARA اتصالاً مشفّراً وسياسات قاعدة بيانات مرتبطة بصاحب الحساب، بحيث ما يقدر المستخدم المسجّل يشوف إلا بياناته. ما فيه خدمة إلكترونية تقدر تضمن حماية مطلقة.",
        ],
      },
      {
        title: "خياراتك وحقوقك",
        items: [
          "تطّلع على كلماتك المحفوظة داخل التطبيق.",
          "تنزّل نسخة JSON مقروءة من الإعدادات.",
          "تعدّل ملاحظاتك أو تحذف أي كلمة.",
          "تحذف حسابك وكل مكتبته من الإعدادات.",
          "تتواصل مع المشغّل لطلبات الوصول أو التصحيح أو الإتلاف أو العدول عن الموافقة.",
        ],
      },
      {
        title: "الأطفال",
        paragraphs: [
          "الخدمة غير موجّهة للأطفال دون ١٣ سنة، ويلزم إشراف ولي الأمر متى ما تطلّب النظام ذلك.",
        ],
      },
      {
        title: "التعديلات",
        paragraphs: [
          "بنعرض التغييرات الجوهرية داخل الخدمة أو نبلغ أصحاب الحسابات متى كان ذلك مناسباً. التاريخ بالأعلى يوضح النسخة الحالية.",
        ],
      },
    ],
  },
};

const termsCopy: Record<"en" | "ar", LegalCopy> = {
  en: {
    title: "Terms of use",
    summary: "The simple rules for using your personal vocabulary library.",
    updated: "Last updated: 24 August 2026",
    sections: [
      {
        title: "Using EBARA",
        paragraphs: [
          "By creating an account or using EBARA, you agree to these terms and the Privacy Notice. If you do not agree, use guest mode only after reviewing how local storage works, or stop using the service.",
        ],
      },
      {
        title: "The service",
        paragraphs: [
          "EBARA lets you look up English words and keep a private vocabulary library. It is not a certified translation, education, medical, legal, or professional-advice service.",
        ],
      },
      {
        title: "Your account",
        items: [
          "Provide an email address you are allowed to use and keep your password secure.",
          "You are responsible for activity performed through your account.",
          "Tell us promptly if you believe your account has been compromised.",
        ],
      },
      {
        title: "Acceptable use",
        paragraphs: [
          "Do not break the law, access another person’s data, disrupt the service, bypass rate limits, scrape or automate excessive requests, upload harmful material, or misuse dictionary providers. We may limit or suspend abusive use to protect the service and other users.",
        ],
      },
      {
        title: "Your content",
        paragraphs: [
          "You keep ownership of personal notes you add. You give EBARA only the limited permission needed to store, display, back up, and delete that content as part of operating your account. Avoid placing sensitive personal information in notes.",
        ],
      },
      {
        title: "Dictionary data",
        paragraphs: [
          "Definitions, translations, pronunciation, and examples come from third-party dictionary and translation services. Results can be incomplete or wrong. Check an authoritative source before relying on a result for an important decision.",
        ],
      },
      {
        title: "Availability and changes",
        paragraphs: [
          "We aim to keep EBARA fast and available, but do not guarantee uninterrupted operation. Features or providers may change when needed for security, law, reliability, or cost, without changing the service’s core purpose.",
        ],
      },
      {
        title: "Ending use",
        paragraphs: [
          "You may export your data and delete your account in Settings. We may suspend or terminate accounts that materially breach these terms, subject to applicable law.",
        ],
      },
      {
        title: "Liability and governing law",
        paragraphs: [
          "To the extent permitted by law, EBARA is provided as available without guarantees about dictionary accuracy or uninterrupted service. These terms are governed by the laws of the Kingdom of Saudi Arabia, and disputes are subject to its competent courts.",
        ],
      },
    ],
  },
  ar: {
    title: "شروط الاستخدام",
    summary: "القواعد البسيطة لاستخدام مكتبتك الشخصية في EBARA.",
    updated: "آخر تحديث: ٢٤ أغسطس ٢٠٢٦",
    sections: [
      {
        title: "موافقتك على الشروط",
        paragraphs: [
          "بإنشائك حساباً أو استخدامك EBARA، أنت توافق على هذه الشروط وإشعار الخصوصية. إذا ما وافقت عليها، تقدر تستخدم وضع الزائر بعد فهم طريقة الحفظ المحلي، أو تتوقف عن استخدام الخدمة.",
        ],
      },
      {
        title: "الخدمة",
        paragraphs: [
          "EBARA تساعدك تبحث عن كلمات إنجليزية وتحفظها في مكتبة خاصة. الخدمة ليست ترجمة معتمدة ولا تعليماً رسمياً ولا استشارة طبية أو قانونية أو مهنية.",
        ],
      },
      {
        title: "حسابك",
        items: [
          "استخدم بريداً إلكترونياً يحق لك استعماله وحافظ على سرية كلمة المرور.",
          "أنت مسؤول عن النشاط اللي يتم عن طريق حسابك.",
          "بلغنا بسرعة إذا شكّيت أن أحداً دخل حسابك بدون إذنك.",
        ],
      },
      {
        title: "الاستخدام المقبول",
        paragraphs: [
          "لا تستخدم الخدمة لمخالفة النظام أو الوصول لبيانات غيرك أو تعطيلها أو تجاوز حدود الطلبات أو تشغيل طلبات آلية مفرطة أو رفع محتوى ضار أو إساءة استخدام مزوّدي القواميس. يحق لنا تقييد الاستخدام المسيء أو إيقافه لحماية الخدمة والمستخدمين.",
        ],
      },
      {
        title: "محتواك",
        paragraphs: [
          "تبقى ملاحظاتك ملكك، وتمنح EBARA فقط الإذن المحدود اللازم لحفظها وعرضها ونسخها احتياطياً وحذفها ضمن تشغيل حسابك. لا تضع بيانات شخصية حساسة في الملاحظات.",
        ],
      },
      {
        title: "بيانات القاموس",
        paragraphs: [
          "التعريفات والترجمات والنطق والأمثلة تجي من خدمات قواميس وترجمة خارجية، وقد تكون ناقصة أو غير دقيقة. ارجع لمصدر موثوق قبل الاعتماد على النتيجة في قرار مهم.",
        ],
      },
      {
        title: "التوفر والتغييرات",
        paragraphs: [
          "نسعى إن EBARA تظل سريعة ومتاحة، لكن ما نضمن عملها بدون انقطاع. قد تتغير بعض الميزات أو المزوّدين لأسباب تتعلق بالحماية أو النظام أو الاعتمادية أو التكلفة، بدون تغيير هدف الخدمة الأساسي.",
        ],
      },
      {
        title: "إنهاء الاستخدام",
        paragraphs: [
          "تقدر تصدّر بياناتك وتحذف حسابك من الإعدادات. وقد نوقف الحسابات اللي تخالف الشروط بشكل جوهري، مع مراعاة الأنظمة السارية.",
        ],
      },
      {
        title: "المسؤولية والنظام المطبق",
        paragraphs: [
          "في حدود ما يسمح به النظام، تُقدّم EBARA كما هي ومتاحة بدون ضمان دقة بيانات القاموس أو استمرار الخدمة دون انقطاع. تخضع هذه الشروط لأنظمة المملكة العربية السعودية، وتختص محاكمها المختصة بأي نزاع.",
        ],
      },
    ],
  },
};

export function LegalPage({
  kind,
  operatorName,
  contactEmail,
}: {
  kind: "privacy" | "terms";
  operatorName: string;
  contactEmail: string;
}) {
  const { locale, setLocale } = useI18n();
  const copy = (kind === "privacy" ? privacyCopy : termsCopy)[locale];
  const contactMissing = !contactEmail;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="mx-auto flex h-14 max-w-[64rem] items-center justify-between gap-4 px-5 sm:h-16 sm:px-8">
          <Link href="/" aria-label={locale === "ar" ? "العودة للرئيسية" : "Back to home"}>
            <AppMark size="sm" />
          </Link>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLocale(locale === "en" ? "ar" : "en")}
              className="icon-button"
              aria-label={locale === "ar" ? "English" : "العربية"}
            >
              <span className="text-[11px] font-bold leading-none">
                {locale === "en" ? "ع" : "EN"}
              </span>
            </button>
            <Link href="/" className="ghost-button">
              <ArrowLeft size={15} className="flip-rtl" aria-hidden="true" />
              {locale === "ar" ? "العودة" : "Back"}
            </Link>
          </div>
        </div>
      </header>

      <article className="legal-document mx-auto max-w-[48rem] px-5 py-12 sm:px-8 sm:py-16">
        <p className="eyebrow">EBARA</p>
        <h1 className="type-title mt-3">{copy.title}</h1>
        <p className="type-body-lg mt-4" style={{ color: "var(--text-muted)" }}>
          {copy.summary}
        </p>
        <p className="type-caption mt-3" style={{ color: "var(--text-faint)" }}>
          {copy.updated}
        </p>

        <div className="mt-12 space-y-10">
          {copy.sections.map((section) => (
            <section key={section.title}>
              <h2 className="type-subheading">{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="type-body mt-3" style={{ color: "var(--text-muted)" }}>
                  {paragraph}
                </p>
              ))}
              {section.items && (
                <ul className="mt-3 list-disc space-y-2 ps-5 type-body" style={{ color: "var(--text-muted)" }}>
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </section>
          ))}
        </div>

        <section className="mt-12 border-t pt-8" style={{ borderColor: "var(--border)" }}>
          <h2 className="type-subheading">{locale === "ar" ? "التواصل" : "Contact"}</h2>
          <p className="type-body mt-3" style={{ color: "var(--text-muted)" }}>
            {locale === "ar" ? "المشغّل: " : "Operator: "}<strong>{operatorName}</strong>
          </p>
          {contactMissing ? (
            <p className="notice error-notice mt-3">
              {locale === "ar"
                ? "يجب إضافة بريد الخصوصية قبل إطلاق الخدمة للعامة."
                : "A privacy contact email must be configured before public launch."}
            </p>
          ) : (
            <a className="link-button mt-2 inline-block" href={`mailto:${contactEmail}`} dir="ltr">
              {contactEmail}
            </a>
          )}
        </section>

        <nav className="mt-10 flex flex-wrap gap-4 border-t pt-7 type-caption" style={{ borderColor: "var(--border)" }}>
          <Link className="link-button" href="/privacy">
            {locale === "ar" ? "الخصوصية" : "Privacy"}
          </Link>
          <Link className="link-button" href="/terms">
            {locale === "ar" ? "الشروط" : "Terms"}
          </Link>
        </nav>
      </article>
    </main>
  );
}
