import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import records from "../fixtures/sample-records.json";
import { buildWhere, fetchAmfRecords } from "@/lib/amf/client";
import { loadSource } from "@/lib/briefs/source";
import { countWords } from "@/lib/briefs/generate";
import { verifyBrief, overallStatus } from "@/lib/verify/numbers";

/** Fake API that serves the fixture page by page, like the real endpoint. */
function fakeApi(all: unknown[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    expect(limit).toBeLessThanOrEqual(100); // the real API rejects more
    return new Response(JSON.stringify({ total_count: all.length, results: all.slice(offset, offset + limit) }));
  }) as typeof fetch;
}

describe("AMF client", () => {
  it("builds a bounded ODSQL date window", () => {
    const w = buildWhere(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-04T00:00:00Z"));
    expect(w).toBe("uin_dat_amf >= date'2026-11-01T00:00:00.000Z' and uin_dat_amf < date'2026-11-04T00:00:00.000Z'");
  });

  it("pages through all records", async () => {
    const many = [...records, ...records, ...records].map((r, i) => ({ ...r, uin_idt_uin: `id${i}` }));
    const got = await fetchAmfRecords(new Date(0), new Date(), fakeApi(many));
    expect(got).toHaveLength(300);
  });
});

describe("source PDF + verification", () => {
  const pdf = readFileSync(path.join(__dirname, "../fixtures/sample-communique.pdf"));
  const fakePdf = (async () => new Response(pdf)) as typeof fetch;

  it("extracts text from a PDF", async () => {
    const src = await loadSource("https://example.test/doc.pdf", fakePdf);
    expect(src.error).toBeUndefined();
    expect(src.text).toContain("285,0 millions");
  });

  it("refuses non-PDF documents instead of guessing", async () => {
    const src = await loadSource("https://example.test/esef.zip", fakePdf);
    expect(src.error).toMatch(/non PDF/);
  });

  it("verifies a realistic brief end to end", async () => {
    const src = await loadSource("https://example.test/doc.pdf", fakePdf);
    const brief =
      "Exemple SA publie un chiffre d'affaires de 285 M€ à fin septembre, en hausse de 0,6 %. " +
      "La Menuiserie recule de 2,1 % à 97,4 M€. Le groupe vise un EBITDA supérieur à 18 M€, " +
      "soit une marge de 6,3 %.";
    const checks = verifyBrief(brief, src.text);
    const byFigure = Object.fromEntries(checks.map((c) => [c.figure, c.status]));
    expect(byFigure["285 M€"]).toBe("verified");
    expect(byFigure["97,4 M€"]).toBe("verified");
    // The margin was computed by the "model": not in the source, must be flagged.
    expect(byFigure["6,3 %"]).toBe("not_found");
    expect(overallStatus(checks)).toBe("review");
  });
});

describe("countWords", () => {
  it("counts French words, ignoring punctuation-only tokens", () => {
    expect(countWords("L'activité progresse de 0,6 % — au 3e trimestre.")).toBe(7);
  });
});
