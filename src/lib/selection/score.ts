import type { Publication, SelectionResult } from "@/lib/types";

/**
 * Editorial selection: which disclosures deserve a news brief?
 *
 * The score is a sum of transparent, explainable signals rather than an LLM call,
 * so every decision can be audited ("why was this picked?") and costs nothing.
 *   1. Sub-type (the regulatory nature of the filing) sets a base score.
 *   2. Title keywords add news value (results, M&A, orders, guidance, capital...).
 *   3. A figure in the title (amount, %) suggests concrete, quotable news.
 *   4. CAC 40 membership adds audience interest.
 *   5. Penalties: generic titles, corrections, duplicated translations.
 */

export const SELECTION_THRESHOLD = 5;

/** Base score per AMF sub-type. Unknown sub-types get 0. */
const SUBTYPE_SCORES: Record<string, number> = {
  "Communiqués publiés en période d'offre publique d'acquisition": 4,
  "Informations privilégiées": 3,
  "Information financière trimestrielle": 3,
  "Déclarations d'intention en cas de rumeurs": 3,
  "Rapports financiers et d'audit annuels": 2,
  "Rapports financiers et d'audit semestriels/examens réduits": 2,
  "Décision de franchissement de seuil": 2,
  // Routine, recurring filings: rarely news on their own.
  "Total du nombre de droits de vote et du capital": -3,
  "Acquisition ou cession des actions de l'émetteur": -3,
  "Etat membre d'origine": -3,
  "Information et rapport sur gouvernement d'entreprise": -2,
  "Modalités de mise à disposition de prospectus": -2,
  "Modalités de mise à disposition des documents préparatoires à l'AG": -2,
  "Modalités de mise à disposition de document de référence ou de ses actualisations": -2,
};

interface KeywordSignal {
  label: string;
  pattern: RegExp;
  points: number;
}

/** Titles mixing FR and EN are common, so each signal matches both languages. */
const KEYWORD_SIGNALS: KeywordSignal[] = [
  {
    label: "résultats / chiffre d'affaires",
    pattern: /r[ée]sultats?|chiffre d.affaires|\bCA\b|results|revenue|turnover|sales/i,
    points: 2,
  },
  {
    label: "opération stratégique (acquisition, cession, offre)",
    pattern: /acqui(ert|sition)|cession|fusion|offre publique|\bOPAS?\b|\bOPE\b|merger|takeover|tender offer|rapprochement/i,
    points: 3,
  },
  {
    label: "contrat / commande / partenariat",
    pattern: /commande|contrat|partenariat|d[ée]ploi|\border\b|contract|partnership|deploy/i,
    points: 2,
  },
  {
    label: "perspectives / alerte",
    // "révision" but not "révisable" (a bond feature, seen in a real title).
    pattern: /objectif|guidance|perspective|pr[ée]vision|ralentissement|avertissement|r[ée]vision|r[ée]vis[ée]|profit warning|outlook|slowdown|reaffirm/i,
    points: 2,
  },
  {
    label: "opération sur le capital ou la dette",
    pattern: /augmentation de capital|dividende|restructuration|refinancement|dette|capital increase|debt restructuring/i,
    points: 2,
  },
  {
    label: "gouvernance (nomination, départ)",
    pattern: /nomination|nomm[ée]|d[ée]mission|directeur g[ée]n[ée]ral|\bCEO\b|appoint|resign/i,
    points: 1,
  },
];

/** Signals that look like news keywords but describe routine filings. */
const ROUTINE_PATTERN =
  /actions propres|own shares|treasury shares|droits de vote|voting rights|contrat de liquidit|liquidity contract|bilan semestriel du contrat/i;

/** Early redemption of bonds: frequent treasury operations for banks, rarely a story. */
const ROUTINE_DEBT_PATTERN = /rembours\w*.{0,40}obligations?|obligations?.{0,40}rembours|redemption|redeem/i;

/** Titles that only repeat the category and say nothing about the content. */
const GENERIC_TITLE_PATTERN =
  /^(informations? privil[ée]gi[ée]es?|inside information)\s*\/\s*(autres communiqu[ée]s|other news releases)$/i;

/** An amount or a percentage, e.g. "285,0 M EUR", "6,5 M€", "+0.6%", "GBP 750,000,000". */
const FIGURE_IN_TITLE = /\d[\d\s.,]*\s?(%|m€|md€|k€|m\s?eur|millions?|milliards?|billion|million|livres sterling|€|\$|eur\b|usd\b)|(eur|gbp|usd)\s?\d/i;

export function scorePublication(p: Publication): SelectionResult {
  const reasons: string[] = [];
  let score = 0;

  if (p.translationOf) {
    return {
      score: 0,
      selected: false,
      reasons: ["traduction d'une publication déjà listée (version française retenue)"],
    };
  }

  const base = SUBTYPE_SCORES[p.subtype] ?? 0;
  score += base;
  reasons.push(`type « ${p.subtype} » : ${base >= 0 ? "+" : ""}${base}`);

  const routine = ROUTINE_PATTERN.test(p.title);
  if (routine) {
    score -= 2;
    reasons.push("titre de publication récurrente (actions propres, droits de vote...) : -2");
  } else {
    for (const signal of KEYWORD_SIGNALS) {
      if (signal.pattern.test(p.title)) {
        score += signal.points;
        reasons.push(`${signal.label} : +${signal.points}`);
      }
    }
  }

  if (ROUTINE_DEBT_PATTERN.test(p.title)) {
    score -= 2;
    reasons.push("remboursement d'obligations, opération de trésorerie courante : -2");
  }

  if (FIGURE_IN_TITLE.test(p.title)) {
    score += 1;
    reasons.push("chiffre dans le titre : +1");
  }

  if (p.isCac40) {
    score += 2;
    reasons.push("société du CAC 40 : +2");
  }

  if (GENERIC_TITLE_PATTERN.test(p.title)) {
    score -= 2;
    reasons.push("titre générique, contenu inconnu sans lire le PDF : -2");
  }

  if (p.isCorrection) {
    score -= 1;
    reasons.push("correctif d'une publication antérieure : -1");
  }

  return { score, selected: score >= SELECTION_THRESHOLD, reasons };
}

export interface RankedPublication {
  publication: Publication;
  selection: SelectionResult;
}

/**
 * Ranks selected publications and keeps at most one per company, so that
 * the top picks cover different news rather than one issuer's batch of filings.
 */
export function pickTop(pubs: Publication[], n: number): RankedPublication[] {
  const ranked = pubs
    .map((publication) => ({ publication, selection: scorePublication(publication) }))
    .filter((r) => r.selection.selected)
    .sort(
      (a, b) =>
        b.selection.score - a.selection.score ||
        Date.parse(b.publication.publishedAt) - Date.parse(a.publication.publishedAt),
    );

  const seen = new Set<string>();
  const out: RankedPublication[] = [];
  for (const r of ranked) {
    const key = r.publication.isin ?? r.publication.company;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}
