import { getStore } from "@/lib/store";
import { IngestButton } from "./admin-actions";
import { formatDate, scoreClass } from "./format";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function PublicationsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const store = getStore();
  const [pubs, facets] = await Promise.all([
    store.listPublications({
      company: sp.company || undefined,
      subtype: sp.subtype || undefined,
      from: sp.from || undefined,
      to: sp.to || undefined,
      selectedOnly: sp.selected === "1",
      hideTranslations: sp.translations !== "1",
    }),
    store.facets(),
  ]);

  return (
    <>
      <div className="kicker">Flux AMF</div>
      <h1>Publications réglementées</h1>
      <p className="lede">
        Informations déposées par les sociétés cotées auprès de l&apos;AMF, récupérées via l&apos;API open data
        info-financière. Les versions anglaises d&apos;un même communiqué sont masquées par défaut.
      </p>

      <div className="panel">
        <IngestButton />
        {store.mode === "memory" && (
          <p className="status-line">
            Mode démo : Supabase n&apos;est pas configuré, les données sont gardées en mémoire du serveur.
          </p>
        )}
      </div>

      <form className="panel filters" method="get">
        <label>
          Société
          <select name="company" defaultValue={sp.company ?? ""}>
            <option value="">Toutes</option>
            {facets.companies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Type d&apos;information
          <select name="subtype" defaultValue={sp.subtype ?? ""}>
            <option value="">Tous</option>
            {facets.subtypes.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Du
          <input type="date" name="from" defaultValue={sp.from ?? ""} />
        </label>
        <label>
          Au
          <input type="date" name="to" defaultValue={sp.to ?? ""} />
        </label>
        <label className="check">
          <input type="checkbox" name="selected" value="1" defaultChecked={sp.selected === "1"} />
          Retenues seulement
        </label>
        <label className="check">
          <input type="checkbox" name="translations" value="1" defaultChecked={sp.translations === "1"} />
          Afficher les traductions
        </label>
        <button type="submit">Filtrer</button>
        <a className="btn secondary" href="/">Réinitialiser</a>
      </form>

      <p className="status-line">{pubs.length} publication(s)</p>

      {pubs.length === 0 ? (
        <div className="panel empty">Aucune publication. Lancez une récupération ci-dessus.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Société</th>
                <th>Type</th>
                <th>Titre</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {pubs.map((p) => (
                <tr key={p.id}>
                  <td className="date">{formatDate(p.publishedAt)}</td>
                  <td className="company">
                    {p.company}
                    {p.isCac40 && <> <span className="badge">CAC 40</span></>}
                  </td>
                  <td className="type">{p.subtype}</td>
                  <td>
                    <a href={p.documentUrl} target="_blank" rel="noreferrer">{p.title}</a>{" "}
                    {p.language !== "fr" && <span className="badge muted">{p.language.toUpperCase()}</span>}{" "}
                    {p.isCorrection && <span className="badge warn">correctif</span>}
                  </td>
                  <td>
                    <span className={scoreClass(p.selection.score, p.selection.selected)} title={p.selection.reasons.join("\n")}>
                      {p.selection.score}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
