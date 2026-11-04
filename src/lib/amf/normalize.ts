import type { Language, Publication } from "@/lib/types";

/** Raw record shape returned by the Opendatasoft Explore v2.1 API (only the fields we use). */
export interface AmfRecord {
  uin_idt_uin: string;
  uin_dat_amf: string;
  identificationsociete_iso_nom_soc: string | null;
  identificationsociete_iso_cd_isi: string | null;
  identificationsociete_iso_cd_lei: string | null;
  identificationsociete_iso_pay_ss: string | null;
  cac40: string | null;
  informationdeposee_inf_lng_inf: string | null;
  type_d_information: string | null;
  sous_type_d_information: string | null;
  informationdeposee_inf_tit_inf: string | null;
  url_de_recuperation: string | null;
  informationdeposee_inf_upg_inf_inf_upg_sts: string | null;
  informationdeposee_inf_upg_inf_inf_upg_rel: string | null;
}

export const AMF_FIELDS: (keyof AmfRecord)[] = [
  "uin_idt_uin",
  "uin_dat_amf",
  "identificationsociete_iso_nom_soc",
  "identificationsociete_iso_cd_isi",
  "identificationsociete_iso_cd_lei",
  "identificationsociete_iso_pay_ss",
  "cac40",
  "informationdeposee_inf_lng_inf",
  "type_d_information",
  "sous_type_d_information",
  "informationdeposee_inf_tit_inf",
  "url_de_recuperation",
  "informationdeposee_inf_upg_inf_inf_upg_sts",
  "informationdeposee_inf_upg_inf_inf_upg_rel",
];

export const UNCLASSIFIED = "Non classé";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** Returns a valid-looking ISIN or null (the feed uses "999999999999" as a placeholder). */
export function cleanIsin(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  return ISIN_RE.test(v) ? v : null;
}

export function parseLanguage(raw: string | null): Language {
  const v = (raw ?? "").toLowerCase();
  if (v.startsWith("fran")) return "fr";
  if (v.startsWith("angl") || v.startsWith("engl")) return "en";
  return "other";
}

/** Collapses whitespace; the feed sometimes contains double spaces and stray line breaks. */
export function cleanText(raw: string | null): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeRecord(r: AmfRecord): Publication {
  const status = (r.informationdeposee_inf_upg_inf_inf_upg_sts ?? "NEW").toUpperCase();
  return {
    id: r.uin_idt_uin,
    publishedAt: new Date(r.uin_dat_amf).toISOString(),
    company: cleanText(r.identificationsociete_iso_nom_soc) || "Société inconnue",
    isin: cleanIsin(r.identificationsociete_iso_cd_isi),
    lei: r.identificationsociete_iso_cd_lei?.trim() || null,
    country: r.identificationsociete_iso_pay_ss?.trim() || null,
    // "1" for CAC 40 members; the feed mixes "0" and null for the others.
    isCac40: r.cac40 === "1",
    language: parseLanguage(r.informationdeposee_inf_lng_inf),
    category: cleanText(r.type_d_information) || UNCLASSIFIED,
    subtype: cleanText(r.sous_type_d_information) || UNCLASSIFIED,
    title: cleanText(r.informationdeposee_inf_tit_inf) || "(sans titre)",
    documentUrl: r.url_de_recuperation ?? "",
    isCorrection: status !== "NEW",
    correctsRef: status !== "NEW" ? r.informationdeposee_inf_upg_inf_inf_upg_rel : null,
    translationOf: null,
  };
}

/** Window inside which two filings of the same company are considered translations. */
const TRANSLATION_WINDOW_MS = 30 * 60 * 1000;

/**
 * Detects FR/EN editions of the same disclosure: same company, same sub-type,
 * different languages, published within 30 minutes. The English edition gets
 * `translationOf` pointing to the French one, so the UI and the selection can skip it.
 */
export function linkTranslations(pubs: Publication[]): Publication[] {
  const out = pubs.map((p) => ({ ...p }));
  const byKey = new Map<string, Publication[]>();
  for (const p of out) {
    const key = `${p.isin ?? p.company}|${p.subtype}`;
    const list = byKey.get(key) ?? [];
    list.push(p);
    byKey.set(key, list);
  }
  for (const group of byKey.values()) {
    const fr = group.filter((p) => p.language === "fr");
    const others = group.filter((p) => p.language !== "fr");
    const used = new Set<string>();
    for (const o of others) {
      const t = Date.parse(o.publishedAt);
      // Closest French filing not already paired.
      const match = fr
        .filter((f) => !used.has(f.id) && Math.abs(Date.parse(f.publishedAt) - t) <= TRANSLATION_WINDOW_MS)
        .sort((a, b) => Math.abs(Date.parse(a.publishedAt) - t) - Math.abs(Date.parse(b.publishedAt) - t))[0];
      if (match) {
        o.translationOf = match.id;
        used.add(match.id);
      }
    }
  }
  return out;
}
