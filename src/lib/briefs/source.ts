import { extractText, getDocumentProxy } from "unpdf";

/** Upper bound on the text sent to the LLM (press releases rarely need more). */
export const MAX_SOURCE_CHARS = 15_000;
const MAX_PDF_BYTES = 15 * 1024 * 1024;

export interface SourceDocument {
  url: string;
  text: string;
  pages: number;
  /** Set when the document could not be read; the brief is then not generated. */
  error?: string;
}

/**
 * Downloads the filing's attached document and extracts its text.
 * Most filings are text PDFs; some are scans (no text) or zipped ESEF packages,
 * which we report instead of guessing.
 */
export async function loadSource(url: string, fetchImpl: typeof fetch = fetch): Promise<SourceDocument> {
  if (!url) return { url, text: "", pages: 0, error: "pas de document attaché" };
  if (!/\.pdf$/i.test(url)) {
    return { url, text: "", pages: 0, error: "document non PDF (ex. archive ESEF), non traité" };
  }
  const res = await fetchImpl(url, { cache: "no-store" });
  if (!res.ok) return { url, text: "", pages: 0, error: `téléchargement impossible (HTTP ${res.status})` };

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_PDF_BYTES) {
    return { url, text: "", pages: 0, error: "PDF trop volumineux (rapport annuel ?)" };
  }
  const pdf = await getDocumentProxy(buf);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { url, text: normalizeSourceText(text), pages: totalPages };
}

/** Removes hyphenation at line ends and repeated whitespace introduced by PDF extraction. */
export function normalizeSourceText(text: string): string {
  return text
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
