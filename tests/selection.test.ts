import { describe, expect, it } from "vitest";
import records from "../fixtures/sample-records.json";
import { linkTranslations, normalizeRecord, type AmfRecord } from "@/lib/amf/normalize";
import { pickTop, scorePublication } from "@/lib/selection/score";

const pubs = linkTranslations((records as AmfRecord[]).map(normalizeRecord));
const byTitle = (needle: string) => {
  const p = pubs.find((x) => x.title.includes(needle) && !x.translationOf);
  if (!p) throw new Error(`fixture missing: ${needle}`);
  return p;
};

describe("normalization", () => {
  it("links English editions to their French original", () => {
    const en = pubs.find((p) => p.title.startsWith("ROCTOOL: new significant"));
    const fr = pubs.find((p) => p.title.startsWith("ROCTOOL: nouvelle commande"));
    expect(en?.translationOf).toBe(fr?.id);
    expect(fr?.translationOf).toBeNull();
  });
});

describe("selection", () => {
  it("selects results and significant orders", () => {
    expect(scorePublication(byTitle("HERIGE INDUSTRIES : CHIFFRE")).selected).toBe(true);
    expect(scorePublication(byTitle("ROCTOOL: nouvelle commande")).selected).toBe(true);
  });

  it("skips routine filings", () => {
    expect(scorePublication(byTitle("Déclaration des transactions sur actions propres")).selected).toBe(false);
    expect(scorePublication(byTitle("nombre d'actions et de droits de vote")).selected).toBe(false);
  });

  it("does not select generic titles on their own", () => {
    expect(scorePublication(byTitle("Informations privilégiées / Autres communiqués")).selected).toBe(false);
  });

  it("keeps at most one pick per company", () => {
    const top = pickTop(pubs, 10);
    const keys = top.map((t) => t.publication.isin ?? t.publication.company);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("prints the ranking for manual review", () => {
    const top = pickTop(pubs, 12);
    console.log(
      top.map((t) => `${t.selection.score}\t${t.publication.company}\t${t.publication.title.slice(0, 70)}`).join("\n"),
    );
    expect(top.length).toBeGreaterThan(3);
  });
});
