import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { BriefError, generateBrief } from "@/lib/briefs/generate";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/briefs/generate  { "publicationId": "083653_20261104", "force": false }
 * One publication per call: keeps each request short and lets the UI show progress.
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { publicationId?: string; force?: boolean };
  if (!body.publicationId) return NextResponse.json({ error: "publicationId requis" }, { status: 400 });

  const store = getStore();
  const pub = await store.getPublication(body.publicationId);
  if (!pub) return NextResponse.json({ error: "publication inconnue" }, { status: 404 });

  // Avoid paying twice for the same brief.
  const existing = await store.getBriefByPublication(pub.id);
  if (existing && !body.force) return NextResponse.json({ brief: existing, cached: true });

  try {
    const draft = await generateBrief(pub);
    const brief = await store.saveBrief({
      ...draft,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ brief, cached: false });
  } catch (e) {
    if (e instanceof BriefError && e.retryAfter) {
      // Rate limited by the LLM provider: tell the client how long to wait.
      return NextResponse.json(
        { error: e.message, retryAfter: e.retryAfter },
        { status: 429, headers: { "retry-after": String(e.retryAfter) } },
      );
    }
    const status = e instanceof BriefError ? 422 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
