import type { Accent } from "../atlas/types";
import type { CardState, Grade } from "../store/srs";

export type QuizKind = "meaning" | "picture" | "listen" | "spell";
export type Step =
  | { id: string; kind: "intro" }
  | { id: string; kind: QuizKind; retry?: boolean; options?: string[] };

export interface ActiveSession {
  id: string;
  started: number;
  steps: Step[];
  index: number;
  /** First-attempt grade per word; retries never change it. */
  graded: Record<string, Grade>;
  newIds: string[];
  reviewIds: string[];
  /** Answer shown but not yet continued; survives reload without double counting. */
  pending?: { correct: boolean; value: string };
  finished?: number;
}

export interface DayStat {
  n: number; // new words met
  r: number; // graded reviews (first attempts)
  c: number; // correct first attempts
  t: number; // active seconds
}

export interface TypingRound {
  at: number;
  mode: "word" | "sentence" | "dictation";
  items: number;
  wpm: number;
  accuracy: number;
}

export interface Progress {
  version: 2;
  datasetId: string;
  cards: Record<string, CardState>;
  bookmarks: string[];
  days: Record<string, DayStat>;
  typing: TypingRound[];
  session: ActiveSession | null;
  /** Rolling list of recent mistakes, newest first. */
  mistakes: string[];
}

export interface Settings {
  accent: Accent;
  autoplay: boolean;
  dailyNew: number;
  retention: number;
  theme: "system" | "light" | "dark";
  sfx: boolean;
  spell: boolean;
  startLevel: number;
  onboarded: boolean;
  dataset: "open" | "private";
  ambience:
    "off" | "stars" | "rain" | "sea" | "forest" | "fire" | "voyage" | "cafe";
  ambienceVolume: number;
  splash: boolean;
}

export const defaultSettings: Settings = {
  accent: "uk",
  autoplay: true,
  dailyNew: 10,
  retention: 0.9,
  theme: "dark",
  sfx: true,
  spell: true,
  startLevel: 0,
  onboarded: false,
  dataset: "open",
  ambience: "stars",
  ambienceVolume: 0.45,
  splash: true,
};

export const emptyProgress = (datasetId: string): Progress => ({
  version: 2,
  datasetId,
  cards: {},
  bookmarks: [],
  days: {},
  typing: [],
  session: null,
  mistakes: [],
});

let accountTimezone: string | null = null;
export const setAccountTimezone = (timezone: string | null) => {
  accountTimezone = timezone;
};
export const dayKey = (d = new Date()) =>
  accountTimezone
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: accountTimezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d)
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, lo = -Infinity, hi = Infinity) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

function validCard(v: unknown): v is CardState {
  return (
    isObj(v) &&
    num(v.due, 0) &&
    num(v.s, 0) &&
    num(v.d, 0, 11) &&
    num(v.el, 0) &&
    num(v.sd, 0) &&
    num(v.ls, 0) &&
    num(v.reps, 0) &&
    num(v.lapses, 0) &&
    [0, 1, 2, 3].includes(v.st as number) &&
    (v.last === undefined || num(v.last, 0)) &&
    num(v.seen, 0)
  );
}

export function sanitizeProgress(v: unknown, datasetId: string): Progress {
  const out = emptyProgress(datasetId);
  if (!isObj(v) || v.version !== 2) return out;
  if (isObj(v.cards))
    for (const [k, c] of Object.entries(v.cards))
      if (validCard(c))
        Object.defineProperty(out.cards, k, {
          value: c,
          enumerable: true,
          writable: true,
          configurable: true,
        });
  if (Array.isArray(v.bookmarks))
    out.bookmarks = v.bookmarks
      .filter((x): x is string => typeof x === "string")
      .slice(0, 20000);
  if (Array.isArray(v.mistakes))
    out.mistakes = v.mistakes
      .filter((x): x is string => typeof x === "string")
      .slice(0, 300);
  if (isObj(v.days))
    for (const [k, d] of Object.entries(v.days))
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(k) &&
        isObj(d) &&
        num(d.n, 0) &&
        num(d.r, 0) &&
        num(d.c, 0) &&
        num(d.t, 0)
      )
        out.days[k] = {
          n: d.n as number,
          r: d.r as number,
          c: d.c as number,
          t: d.t as number,
        };
  if (Array.isArray(v.typing))
    out.typing = v.typing
      .filter(
        (t): t is TypingRound =>
          isObj(t) &&
          num(t.at, 0) &&
          ["word", "sentence", "dictation"].includes(t.mode as string) &&
          num(t.items, 0) &&
          num(t.wpm, 0, 400) &&
          num(t.accuracy, 0, 100),
      )
      .slice(-500);
  const s = v.session;
  if (
    isObj(s) &&
    typeof s.id === "string" &&
    Array.isArray(s.steps) &&
    num(s.index, 0) &&
    isObj(s.graded)
  )
    out.session = s as unknown as ActiveSession;
  return out;
}

export function sanitizeSettings(v: unknown): Settings {
  const s = { ...defaultSettings };
  if (!isObj(v)) return s;
  if (v.accent === "uk" || v.accent === "us") s.accent = v.accent;
  if (typeof v.autoplay === "boolean") s.autoplay = v.autoplay;
  if (num(v.dailyNew, 0, 100)) s.dailyNew = Math.round(v.dailyNew as number);
  if (num(v.retention, 0.7, 0.97)) s.retention = v.retention as number;
  if (v.theme === "system" || v.theme === "light" || v.theme === "dark")
    s.theme = v.theme;
  if (typeof v.sfx === "boolean") s.sfx = v.sfx;
  if (typeof v.spell === "boolean") s.spell = v.spell;
  if (num(v.startLevel, 0, 5))
    s.startLevel = Math.round(v.startLevel as number);
  if (typeof v.onboarded === "boolean") s.onboarded = v.onboarded;
  if (v.dataset === "open" || v.dataset === "private") s.dataset = v.dataset;
  if (
    [
      "off",
      "stars",
      "rain",
      "sea",
      "forest",
      "fire",
      "voyage",
      "cafe",
    ].includes(v.ambience as string)
  )
    s.ambience = v.ambience as Settings["ambience"];
  if (num(v.ambienceVolume, 0, 1))
    s.ambienceVolume = v.ambienceVolume as number;
  if (typeof v.splash === "boolean") s.splash = v.splash;
  return s;
}
