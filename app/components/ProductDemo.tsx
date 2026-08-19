"use client";

import { Mic } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { stagger, useAnimate, useReducedMotion } from "motion/react";
import { AppMark } from "./AppMark";
import { WordHeadline } from "./WordFacts";
import { translatePartOfSpeech, useI18n } from "@/lib/i18n";

/**
 * A fourteen-second explainer for the sign-in screen, the one surface a
 * visitor sees before they have an account.
 *
 * It is built from the product's own parts — `AppMark`, `WordHeadline`, the
 * real `.list-panel` / `.word-row` / `.capture-field` / `.primary-button`
 * classes — rather than a drawing of them, so it can never drift from what
 * the app actually looks like. The vocabulary shown is the same vetted
 * preview data the app already ships; nothing here is invented.
 *
 * Motion drives the choreography as one absolute-timed sequence, which keeps
 * the whole run auditable against the fifteen-second budget. It plays once,
 * on entering the viewport, and rests on the wordmark.
 */

const TERM = "serendipity";

const COLLECTION = [
  { word: "gentle", pos: "adjective", meaning: "لطيف، رقيق" },
  { word: "subtle", pos: "adjective", meaning: "دقيق، غير واضح" },
  { word: "perseverance", pos: "noun", meaning: "المثابرة" },
];

const SAVED = [
  { word: TERM, pos: "noun", meaning: "صدفة سعيدة" },
  COLLECTION[0],
  COLLECTION[1],
];

/* Apple's motion is fast out, slow to settle: expo-out for arrivals. */
const ARRIVE = [0.16, 1, 0.3, 1] as const;
const DEPART = [0.4, 0, 1, 1] as const;

/* Hydration flag read as external state, the same pattern `lib/i18n.tsx`
   uses, so nothing calls setState synchronously inside an effect. */
const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

function DemoRow({
  word,
  pos,
  meaning,
  className = "",
}: {
  word: string;
  pos: string;
  meaning: string;
  className?: string;
}) {
  const { t } = useI18n();

  return (
    <li className={`word-row ${className}`.trim()}>
      <div className="word-row-open">
        <span className="min-w-0">
          <span dir="ltr" className="word-term bidi-isolate">
            {word}
          </span>{" "}
          <span className="word-pos">{translatePartOfSpeech(t, pos)}</span>
        </span>
        <span lang="ar" dir="rtl" className="word-gloss bidi-isolate text-ui-start">
          {meaning}
        </span>
      </div>
    </li>
  );
}

