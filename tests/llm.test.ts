import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateBrief } from "@/lib/briefs/generate";
import { provider } from "@/lib/briefs/llm";
import type { Publication } from "@/lib/types";

const pdf = readFileSync(path.join(__dirname, "../fixtures/sample-communique.pdf"));

const pub: Publication = {
  id: "test_1",
  publishedAt: "2026-11-03T16:00:00.000Z",
  company: "EXEMPLE SA",
  isin: "FR0000000000",
  lei: null,
  country: "FR",
  isCac40: false,
  language: "fr",
  category: "Informations réglementées continues",
  subtype: "Informations privilégiées",
  title: "EXEMPLE SA : chiffre d'affaires au 30 septembre 2026",
  documentUrl: "https://example.test/doc.pdf",
  isCorrection: false,
  correctsRef: null,
  translationOf: null,
};

// 110 words, with one figure (6,3 %) that is NOT in the source.
const body =
  "Exemple SA a publié un chiffre d'affaires consolidé de 285,0 millions d'euros au 30 septembre 2026, " +
  "en progression de 0,6 % par rapport à la même période de 2025, où il s'élevait à 283,3 M€. " +
  "L'activité Menuiserie atteint 97,4 M€ sur la période, soit une baisse de 2,1 %. " +
  "Le groupe confirme son objectif d'EBITDA supérieur à 18 M€ pour l'exercice 2026, ce qui représenterait " +
  "une marge de 6,3 %. La société ne donne pas d'autre précision sur ses perspectives à ce stade. " +
  "Le communiqué ne mentionne ni acquisition ni changement de gouvernance. Les résultats annuels seront " +
  "publiés ultérieurement selon le calendrier financier habituel de la société, qui sera communiqué aux " +
  "actionnaires et aux marchés en temps utile.";

function fakeFetch(groqCalls: unknown[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(".pdf")) return new Response(pdf);
    if (url.includes("api.groq.com")) {
      groqCalls.push(JSON.parse(String(init?.body)));
      const content = JSON.stringify({
        titre: "Exemple SA : chiffre d'affaires en hausse de 0,6 %",
        texte: body,
        faits_cles: ["Chiffre d'affaires de 285,0 M€ au 30 septembre 2026."],
        chiffres: [{ valeur: "285,0", extrait_source: "285,0 millions d'euros" }],
        source_suffisante: true,
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("generateBrief with Groq", () => {
  it("uses Groq when only GROQ_API_KEY is set", () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("LLM_PROVIDER", "");
    expect(provider()).toBe("groq");
  });

  it("generates a brief, sends a json_schema request and flags the computed margin", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubEnv("LLM_PROVIDER", "groq");
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", fakeFetch(calls));

    const brief = await generateBrief(pub);

    expect(calls).toHaveLength(1);
    const req = calls[0] as { model: string; response_format: { type: string } };
    expect(req.model).toBe("openai/gpt-oss-120b");
    expect(req.response_format.type).toBe("json_schema");

    expect(brief.wordCount).toBeGreaterThanOrEqual(100);
    expect(brief.wordCount).toBeLessThanOrEqual(150);
    const margin = brief.figures.find((f) => f.figure === "6,3 %");
    expect(margin?.status).toBe("not_found");
    expect(brief.figures.find((f) => f.figure.startsWith("285,0"))?.status).toBe("verified");
    expect(brief.verification).toBe("review");
  });

  it("retries once when Groq returns an empty JSON generation", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubEnv("LLM_PROVIDER", "groq");
    const calls: unknown[] = [];
    const ok = fakeFetch(calls);
    let failedOnce = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("api.groq.com") && !failedOnce) {
          failedOnce = true;
          return new Response(
            JSON.stringify({ error: { code: "json_validate_failed", failed_generation: "" } }),
            { status: 400 },
          );
        }
        return ok(input, init);
      }),
    );
    const brief = await generateBrief(pub);
    expect(failedOnce).toBe(true);
    expect(calls).toHaveLength(1);
    expect(brief.title).toContain("Exemple SA");
  });

  it("reports the free-tier rate limit clearly", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubEnv("LLM_PROVIDER", "groq");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith(".pdf")
          ? new Response(pdf)
          : new Response("{}", { status: 429, headers: { "retry-after": "12" } }),
      ),
    );
    const err = await generateBrief(pub).catch((e) => e);
    expect(err.message).toMatch(/palier gratuit Groq.*12 s/);
    expect(err.retryAfter).toBe(12);
  });
});
