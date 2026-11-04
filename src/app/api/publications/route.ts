import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET /api/publications?company=&subtype=&from=YYYY-MM-DD&to=YYYY-MM-DD&selected=1 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const pubs = await getStore().listPublications({
    company: sp.get("company") || undefined,
    subtype: sp.get("subtype") || undefined,
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    selectedOnly: sp.get("selected") === "1",
    hideTranslations: sp.get("translations") !== "1",
  });
  return NextResponse.json({ count: pubs.length, results: pubs });
}
