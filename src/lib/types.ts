/**
 * Domain types shared by the ingestion, selection, generation and verification layers.
 */

export type Language = "fr" | "en" | "other";

/** A regulated disclosure, normalized from one record of the AMF flux. */
export interface Publication {
  /** AMF unique id (uin_idt_uin), e.g. "083653_20261104". Stable primary key. */
  id: string;
  publishedAt: string; // ISO timestamp (uin_dat_amf)
  company: string;
  /** null when the source gives the placeholder "999999999999" or nothing. */
  isin: string | null;
  lei: string | null;
  country: string | null;
  isCac40: boolean;
  language: Language;
  /** Top-level category, "Non classé" when the source leaves it empty. */
  category: string;
  /** Sub-type, the most useful field for selection. "Non classé" when empty. */
  subtype: string;
  title: string;
  documentUrl: string;
  /** True when the record is a correction (status REC) of an earlier filing. */
  isCorrection: boolean;
  /** File name of the corrected filing, when isCorrection is true. */
  correctsRef: string | null;
  /** Id of the same disclosure in the other language, if detected. */
  translationOf: string | null;
}

export interface SelectionResult {
  score: number;
  selected: boolean;
  reasons: string[];
}

export type FigureStatus = "verified" | "approximate" | "not_found" | "unverifiable";

export interface FigureCheck {
  /** The figure as written in the brief, e.g. "285,0 M€". */
  figure: string;
  status: FigureStatus;
  /** Source excerpt where the figure was found, when available. */
  evidence: string | null;
  note?: string;
}

export interface Brief {
  id: string;
  publicationId: string;
  title: string;
  body: string;
  keyFacts: string[];
  figures: FigureCheck[];
  /** Overall status: ok if every figure is verified, otherwise needs review. */
  verification: "ok" | "review" | "unverifiable";
  model: string;
  createdAt: string;
  wordCount: number;
}
