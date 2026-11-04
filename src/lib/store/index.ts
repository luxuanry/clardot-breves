import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Brief, Publication, SelectionResult } from "@/lib/types";

/** A publication as stored, i.e. with its selection score attached. */
export interface StoredPublication extends Publication {
  selection: SelectionResult;
}

export interface PublicationFilters {
  company?: string;
  subtype?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD, inclusive
  selectedOnly?: boolean;
  hideTranslations?: boolean;
  limit?: number;
}

export interface Store {
  upsertPublications(pubs: StoredPublication[]): Promise<number>;
  listPublications(f: PublicationFilters): Promise<StoredPublication[]>;
  getPublication(id: string): Promise<StoredPublication | null>;
  /** Distinct values for the filter dropdowns. */
  facets(): Promise<{ companies: string[]; subtypes: string[] }>;
  saveBrief(b: Brief): Promise<Brief>;
  listBriefs(): Promise<(Brief & { publication: StoredPublication })[]>;
  getBriefByPublication(publicationId: string): Promise<Brief | null>;
  mode: "supabase" | "memory";
}

// ---------- mapping helpers ----------

type Row = Record<string, unknown>;

function toRow(p: StoredPublication): Row {
  return {
    id: p.id,
    published_at: p.publishedAt,
    company: p.company,
    isin: p.isin,
    lei: p.lei,
    country: p.country,
    is_cac40: p.isCac40,
    language: p.language,
    category: p.category,
    subtype: p.subtype,
    title: p.title,
    document_url: p.documentUrl,
    is_correction: p.isCorrection,
    corrects_ref: p.correctsRef,
    translation_of: p.translationOf,
    score: p.selection.score,
    selected: p.selection.selected,
    score_reasons: p.selection.reasons,
  };
}

function fromRow(r: Row): StoredPublication {
  return {
    id: r.id as string,
    publishedAt: r.published_at as string,
    company: r.company as string,
    isin: (r.isin as string) ?? null,
    lei: (r.lei as string) ?? null,
    country: (r.country as string) ?? null,
    isCac40: Boolean(r.is_cac40),
    language: r.language as StoredPublication["language"],
    category: r.category as string,
    subtype: r.subtype as string,
    title: r.title as string,
    documentUrl: r.document_url as string,
    isCorrection: Boolean(r.is_correction),
    correctsRef: (r.corrects_ref as string) ?? null,
    translationOf: (r.translation_of as string) ?? null,
    selection: {
      score: r.score as number,
      selected: Boolean(r.selected),
      reasons: (r.score_reasons as string[]) ?? [],
    },
  };
}

function briefToRow(b: Brief): Row {
  return {
    publication_id: b.publicationId,
    title: b.title,
    body: b.body,
    key_facts: b.keyFacts,
    figures: b.figures,
    verification: b.verification,
    model: b.model,
    word_count: b.wordCount,
  };
}

function briefFromRow(r: Row): Brief {
  return {
    id: r.id as string,
    publicationId: r.publication_id as string,
    title: r.title as string,
    body: r.body as string,
    keyFacts: (r.key_facts as string[]) ?? [],
    figures: (r.figures as Brief["figures"]) ?? [],
    verification: r.verification as Brief["verification"],
    model: r.model as string,
    createdAt: r.created_at as string,
    wordCount: r.word_count as number,
  };
}

/** End of day for an inclusive "to" date filter. */
function endOfDay(date: string): string {
  return new Date(`${date}T23:59:59.999Z`).toISOString();
}

// ---------- Supabase implementation ----------

class SupabaseStore implements Store {
  mode = "supabase" as const;
  constructor(private db: SupabaseClient) {}

  async upsertPublications(pubs: StoredPublication[]) {
    // Chunked to stay well under request size limits.
    for (let i = 0; i < pubs.length; i += 500) {
      const { error } = await this.db.from("publications").upsert(pubs.slice(i, i + 500).map(toRow));
      if (error) throw new Error(`upsert publications: ${error.message}`);
    }
    return pubs.length;
  }

