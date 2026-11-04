import { getStore } from "@/lib/store";
import type { FigureStatus } from "@/lib/types";
import { formatDate } from "../format";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<FigureStatus, [string, string]> = {
  verified: ["trouvé dans la source", "badge ok"],
  approximate: ["arrondi d'un chiffre source", "badge"],
  not_found: ["introuvable dans la source", "badge bad"],
  unverifiable: ["non vérifiable", "badge warn"],
};

const OVERALL: Record<string, [string, string]> = {
  ok: ["Chiffres vérifiés", "badge ok"],
  review: ["À relire : chiffre(s) non retrouvé(s)", "badge bad"],
  unverifiable: ["Source illisible, non vérifiable", "badge warn"],
};

export default async function BriefsPage() {
  const briefs = await getStore().listBriefs();

  return (
    <>
      <div className="kicker">Brèves vérifiées</div>
      <h1>Brèves générées</h1>
      <p className="lede">
        Chaque chiffre de la brève est extrait automatiquement puis recherché dans le texte du PDF source
        (même valeur à la précision affichée, unité compatible). Un chiffre introuvable est signalé : il a pu
        être calculé, mal lu ou inventé par le modèle.
      </p>

      {briefs.length === 0 ? (
        <div className="panel empty">
          Aucune brève pour l&apos;instant. Générez-en depuis la page <a href="/selection">Sélection</a>.
        </div>
      ) : (
        <div className="grid">
          {briefs.map((b) => {
            const [label, cls] = OVERALL[b.verification] ?? OVERALL.review;
            return (
              <article className="card" key={b.id}>
                <div className="meta">
                  <span className={cls}>{label}</span>
                  <span>{b.publication.company}</span>
                  <span>{formatDate(b.publication.publishedAt)}</span>
                  <span>{b.wordCount} mots</span>
                </div>
                <h2>{b.title}</h2>
                <p className="body">{b.body}</p>
                {b.keyFacts.length > 0 && (
                  <>
                    <strong>Faits clés</strong>
                    <ul>{b.keyFacts.map((f) => <li key={f}>{f}</li>)}</ul>
                  </>
                )}
                {b.figures.length > 0 && (
                  <table className="figures">
                    <thead>
                      <tr><th>Chiffre</th><th>Contrôle</th></tr>
                    </thead>
                    <tbody>
                      {b.figures.map((f) => {
                        const [l, c] = STATUS_LABEL[f.status];
                        return (
                          <tr key={f.figure}>
                            <td><strong>{f.figure}</strong></td>
                            <td>
                              <span className={c}>{l}</span>
                              {f.note && <div className="evidence">{f.note}</div>}
                              {f.evidence && <div className="evidence">« {f.evidence} »</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <p className="status-line">
                  <a href={b.publication.documentUrl} target="_blank" rel="noreferrer">Document source (PDF)</a>
                  {" · "}généré par {b.model}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
