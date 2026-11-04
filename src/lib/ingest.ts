import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchAmfRecords } from "@/lib/amf/client";
import { linkTranslations, normalizeRecord, type AmfRecord } from "@/lib/amf/normalize";
import { scorePublication } from "@/lib/selection/score";
import { getStore } from "@/lib/store";

export interface IngestReport {
  from: string;
  to: string;
  fetched: number;
  stored: number;
  selected: number;
  translations: number;
}

/** Fetches the last `days` days from info-financière, normalizes, scores and stores them. */
export async function ingest(days: number): Promise<IngestReport> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  // AMF_USE_FIXTURE=1 replays a real API snapshot (offline dev, tests, demos).
  const raw =
    process.env.AMF_USE_FIXTURE === "1"
      ? (JSON.parse(
          await readFile(path.join(process.cwd(), "fixtures/sample-records.json"), "utf8"),
        ) as AmfRecord[])
      : await fetchAmfRecords(from, to);
  const pubs = linkTranslations(raw.map(normalizeRecord)).map((p) => ({
    ...p,
    selection: scorePublication(p),
  }));
  const stored = await getStore().upsertPublications(pubs);

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    fetched: raw.length,
    stored,
    selected: pubs.filter((p) => p.selection.selected).length,
    translations: pubs.filter((p) => p.translationOf).length,
  };
}