  async listPublications(f: PublicationFilters) {
    let q = this.db.from("publications").select("*").order("published_at", { ascending: false });
    if (f.company) q = q.eq("company", f.company);
    if (f.subtype) q = q.eq("subtype", f.subtype);
    if (f.from) q = q.gte("published_at", new Date(f.from).toISOString());
    if (f.to) q = q.lte("published_at", endOfDay(f.to));
    if (f.selectedOnly) q = q.eq("selected", true);
    if (f.hideTranslations) q = q.is("translation_of", null);
    const { data, error } = await q.limit(f.limit ?? 500);
    if (error) throw new Error(`list publications: ${error.message}`);
    return (data ?? []).map(fromRow);
  }

  async getPublication(id: string) {
    const { data, error } = await this.db.from("publications").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`get publication: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async facets() {
    // A few thousand rows at most for a few days: reading two columns is fine here.
    const { data, error } = await this.db.from("publications").select("company, subtype").limit(5000);
    if (error) throw new Error(`facets: ${error.message}`);
    const companies = [...new Set((data ?? []).map((r) => r.company as string))].sort();
    const subtypes = [...new Set((data ?? []).map((r) => r.subtype as string))].sort();
    return { companies, subtypes };
  }

  async saveBrief(b: Brief) {
    const { data, error } = await this.db
      .from("briefs")
      .upsert(briefToRow(b), { onConflict: "publication_id" })
      .select()
      .single();
    if (error) throw new Error(`save brief: ${error.message}`);
    return briefFromRow(data);
  }

  async listBriefs() {
    const { data, error } = await this.db
      .from("briefs")
      .select("*, publications(*)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`list briefs: ${error.message}`);
    return (data ?? []).map((r) => ({
      ...briefFromRow(r),
      publication: fromRow(r.publications as Row),
    }));
  }

  async getBriefByPublication(publicationId: string) {
    const { data, error } = await this.db
      .from("briefs")
      .select("*")
      .eq("publication_id", publicationId)
      .maybeSingle();
    if (error) throw new Error(`get brief: ${error.message}`);
    return data ? briefFromRow(data) : null;
  }
}

// ---------- In-memory implementation (local dev without Supabase) ----------

class MemoryStore implements Store {
  mode = "memory" as const;
  private pubs = new Map<string, StoredPublication>();
  private briefs = new Map<string, Brief>();

  async upsertPublications(pubs: StoredPublication[]) {
    for (const p of pubs) this.pubs.set(p.id, p);
    return pubs.length;
  }

  async listPublications(f: PublicationFilters) {
    const from = f.from ? Date.parse(f.from) : -Infinity;
    const to = f.to ? Date.parse(endOfDay(f.to)) : Infinity;
    return [...this.pubs.values()]
      .filter(
        (p) =>
          (!f.company || p.company === f.company) &&
          (!f.subtype || p.subtype === f.subtype) &&
          Date.parse(p.publishedAt) >= from &&
          Date.parse(p.publishedAt) <= to &&
          (!f.selectedOnly || p.selection.selected) &&
          (!f.hideTranslations || !p.translationOf),
      )
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, f.limit ?? 500);
  }

  async getPublication(id: string) {
    return this.pubs.get(id) ?? null;
  }

  async facets() {
    const all = [...this.pubs.values()];
    return {
      companies: [...new Set(all.map((p) => p.company))].sort(),
      subtypes: [...new Set(all.map((p) => p.subtype))].sort(),
    };
  }

  async saveBrief(b: Brief) {
    this.briefs.set(b.publicationId, b);
    return b;
  }

  async listBriefs() {
    return [...this.briefs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((b) => {
        const publication = this.pubs.get(b.publicationId);
        return publication ? [{ ...b, publication }] : [];
      });
  }

  async getBriefByPublication(publicationId: string) {
    return this.briefs.get(publicationId) ?? null;
  }
}

// Survive Next.js dev hot reloads by caching on globalThis.
const g = globalThis as unknown as { __store?: Store };

export function getStore(): Store {
  if (g.__store) return g.__store;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  g.__store =
    url && key
      ? new SupabaseStore(createClient(url, key, { auth: { persistSession: false } }))
      : new MemoryStore();
  return g.__store;
}
