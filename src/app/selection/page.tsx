import { getStore } from "@/lib/store";
import { SELECTION_THRESHOLD, pickTop } from "@/lib/selection/score";
import { GenerateButtons, TokenField } from "../admin-actions";
import { formatDate } from "../format";

export const dynamic = "force-dynamic";

const TOP_N = 5;

export default async function SelectionPage() {
  const store = getStore();
  const pubs = await store.listPublications({ selectedOnly: true, hideTranslations: true });
  // Re-rank with the "one per company" rule; all candidates are shown below the top picks.
  const top = pickTop(pubs, TOP_N);
  const topIds = new Set(top.map((t) => t.publication.id));
  const briefs = await store.listBriefs();
  const hasBrief = new Set(briefs.map((b) => b.publicationId));
  const others = pubs
    .filter((p) => !topIds.has(p.id))
    .sort((a, b) => b.selection.score - a.selection.score);

  return (
    <>
      <div className="kicker">Score éditorial</div>
      <h1>Sélection éditoriale</h1>
      <p className="lede">
        Chaque publication reçoit un score explicable : nature réglementaire du dépôt, mots-clés du titre
        (résultats, acquisition, commande, perspectives…), présence d&apos;un chiffre, appartenance au CAC 40, et
        pénalités (publications récurrentes, titres génériques, correctifs). Seuil : {SELECTION_THRESHOLD} points.
        Les {TOP_N} meilleures, une par société, sont proposées pour une brève.
      </p>

      <div className="panel actions">
        <GenerateButtons
          ids={top.filter((t) => !hasBrief.has(t.publication.id)).map((t) => t.publication.id)}
          label={`Générer les brèves manquantes (top ${TOP_N})`}
        />
        <TokenField />
      </div>

      {top.length === 0 ? (
        <div className="panel empty">Aucune publication retenue. Récupérez d&apos;abord des données.</div>
      ) : (
        <div className="grid">
          {top.map(({ publication: p, selection: s }) => (
            <article className="card" key={p.id}>
              <div className="meta">
                <span className="badge brand">score {s.score}</span>
                <span>{formatDate(p.publishedAt)}</span>
                <span>{p.subtype}</span>
              </div>
              <h2>{p.company}</h2>
              <p className="body">
                <a href={p.documentUrl} target="_blank" rel="noreferrer">{p.title}</a>
              </p>
              <ul className="reasons">
                {s.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
              {hasBrief.has(p.id) ? (
                <a href="/briefs">Brève disponible →</a>
              ) : (
                <GenerateButtons ids={[p.id]} label="Générer la brève" secondary />
              )}
            </article>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Autres publications au-dessus du seuil ({others.length})</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Score</th><th>Société</th><th>Titre</th><th>Raisons</th><th></th></tr>
              </thead>
              <tbody>
                {others.map((p) => (
                  <tr key={p.id}>
                    <td><span className="badge">{p.selection.score}</span></td>
                    <td className="company">{p.company}</td>
                    <td><a href={p.documentUrl} target="_blank" rel="noreferrer">{p.title}</a></td>
                    <td className="type">{p.selection.reasons.join(" · ")}</td>
                    <td>
                      {hasBrief.has(p.id) ? "✓" : <GenerateButtons ids={[p.id]} label="Générer" secondary />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
