import Anthropic from "@anthropic-ai/sdk";

/**
 * Thin provider layer so the brief generator does not depend on one vendor.
 * - groq: free tier, OpenAI-compatible endpoint, JSON schema outputs (best effort).
 * - anthropic: structured outputs with constrained decoding.
 * The provider is picked from LLM_PROVIDER, or from whichever API key is set.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface JsonRequest {
  system: string;
  messages: ChatMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
}

export type Provider = "groq" | "anthropic";

export class LlmError extends Error {
  /** Seconds to wait before retrying, when the provider says so (rate limit). */
  constructor(message: string, public retryAfter: number | null = null) {
    super(message);
  }
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export function provider(): Provider {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit === "groq" || explicit === "anthropic") return explicit;
  if (process.env.GROQ_API_KEY) return "groq";
  return "anthropic";
}

export function modelName(): string {
  if (provider() === "groq") return process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
}

export function apiKeyMissing(): string | null {
  if (provider() === "groq") return process.env.GROQ_API_KEY ? null : "GROQ_API_KEY manquante";
  return process.env.ANTHROPIC_API_KEY ? null : "ANTHROPIC_API_KEY manquante";
}

/** Returns the raw JSON text produced by the model. */
export async function completeJson(req: JsonRequest, fetchImpl: typeof fetch = fetch): Promise<string> {
  return provider() === "groq" ? groq(req, fetchImpl) : anthropic(req);
}

async function groq(req: JsonRequest, fetchImpl: typeof fetch, attempt = 0): Promise<string> {
  const res = await fetchImpl(GROQ_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: modelName(),
      messages: [{ role: "system", content: req.system }, ...req.messages],
      // gpt-oss models reason before answering; reasoning tokens count in this budget.
      // Kept small: Groq's free tier counts it against the tokens-per-minute quota.
      max_completion_tokens: 2000,
      reasoning_effort: "low",
      response_format: {
        type: "json_schema",
        json_schema: { name: req.schemaName, schema: req.schema },
      },
    }),
  });

  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after")) || null;
    // Groq's message says which limit was hit (tokens or requests, per minute or per day).
    const detail = await res
      .json()
      .then((b: { error?: { message?: string } }) => b.error?.message?.split(". Please")[0] ?? "")
      .catch(() => "");
    throw new LlmError(
      `limite du palier gratuit Groq atteinte${wait ? `, réessayer dans ${wait} s` : ""}${detail ? ` (${detail})` : ""}`,
      wait,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    // "json_validate_failed" with an empty generation: the model used its whole token
    // budget on reasoning. It is not deterministic, so one retry usually succeeds.
    if (res.status === 400 && body.includes("json_validate_failed") && attempt === 0) {
      return groq(req, fetchImpl, 1);
    }
    throw new LlmError(`Groq ${res.status} : ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new LlmError("réponse Groq vide");
  return content;
}

async function anthropic(req: JsonRequest): Promise<string> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: modelName(),
    max_tokens: 1500,
    system: req.system,
    messages: req.messages,
    output_config: { format: { type: "json_schema", schema: req.schema } },
  });
  return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}
