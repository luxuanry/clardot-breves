import type { FigureCheck, FigureStatus } from "@/lib/types";

/**
 * Deterministic check that the figures written in a brief appear in the source document.
 *
 * We do NOT ask the LLM whether its own figures are right. Instead:
 *   1. Extract every figure from the brief with a regex (number + optional scale + unit).
 *   2. Extract every figure from the source PDF text the same way.
 *   3. A brief figure is:
 *      - "verified"    if a source figure has the same value at the same precision,
 *      - "approximate" if a source figure rounds to it (e.g. 1 234 M€ written 1,2 Md€),
 *      - "not_found"   otherwise (computed by the model, misread, or invented),
 *      - "unverifiable" if the source has no usable text (scanned PDF, download error).
 * Sign is ignored on purpose: "-3 %" in the source is often written "baisse de 3 %".
 */

export type Unit = "percent" | "currency" | "plain";

export interface ParsedFigure {
  raw: string;
  /** Candidate absolute values (several when "1,234" is ambiguous). */
  values: number[];
  /** Number of decimals displayed, used as rounding tolerance. */
  decimals: number;
  /** Multiplier applied (1, 1e3, 1e6, 1e9). */
  scale: number;
  unit: Unit;
  index: number;
}

// Thin spaces and non-breaking spaces are frequent in French PDFs.
const SPACE = "[\\s\\u00a0\\u202f]";

const SCALE_WORDS: [RegExp, number][] = [
  [/^(md|mds|milliards?|billions?|bn|b)\b/i, 1e9],
  // "(?![²³])" so that "5 000 m²" is not read as 5 billion.
  [/^(m|mn|mio|millions?)\b(?![²³])/i, 1e6],
  [/^(k|milliers?|thousands?)\b/i, 1e3],
];

