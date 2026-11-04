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

/** Shared fetch helper adding the optional admin token. */
export async function adminFetch(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": readToken() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

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
    for (const [i, id] of ids.entries()) {
      setMsg(`Génération ${i + 1}/${ids.length}…`);
      try {
        await adminFetch("/api/briefs/generate", { publicationId: id });
      } catch (e) {
        errors.push(`${id} : ${(e as Error).message}`);
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
