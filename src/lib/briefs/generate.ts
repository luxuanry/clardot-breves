import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Brief, Publication } from "@/lib/types";
import { overallStatus, verifyBrief } from "@/lib/verify/numbers";
import { BRIEF_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, lengthFeedback } from "./prompt";
import { MAX_SOURCE_CHARS, loadSource } from "./source";

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

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export class BriefError extends Error {}

function model(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
}

async function callLlm(client: Anthropic, messages: Anthropic.MessageParam[]): Promise<LlmBrief> {
  const res = await client.messages.create({
    model: model(),
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages,
    output_config: { format: { type: "json_schema", schema: BRIEF_SCHEMA } },
  });
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return LlmBrief.parse(JSON.parse(text));
}

/**
 * Downloads the source document, asks the LLM for a brief (retrying once if the
 * length is off), then checks every figure of the brief against the source text.
 */
export async function generateBrief(p: Publication): Promise<Omit<Brief, "id" | "createdAt">> {
  if (!process.env.ANTHROPIC_API_KEY) throw new BriefError("ANTHROPIC_API_KEY manquante");

  const source = await loadSource(p.documentUrl);
  if (source.error) throw new BriefError(`Source inutilisable : ${source.error}`);

  const truncated = source.text.length > MAX_SOURCE_CHARS;
  const sourceText = source.text.slice(0, MAX_SOURCE_CHARS);
  const client = new Anthropic();

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserPrompt(p, sourceText, truncated) },
  ];
  let out = await callLlm(client, messages);
  if (!out.source_suffisante) throw new BriefError(`Le modèle juge la source insuffisante : ${out.texte}`);

  let words = countWords(out.texte);
  if (words < MIN_WORDS || words > MAX_WORDS) {
    messages.push({ role: "assistant", content: JSON.stringify(out) });
    messages.push({ role: "user", content: lengthFeedback(words) });
    out = await callLlm(client, messages);
    words = countWords(out.texte);
  }

  // Check the text actually published, not the figures the model says it used.
  const figures = verifyBrief([out.titre, out.texte, ...out.faits_cles].join("\n"), source.text);

  return {
    publicationId: p.id,
    title: out.titre,
    body: out.texte,
    keyFacts: out.faits_cles,
    figures,
    verification: overallStatus(figures),
    model: model(),
    wordCount: words,
  };
}
