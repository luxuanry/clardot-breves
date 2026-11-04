import { getStore } from "@/lib/store";
import type { FigureCheck, FigureStatus } from "@/lib/types";
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
  review: ["À relire", "badge bad"],
  unverifiable: ["Non vérifiable", "badge warn"],
};

const isProblem = (f: FigureCheck) => f.status === "not_found" || f.status === "unverifiable";

function FigureItem({ f }: { f: FigureCheck }) {
  const [label, cls] = STATUS_LABEL[f.status];
  return (
    <li className="fig">
      <div className="fig-head">
        <strong>{f.figure}</strong>
        <span className={cls}>{label}</span>
      </div>
      {f.note && <div className="fig-note">{f.note}</div>}
      {f.evidence && <blockquote className="fig-evidence">{f.evidence}</blockquote>}
    </li>
  );
}

export default async function BriefsPage() {
  const briefs = await getStore().listBriefs();

  return (
    <div className="reading">
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
        briefs.map((b) => {
          const [label, cls] = OVERALL[b.verification] ?? OVERALL.review;
          const problems = b.figures.filter(isProblem);
          const ok = b.figures.filter((f) => !isProblem(f));
          return (
            <article className="brief" key={b.id}>
              <div className="brief-meta">
                <span className={cls}>{label}</span>
                <span className="company">{b.publication.company}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={b.publication.publishedAt}>{formatDate(b.publication.publishedAt)}</time>
              </div>

              <h2>{b.title}</h2>
              <p className="brief-body">{b.body}</p>

              {b.keyFacts.length > 0 && (
                <aside className="facts">
                  <h3>Faits clés</h3>
                  <ul>{b.keyFacts.map((f) => <li key={f}>{f}</li>)}</ul>
                </aside>
              )}

              {b.figures.length > 0 && (
                <section className="checks" aria-label="Contrôle des chiffres">
                  <p className="checks-summary">
                    <strong>Contrôle des chiffres :</strong> {ok.length} sur {b.figures.length} retrouvé(s)
                    dans la source
                    {problems.length > 0 && <>, <span className="bad-text">{problems.length} à vérifier</span></>}.
                  </p>
                  {problems.length > 0 && (
                    <ul className="fig-list">{problems.map((f) => <FigureItem key={f.figure} f={f} />)}</ul>
                  )}
                  {ok.length > 0 && (
                    <details>
                      <summary>Voir les {ok.length} chiffre(s) retrouvé(s) et leur extrait source</summary>
                      <ul className="fig-list">{ok.map((f) => <FigureItem key={f.figure} f={f} />)}</ul>
                    </details>
                  )}
                </section>
              )}

              <p className="brief-foot">
                <a href={b.publication.documentUrl} target="_blank" rel="noreferrer">Document source (PDF)</a>
                <span aria-hidden="true"> · </span>
                {b.wordCount} mots
                <span aria-hidden="true"> · </span>
                généré par {b.model}
              </p>
            </article>
          );
        })
      )}
    </div>
  );
}
