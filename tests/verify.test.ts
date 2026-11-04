import { describe, expect, it } from "vitest";
import { extractFigures, overallStatus, parseNumber, verifyBrief } from "@/lib/verify/numbers";

// Text in the style of a real AMF press release (HERIGE, Q3 revenue).
const SOURCE = `HERIGE INDUSTRIES : CHIFFRE D'AFFAIRES AU 30 SEPTEMBRE 2026 À 285,0 M EUR (+0,6%)
Le chiffre d'affaires consolidé du Groupe s'établit à 285,0 millions d'euros au 30 septembre 2026,
en progression de 0,6 % par rapport à la même période de 2025 (283,3 M€). Au troisième trimestre,
l'activité Menuiserie atteint 97,4 M€, soit une baisse de 2,1 %. Le Groupe emploie 1 234 collaborateurs
et confirme son objectif d'EBITDA supérieur à 18 M€ pour l'exercice. Surface : 5 000 m².`;

describe("parseNumber", () => {
  it("reads French and English formats", () => {
    expect(parseNumber("285,0")).toEqual({ values: [285], decimals: 1 });
    expect(parseNumber("1 234 567,89").values).toEqual([1234567.89]);
    expect(parseNumber("1,234.5").values).toEqual([1234.5]);
    expect(parseNumber("750.000.000").values).toEqual([750_000_000]);
  });

  it("keeps both readings when the separator is ambiguous", () => {
    expect(parseNumber("1,234").values).toEqual([1.234, 1234]);
  });
});

describe("extractFigures", () => {
  it("applies scale and unit", () => {
    const [f] = extractFigures("un CA de 6,5 M€");
    expect(f.values[0]).toBeCloseTo(6_500_000);
    expect(f.unit).toBe("currency");
    const [g] = extractFigures("1,2 milliard d'euros");
    expect(g.values[0]).toBeCloseTo(1.2e9);
    const [h] = extractFigures("5 000 m²");
    expect(h.values[0]).toBe(5000);
  });
});

describe("verifyBrief", () => {
  it("verifies figures written differently from the source", () => {
    const checks = verifyBrief("Herige réalise 285 M€ de chiffre d'affaires (+0,6 %).", SOURCE);
    expect(checks.map((c) => c.status)).toEqual(["verified", "verified"]);
  });

  it("accepts a rounding but labels it", () => {
    const checks = verifyBrief("L'activité Menuiserie pèse 97 M€.", SOURCE);
    expect(checks[0].status).toBe("approximate");
  });

  it("flags a figure that is not in the source (e.g. computed or hallucinated)", () => {
    const checks = verifyBrief("Le chiffre d'affaires progresse de 1,7 M€ sur un an.", SOURCE);
    expect(checks[0].status).toBe("not_found");
    expect(overallStatus(checks)).toBe("review");
  });

  it("does not confuse percentages and amounts", () => {
    const checks = verifyBrief("Une hausse de 18 %.", SOURCE);
    expect(checks[0].status).toBe("not_found");
  });

  it("ignores years and small counters", () => {
    expect(verifyBrief("Au 3e trimestre 2026, sur 9 mois.", SOURCE)).toEqual([]);
  });

  it("marks everything unverifiable when the PDF has no text", () => {
    const checks = verifyBrief("Un CA de 285 M€.", "   ");
    expect(checks[0].status).toBe("unverifiable");
    expect(overallStatus(checks)).toBe("unverifiable");
  });
});
