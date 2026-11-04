"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const TOKEN_KEY = "admin-token";

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Error carrying the server's retry delay when the LLM quota is reached. */
export class RateLimitError extends Error {
  constructor(message: string, public retryAfter: number) {
    super(message);
  }
}

/** Shared fetch helper adding the optional admin token. */
export async function adminFetch(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": readToken() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw new RateLimitError(data.error ?? "quota atteint", Number(data.retryAfter) || 30);
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Max waits on the free-tier quota for one brief before giving up. */
const MAX_RATE_LIMIT_RETRIES = 4;

export function TokenField() {
  const [token, setToken] = useState("");
  useEffect(() => setToken(readToken()), []);
  return (
    <input
      type="password"
      placeholder="Jeton admin (si requis)"
      value={token}
      onChange={(e) => {
        setToken(e.target.value);
        try {
          localStorage.setItem(TOKEN_KEY, e.target.value);
        } catch {
          /* storage unavailable: token only lives in this field */
        }
      }}
      aria-label="Jeton admin"
    />
  );
}

export function IngestButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [days, setDays] = useState(5);

  async function run() {
    setBusy(true);
    setMsg("Récupération en cours…");
    try {
      const r = await adminFetch(`/api/ingest?days=${days}`);
      setMsg(
        `${r.fetched} publications récupérées, ${r.translations} traductions détectées, ${r.selected} retenues pour un article.`,
      );
      router.refresh();
    } catch (e) {
      setMsg(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="actions">
      <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Période">
        {[2, 3, 5, 7].map((d) => (
          <option key={d} value={d}>{d} derniers jours</option>
        ))}
      </select>
      <button onClick={run} disabled={busy}>Récupérer depuis info-financière</button>
      <TokenField />
      {msg && <span className="status-line">{msg}</span>}
    </div>
  );
}

export function GenerateButtons({
  ids,
  label,
  secondary = false,
}: {
  ids: string[];
  label: string;
  secondary?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setBusy(true);
    const errors: string[] = [];
    // Sequential on purpose: one LLM call at a time, progress visible.
    // On the free tier the tokens-per-minute quota is reached after about one brief,
    // so we wait for the delay given by the provider and retry.
    for (const [i, id] of ids.entries()) {
      for (let attempt = 0; ; attempt++) {
        setMsg(`Génération ${i + 1}/${ids.length}…`);
        try {
          await adminFetch("/api/briefs/generate", { publicationId: id });
          break;
        } catch (e) {
          if (e instanceof RateLimitError && attempt < MAX_RATE_LIMIT_RETRIES) {
            // The advertised delay is often too short for a large request: back off more each time.
            const wait = Math.max(e.retryAfter + 2, 20 * (attempt + 1));
            for (let s = wait; s > 0; s--) {
              setMsg(`Génération ${i + 1}/${ids.length} : quota gratuit atteint, nouvel essai dans ${s} s…`);
              await sleep(1000);
            }
            continue;
          }
          errors.push(`${id} : ${(e as Error).message}`);
          break;
        }
      }
    }
    setBusy(false);
    setMsg(errors.length ? `Terminé avec ${errors.length} erreur(s). ${errors.join(" · ")}` : "Terminé.");
    router.refresh();
  }

  return (
    <span className="actions">
      <button className={secondary ? "secondary" : undefined} onClick={run} disabled={busy || ids.length === 0}>
        {label}
      </button>
      {msg && <span className="status-line">{msg}</span>}
    </span>
  );
}