export function ProductDemo() {
  const { t } = useI18n();
  const [scope, animate] = useAnimate();
  const figureRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const mounted = useSyncExternalStore(subscribeNothing, onClient, onServer);
  const [visible, setVisible] = useState(false);
  // Distinct from `visible`: once true it stays true, and it is what flips the
  // stage out of its poster frame. Without it a demo sitting below the fold
  // would show an empty box — Motion pre-applies the sequence's opening
  // keyframes (everything hidden) the moment it is created.
  const [started, setStarted] = useState(false);
  const controlsRef = useRef<{ play: () => void; pause: () => void } | null>(null);

  // The loop is suspended whenever the stage leaves the viewport, so a demo
  // that runs forever never burns frames off screen.
  useEffect(() => {
    const node = figureRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      // No observer to lean on: start on the next frame rather than
      // synchronously, which would cascade a render out of this effect.
      const frame = requestAnimationFrame(() => {
        setVisible(true);
        setStarted(true);
      });
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const onScreen = entries.some((entry) => entry.isIntersecting);
        setVisible(onScreen);
        if (onScreen) setStarted(true);
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mounted || reduced || !started) return;

    const controls = animate([
      // Each pass starts from a clean slate. Every other element is restored
      // by its own `[from, to]` entrance; this is the one the sequence leaves
      // hidden without one.
      [".demo-capture-step", { opacity: 1, y: 0 }, { duration: 0, at: 0 }],

      /* 0.0–2.9s · the mark ------------------------------------------- */
      [
        ".demo-mark-intro",
        { opacity: [0, 1], scale: [0.94, 1], y: [10, 0], filter: ["blur(8px)", "blur(0px)"] },
        // Starts at zero so the poster hands straight over to the mark with
        // no blank frame in between.
        { duration: 0.8, at: 0, ease: ARRIVE },
      ],
      [
        ".demo-mark-intro",
        { opacity: 0, scale: 1.03, y: -8, filter: "blur(6px)" },
        { duration: 0.5, at: 2.35, ease: DEPART },
      ],

      /* 2.9–6.8s · what the product holds ------------------------------ */
      [
        ".demo-scene-list",
        { opacity: [0, 1], scale: [0.965, 1], y: [18, 0] },
        { type: "spring", duration: 0.75, bounce: 0.18, at: 2.85 },
      ],
      [
        ".demo-list-row",
        { opacity: [0, 1], y: [12, 0] },
        { duration: 0.5, at: 3.2, delay: stagger(0.11), ease: ARRIVE },
      ],
      [
        ".demo-scene-list",
        { opacity: 0, scale: 0.985, y: -12 },
        { duration: 0.5, at: 6.3, ease: DEPART },
      ],

      /* 6.8–11.0s · how a word gets in --------------------------------- */
      [
        ".demo-scene-add",
        { opacity: [0, 1], scale: [0.965, 1], y: [18, 0] },
        { type: "spring", duration: 0.7, bounce: 0.18, at: 6.85 },
      ],
      [
        ".demo-capture",
        { borderColor: "var(--accent)", boxShadow: "0 0 0 4px var(--ring)" },
        { duration: 0.35, at: 7.45, ease: ARRIVE },
      ],
      // Characters land one after another rather than fading in together —
      // the tiny blur reads as ink settling, not as a wipe.
      [
        ".demo-char",
        { opacity: [0, 1], filter: ["blur(3px)", "blur(0px)"] },
        { duration: 0.14, at: 7.6, delay: stagger(0.085) },
      ],
      [
        ".demo-lookup",
        { scale: [1, 0.97, 1] },
        { duration: 0.34, at: 8.85, ease: "easeInOut" },
      ],
      [
        ".demo-capture-step",
        { opacity: 0, y: -10 },
        { duration: 0.35, at: 9.05, ease: DEPART },
      ],
      [
        ".demo-result",
        { opacity: [0, 1], scale: [0.97, 1], y: [16, 0] },
        { type: "spring", duration: 0.75, bounce: 0.16, at: 9.2 },
      ],
      [
        ".demo-scene-add",
        { opacity: 0, scale: 0.985, y: -12 },
        { duration: 0.5, at: 10.5, ease: DEPART },
      ],

      /* 11.0–13.4s · where it lands ------------------------------------ */
      [
        ".demo-scene-saved",
        { opacity: [0, 1], scale: [0.965, 1], y: [18, 0] },
        { type: "spring", duration: 0.75, bounce: 0.18, at: 10.95 },
      ],
      [
        ".demo-new-row",
        { opacity: [0, 1], y: [-14, 0] },
        { type: "spring", duration: 0.7, bounce: 0.22, at: 11.5 },
      ],
      // A single settling tint, the accent at its softest, then gone.
      [
        ".demo-new-row",
        { backgroundColor: ["rgba(5, 120, 255, 0.1)", "rgba(5, 120, 255, 0)"] },
        { duration: 1.5, at: 11.7, ease: DEPART },
      ],
      [
        ".demo-scene-saved",
        { opacity: 0, scale: 0.99 },
        { duration: 0.45, at: 13.0, ease: DEPART },
      ],

      /* 13.4–14.1s · rest on the mark ---------------------------------- */
      [
        ".demo-mark-outro",
        { opacity: [0, 1], scale: [0.96, 1], filter: ["blur(6px)", "blur(0px)"] },
        { duration: 0.7, at: 13.45, ease: ARRIVE },
      ],
    ], {
      // The mark holds for a beat before the next pass, so the loop reads as
      // a considered rest rather than a hard cut. One pass lands at 15s.
      repeat: Infinity,
      repeatDelay: 0.85,
    });

    controlsRef.current = controls;
    return () => {
      controls.stop();
      controlsRef.current = null;
    };
  }, [animate, mounted, reduced, started]);

  // Runs after the effect above on the same commit, so newly created controls
  // are paused immediately if the stage has already scrolled back out of view.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (visible) controls.play();
    else controls.pause();
  }, [mounted, reduced, started, visible]);

  // The poster frame — the product's real end state — holds on the server,
  // under reduced motion, and until the sequence actually begins.
  const mode = mounted && !reduced && started ? "animate" : "static";

  return (
    <figure ref={figureRef} className="demo-figure">
      <div ref={scope} className="demo-stage" data-mode={mode} aria-hidden="true">
        {/* 1 — the mark */}
        <div className="demo-scene demo-scene-center demo-mark-intro">
          <AppMark />
        </div>

        {/* 2 — a collection of words, each with its Arabic meaning */}
        <div className="demo-scene demo-scene-list">
          <div className="list-panel">
            <ul className="glossary">
              {COLLECTION.map((entry) => (
                <DemoRow key={entry.word} {...entry} className="demo-list-row" />
              ))}
            </ul>
          </div>
        </div>

        {/*
          3 — adding one. The real dialog swaps its capture step for a review
          step rather than stacking them, so the demo does the same: the two
          share one slot and cross-fade in place.
        */}
        <div className="demo-scene demo-scene-add">
          <div className="demo-swap">
            <div className="demo-capture-step">
              <p className="eyebrow">{t("add.eyebrowCapture")}</p>
              <div className="capture-field demo-capture mt-3">
                <span dir="ltr" className="demo-typed bidi-isolate">
                  {TERM.split("").map((character, index) => (
                    <span key={`${character}-${index}`} className="demo-char">
                      {character}
                    </span>
                  ))}
                </span>
                <span className="demo-mic" aria-hidden="true">
                  <Mic size={15} />
                </span>
              </div>
              <span className="primary-button demo-lookup mt-3.5 self-start">
                {t("add.lookup")}
              </span>
            </div>

            <div className="demo-result">
              <p className="eyebrow">{t("add.eyebrowReview")}</p>
              <div className="mt-2">
                <WordHeadline word={TERM} partOfSpeech="noun" size="md" />
              </div>
              <p
                lang="ar"
                dir="rtl"
                className="word-gloss bidi-isolate text-ui-start mt-2"
              >
                {SAVED[0].meaning}
              </p>
            </div>
          </div>
        </div>

        {/* 4 — saved, and there for good */}
        <div className="demo-scene demo-scene-saved">
          <div className="list-panel">
            <ul className="glossary">
              {SAVED.map((entry, index) => (
                <DemoRow
                  key={entry.word}
                  {...entry}
                  className={index === 0 ? "demo-new-row" : ""}
                />
              ))}
            </ul>
          </div>
        </div>

        {/* 5 — rest */}
        <div className="demo-scene demo-scene-center demo-mark-outro">
          <AppMark />
        </div>
      </div>

      <figcaption className="sr-only">{t("demo.caption")}</figcaption>
    </figure>
  );
}