const CURRENCY = /^(€|eur(os?)?\b|\$|usd\b|dollars?\b|£|gbp\b|livres? sterling|chf\b|d['’]euros)/i;

/** A number: digits with optional thousand groups and decimals, e.g. 1 234 567,89 or 750.000.000. */
const NUMBER_RE = new RegExp(
  `(?<![\\w.,])([+\\-−]?)(\\d{1,3}(?:(?:${SPACE}|[.,])\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)`,
  "g",
);

/**
 * Turns "1 234,5" / "1,234.5" / "750.000.000" / "6,5" into candidate numeric values.
 * Returns several candidates when the separator is ambiguous ("1,234" is 1.234 or 1234).
 */
export function parseNumber(token: string): { values: number[]; decimals: number } {
  const t = token.replace(new RegExp(SPACE, "g"), " ").trim();
  const seps = [...t.matchAll(/[ .,]/g)].map((m) => m[0]);
  const digits = t.replace(/[ .,]/g, "");

  if (seps.length === 0) return { values: [Number(digits)], decimals: 0 };

  const last = t.search(/[.,](?=\d+$)/);
  const lastSep = last >= 0 ? t[last] : null;
  const tail = last >= 0 ? t.slice(last + 1) : "";

  // Only spaces: pure thousand groups.
  if (!lastSep) return { values: [Number(digits)], decimals: 0 };

  const sameSepCount = seps.filter((s) => s === lastSep).length;
  const asDecimal = () => {
    const intPart = t.slice(0, last).replace(/[ .,]/g, "");
    return Number(`${intPart}.${tail}`);
  };

  // "750.000.000": the same separator repeats, it must be a thousand separator.
  if (sameSepCount > 1) return { values: [Number(digits)], decimals: 0 };
  // "1 234,5" or "1,234.5": two different separators, the last one is decimal.
  if (seps.some((s) => s !== lastSep && s !== " ") || (seps.includes(" ") && tail.length !== 3)) {
    return { values: [asDecimal()], decimals: tail.length };
  }
  // A single separator followed by exactly 3 digits is ambiguous.
  if (tail.length === 3) {
    return { values: [asDecimal(), Number(digits)], decimals: 3 };
  }
  return { values: [asDecimal()], decimals: tail.length };
}

/** Extracts every figure in a text, with its scale and unit when written right after it. */
export function extractFigures(text: string): ParsedFigure[] {
  const out: ParsedFigure[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const token = m[2];
    const index = m.index ?? 0;
    const before = text.slice(Math.max(0, index - 6), index);
    // `cursor` tracks where the figure ends in the original text, to quote it verbatim.
    let cursor = index + m[0].length;
    const spacesAt = (pos: number) => text.slice(pos).match(/^[\s  ]*/)?.[0].length ?? 0;

    let scale = 1;
    let end = cursor;
    let ws = spacesAt(cursor);
    for (const [re, mult] of SCALE_WORDS) {
      const s = text.slice(cursor + ws).match(re);
      if (s) {
        scale = mult;
        cursor += ws + s[0].length;
        end = cursor;
        break;
      }
    }

    ws = spacesAt(cursor);
    const rest = text.slice(cursor + ws);
    let unit: Unit = "plain";
    if (rest.startsWith("%") || /^pour ?cent|^percent/i.test(rest)) {
      unit = "percent";
      if (rest.startsWith("%")) end = cursor + ws + 1;
    } else {
      const c = rest.match(CURRENCY);
      if (c) {
        unit = "currency";
        end = cursor + ws + c[0].length;
      } else if (/(€|\$|£|eur|usd|gbp)\s?$/i.test(before)) {
        unit = "currency";
      }
    }

    const { values, decimals } = parseNumber(token);
    out.push({
      raw: text.slice(index, end).replace(/[\s  ]+/g, " ").trim(),
      values: values.map((v) => v * scale),
      decimals,
      scale,
      unit,
      index,
    });
  }
  return out;
}

/** Figures not worth checking: bare years and small counters ("3e trimestre", "9 mois"). */
export function isTrivial(f: ParsedFigure): boolean {
  if (f.unit !== "plain" || f.scale !== 1 || f.decimals > 0) return false;
  const v = f.values[0];
  return (v >= 1900 && v <= 2100) || v < 10;
}

function excerpt(text: string, index: number, radius = 70): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** Minimum amount of extracted text below which we consider the PDF unreadable (scan). */
export const MIN_SOURCE_CHARS = 200;

export function checkFigure(fig: ParsedFigure, source: ParsedFigure[], sourceText: string): FigureCheck {
  // Same value at the brief's precision: tolerance is half of the last displayed digit.
  const tolerance = (0.5 * fig.scale) / 10 ** fig.decimals;
  const unitCompatible = (s: ParsedFigure) =>
    fig.unit === "plain" || s.unit === "plain" || s.unit === fig.unit;

  let best: { s: ParsedFigure; status: FigureStatus } | null = null;
  for (const s of source) {
    if (!unitCompatible(s)) continue;
    for (const a of fig.values) {
      for (const b of s.values) {
        if (a === b) {
          best = { s, status: "verified" };
          break;
        }
        if (Math.abs(a - b) <= tolerance + Number.EPSILON * Math.max(a, b)) {
          if (!best) best = { s, status: "approximate" };
        }
      }
      if (best?.status === "verified") break;
    }
    if (best?.status === "verified") break;
  }

  if (!best) {
    return {
      figure: fig.raw,
      status: "not_found",
      evidence: null,
      note: "absent du document source : chiffre calculé, mal lu ou inventé, à vérifier",
    };
  }
  return {
    figure: fig.raw,
    status: best.status,
    evidence: excerpt(sourceText, best.s.index),
    note: best.status === "approximate" ? `arrondi de « ${best.s.raw} »` : undefined,
  };
}

/** Checks every non-trivial figure of the brief against the source text. */
export function verifyBrief(briefText: string, sourceText: string): FigureCheck[] {
  const briefFigures = extractFigures(briefText).filter((f) => !isTrivial(f));
  // Same figure written twice in the brief is checked once.
  const unique = [...new Map(briefFigures.map((f) => [f.raw, f])).values()];

  if (sourceText.replace(/\s/g, "").length < MIN_SOURCE_CHARS) {
    return unique.map((f) => ({
      figure: f.raw,
      status: "unverifiable" as const,
      evidence: null,
      note: "texte du PDF illisible ou absent (document scanné ?)",
    }));
  }
  const source = extractFigures(sourceText);
  return unique.map((f) => checkFigure(f, source, sourceText));
}

export function overallStatus(checks: FigureCheck[]): "ok" | "review" | "unverifiable" {
  if (checks.length > 0 && checks.every((c) => c.status === "unverifiable")) return "unverifiable";
  return checks.every((c) => c.status === "verified" || c.status === "approximate") ? "ok" : "review";
}
