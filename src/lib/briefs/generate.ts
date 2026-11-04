import { z } from "zod";
import type { Brief, Publication } from "@/lib/types";
import { overallStatus, verifyBrief } from "@/lib/verify/numbers";
import { LlmError, apiKeyMissing, completeJson, modelName, provider, type ChatMessage } from "./llm";
import { BRIEF_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, lengthFeedback } from "./prompt";
import { loadSource } from "./source";

const LlmBrief = z.object({
  titre: z.string().min(1),
  texte: z.string().min(1),
  faits_cles: z.array(z.string()),
  chiffres: z.array(z.object({ valeur: z.string(), extrait_source: z.string() })),
  source_suffisante: z.boolean(),
});
type LlmBrief = z.infer<typeof LlmBrief>;

export const MIN_WORDS = 100;
export const MAX_WORDS = 150;

/**
 * Max source characters sent to the model. Groq's free tier has a low
 * tokens-per-minute budget, so the source is shorter there.
 */
export function maxSourceChars(): number {
  return provider() === "groq" ? 6_000 : 15_000;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export class BriefError extends Error {
  /** Set when the LLM provider rate-limited us: seconds to wait before retrying. */
  constructor(message: string, public retryAfter: number | null = null) {
    super(message);
  }
}

async function callLlm(messages: ChatMessage[]): Promise<LlmBrief> {
  let raw: string;
  try {
    raw = await completeJson({
      system: SYSTEM_PROMPT,
      messages,
      schemaName: "breve",
      schema: BRIEF_SCHEMA as unknown as Record<string, unknown>,
    });
  } catch (e) {
    if (e instanceof LlmError) throw new BriefError(e.message, e.retryAfter);
    throw e;
  }
  // Some models wrap JSON in a code fence even in JSON mode.
  const json = raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  const parsed = LlmBrief.safeParse(JSON.parse(json));
  if (!parsed.success) throw new BriefError(`réponse du modèle hors format : ${parsed.error.message.slice(0, 200)}`);
  return parsed.data;
}

/**
 * Downloads the source document, asks the LLM for a brief (retrying once if the
 * length is off), then checks every figure of the brief against the source text.
 */
export async function generateBrief(p: Publication): Promise<Omit<Brief, "id" | "createdAt">> {
  const missing = apiKeyMissing();
  if (missing) throw new BriefError(missing);

  const source = await loadSource(p.documentUrl);
  if (source.error) throw new BriefError(`Source inutilisable : ${source.error}`);

  const limit = maxSourceChars();
  const truncated = source.text.length > limit;
  const messages: ChatMessage[] = [
    { role: "user", content: buildUserPrompt(p, source.text.slice(0, limit), truncated) },
  ];

  let out = await callLlm(messages);
  if (!out.source_suffisante) throw new BriefError(`Le modèle juge la source insuffisante : ${out.texte}`);

  let words = countWords(out.texte);
  if (words < MIN_WORDS || words > MAX_WORDS) {
    messages.push({ role: "assistant", content: JSON.stringify(out) });
    messages.push({ role: "user", content: lengthFeedback(words) });
    out = await callLlm(messages);
    words = countWords(out.texte);
  }

  // Check the text actually published (against the full source), not the figures the model says it used.
  const figures = verifyBrief([out.titre, out.texte, ...out.faits_cles].join("\n"), source.text);

  return {
    publicationId: p.id,
    title: out.titre,
    body: out.texte,
    keyFacts: out.faits_cles,
    figures,
    verification: overallStatus(figures),
    model: modelName(),
    wordCount: words,
  };
}
