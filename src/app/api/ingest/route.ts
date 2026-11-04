import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { ingest } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days") ?? 5), 1), 14);
  try {
    return NextResponse.json(await ingest(days));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

// POST from the UI button, GET from Vercel Cron.
export const POST = handle;
export const GET = handle;
