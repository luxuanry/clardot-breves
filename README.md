# Brèves AMF

Petite application full stack qui récupère les informations réglementées publiées sur
[info-financiere.gouv.fr](https://www.info-financiere.gouv.fr/), sélectionne celles qui méritent un
article, rédige des brèves avec un LLM et contrôle que les chiffres des brèves figurent bien dans le
document source.

- Application déployée : `<URL Vercel à compléter>`
- Dépôt : `<URL GitHub à compléter>`

## Démarrage

```bash
npm install
cp .env.example .env.local   # renseigner Supabase et la clé Anthropic
npm run dev                  # http://localhost:3000
npm test                     # 21 tests unitaires et d'intégration
```

Sans variables Supabase, l'application fonctionne en mode démo (stockage en mémoire du serveur).
Avec `AMF_USE_FIXTURE=1`, l'ingestion rejoue un instantané réel de l'API (100 publications du 3 et
4 novembre 2026, dans `fixtures/`), utile hors ligne.

Déploiement : exécuter `supabase/schema.sql` dans l'éditeur SQL Supabase, importer le dépôt dans
Vercel, renseigner les variables de `.env.example`. Un cron Vercel (`vercel.json`) relance l'ingestion
chaque matin.

## Parcours

1. **Publications** : bouton « Récupérer » (2 à 7 derniers jours), puis liste filtrable par société,
   type d'information, dates, publications retenues ; chaque titre renvoie au PDF source.
2. **Sélection** : les 5 publications les mieux notées (une par société), avec le détail du score,
   puis les autres candidates au-dessus du seuil.
3. **Brèves** : brèves générées, avec pour chaque chiffre son statut de vérification et l'extrait
   source correspondant.

## Choix techniques

| Besoin | Choix | Raison |
|---|---|---|
| Front et API | Next.js 16 (App Router), React 19, TypeScript | Un seul projet pour les pages et les routes API, déploiement direct sur Vercel. Pages rendues côté serveur, filtres en simples paramètres d'URL (partageables, sans état client). |
| Stockage | Supabase (Postgres) | Demandé par l'équipe, upsert idempotent sur l'identifiant AMF. Accès uniquement côté serveur avec la clé service, RLS activé sans politique publique. |
| LLM | API Anthropic, sorties structurées (`json_schema`) | La réponse respecte un schéma JSON, validé ensuite avec Zod : pas de parsing de texte libre. Modèle configurable par variable d'environnement. |
| Lecture PDF | `unpdf` (pdf.js) | Fonctionne en environnement serverless, sans binaire système. |
| Sélection et vérification | Règles déterministes en TypeScript | Explicables, testables, gratuites. Le LLM ne sert qu'à la rédaction. |
| Tests | Vitest | Tests sur des données réelles de l'API (fixture) et sur un PDF de test. |

Architecture (`src/lib`) :

```
amf/client.ts        appel paginé de l'API Opendatasoft
amf/normalize.ts     nettoyage des enregistrements, détection des traductions FR/EN
selection/score.ts   score éditorial explicable
briefs/source.ts     téléchargement et extraction du texte PDF
briefs/prompt.ts     prompts et schéma JSON
briefs/generate.ts   appel LLM, contrôle de longueur, vérification
verify/numbers.ts    extraction et rapprochement des chiffres
store/index.ts       Supabase ou mémoire, même interface
```

## Compréhension de la structure des données

L'API indiquée sur data.gouv.fr est une API Opendatasoft (Explore v2). Le jeu de données utile est
`flux-amf-new-prod` (environ 540 000 enregistrements), interrogé ainsi :

```
GET https://www.info-financiere.gouv.fr/api/explore/v2.1/catalog/datasets/flux-amf-new-prod/records
    ?where=uin_dat_amf >= date'…' and uin_dat_amf < date'…'
    &order_by=uin_dat_amf desc&limit=100&offset=…
```

J'ai d'abord lu quelques enregistrements bruts, puis utilisé les agrégations de l'API (`group_by`,
`count(*)`) pour voir la distribution des types sur une semaine (environ 530 dépôts sur 6 jours).

**Un enregistrement = un dépôt réglementé**, pas un article : métadonnées + lien vers le document
(`url_de_recuperation`, presque toujours un PDF). Le contenu chiffré n'est que dans le PDF.

Champs retenus :

| Champ source | Usage |
|---|---|
| `uin_idt_uin` | identifiant unique, clé primaire |
| `uin_dat_amf` | horodatage du dépôt, filtre de période |
| `identificationsociete_iso_nom_soc`, `_cd_isi`, `_cd_lei` | société, ISIN, LEI |
| `type_d_information`, `sous_type_d_information` | catégorie et sous-type réglementaires |
| `informationdeposee_inf_tit_inf` | titre libre saisi par l'émetteur |
| `informationdeposee_inf_lng_inf` | langue (« Français », « Anglais ») |
| `cac40` | appartenance au CAC 40 |
| `informationdeposee_inf_upg_inf_inf_upg_sts` / `_rel` | `NEW` ou correctif (`REC`) et dépôt corrigé |

Imperfections constatées et traitement :

- **Doublons de langue** : la plupart des communiqués existent en français et en anglais, en deux
  dépôts distincts à quelques minutes d'intervalle (33 traductions sur 100 dans l'échantillon). Je les
  rapproche (même société, même sous-type, langues différentes, moins de 30 minutes) et la version
  française est seule affichée et notée. Limite : deux communiqués différents du même sous-type
  déposés en même temps par la même société pourraient être mal appariés.
- **Doublons exacts** : certaines sociétés redéposent le même communiqué (ex. ACHETER-LOUER.FR la
  veille au soir puis le matin). La sélection garde une seule publication par société.
- **ISIN factice** : `999999999999` pour certains émetteurs (ex. BANQUE STELLANTIS FRANCE). Un ISIN qui
  ne respecte pas le format est remplacé par `null`.
- **Type vide** : quelques dépôts n'ont ni type ni sous-type ; ils sont classés « Non classé ».
- **`cac40` incohérent** : `"1"`, `"0"` ou `null` ; seul `"1"` est considéré comme CAC 40.
- **Titres génériques** : beaucoup de titres répètent la catégorie (« Informations privilégiées /
  Autres communiqués ») et ne disent rien du contenu.
- **Sous-type très large** : « Informations privilégiées » représente environ la moitié des dépôts et
  mélange résultats, contrats, lancements de produits, nominations, opérations de trésorerie.
- **Correctifs** : statut `REC` avec référence au dépôt corrigé ; signalés dans l'interface.
- **Documents** : PDF hébergés sur `fr.ftp.opendatasoft.com`, sans en-têtes CORS : ils sont donc
  téléchargés côté serveur. Les archives ESEF (non PDF) ne sont pas traitées.

Contraintes de l'API : 100 résultats maximum par appel, offset plafonné à 10 000, 10 000 appels par
jour et par IP. Quelques jours représentent quelques centaines de dépôts, soit moins de 10 appels.

## Critère de sélection des publications

Un score additif, calculé à l'ingestion et affiché avec ses raisons (`src/lib/selection/score.ts`).
Le principe : une brève a de la valeur si l'information est nouvelle, concrète et intéresse des
lecteurs.

| Signal | Points |
|---|---|
| Sous-type : offre publique +4 ; informations privilégiées, information trimestrielle, rumeurs +3 ; rapports annuels et semestriels, franchissement de seuil +2 | -3 à +4 |
| Sous-types récurrents (droits de vote, rachats d'actions propres, État membre d'origine, modalités de mise à disposition) | -2 à -3 |
| Mots-clés du titre (FR et EN) : opération stratégique +3 ; résultats ou chiffre d'affaires, contrat ou commande, perspectives ou alerte, opération sur le capital ou la dette +2 ; gouvernance +1 | cumulables |
| Chiffre dans le titre (montant, pourcentage) | +1 |
| Société du CAC 40 | +2 |
| Titre de publication récurrente (actions propres, droits de vote) | -2, et mots-clés ignorés |
| Remboursement anticipé d'obligations | -2 |
| Titre générique | -2 |
| Correctif | -1 |
| Traduction d'un dépôt déjà présent | exclue |

Seuil : 5 points. Sur l'échantillon réel de 100 dépôts, 14 sont retenus. Le top 5 (une publication
par société) : genOway (objectif de croissance), ROCTOOL (commande de 6,5 M€), HERIGE (chiffre
d'affaires), OENEO (chiffre d'affaires semestriel), HOPIUM (restructuration de dette).

Pourquoi des règles plutôt qu'un LLM : la décision est reproductible, explicable ligne par ligne,
gratuite sur des centaines de dépôts, et testée. Limite assumée : le score ne lit que les
métadonnées ; un communiqué au titre générique peut contenir une vraie information.

## Contrôle de l'exactitude des chiffres

Principe : ne pas demander au modèle s'il a raison, mais vérifier mécaniquement le texte publié
(`src/lib/verify/numbers.ts`).

1. Le texte du PDF est extrait côté serveur. S'il est vide ou très court (PDF scanné), la brève est
   marquée « non vérifiable ».
2. Tous les chiffres de la brève (titre, texte, faits clés) sont extraits par expression régulière,
   avec leur échelle (k, M, Md, millions, milliards) et leur unité (%, €, $, £, EUR...). Les années et
   petits entiers sans unité (« 3e trimestre », « 9 mois ») sont ignorés.
3. Les nombres sont normalisés : formats français et anglais (`1 234,5`, `1,234.5`, `750.000.000`),
   espaces insécables. Un séparateur ambigu (`1,234`) donne deux lectures possibles.
4. Chaque chiffre de la brève est comparé aux chiffres du PDF :
   - **vérifié** : même valeur à la précision affichée (285 M€ dans la brève, « 285,0 millions
     d'euros » dans la source) ;
   - **arrondi** : la valeur source arrondie donne celle de la brève (97 M€ pour 97,4 M€) ;
   - **introuvable** : aucune valeur compatible dans la source, donc chiffre calculé, mal lu ou inventé ;
   - un pourcentage n'est jamais validé par un montant, et inversement.
5. La brève est « vérifiée » si tous ses chiffres le sont, sinon « à relire ». L'interface affiche
   pour chaque chiffre l'extrait source trouvé, ce qui permet une relecture rapide.

En complément, le prompt interdit les calculs et demande l'extrait source de chaque chiffre ; le lien
vers le document est ajouté par l'application, pas par le modèle, pour éviter une URL inventée.

Limites : le contrôle vérifie la présence d'une valeur, pas son sens (un chiffre juste attribué à la
mauvaise période ou au mauvais périmètre passe le contrôle). Le signe est ignoré volontairement
(« -3 % » s'écrit souvent « baisse de 3 % »), donc une inversion hausse/baisse n'est pas détectée.

## Prompts clés

Les prompts de production sont dans `src/lib/briefs/prompt.ts`.

**1. Prompt système (règles de rédaction)**

> Tu es journaliste financier pour une lettre d'information B2B. [...] N'utilise QUE les informations
> présentes dans le document source fourni. [...] Recopie chaque chiffre exactement comme il apparaît
> dans la source (même valeur, même unité, même période). Ne calcule rien : pas de variation, de total
> ou de conversion que la source ne donne pas. Si la source n'a pas assez de substance pour une brève
> [...], mets "source_suffisante" à false. [...]

L'interdiction explicite de calculer vient du fait que les variations et marges calculées par le
modèle sont la principale source de chiffres introuvables.

**2. Prompt utilisateur (format de la brève)**

> Métadonnées de la publication [...] Document source : `<source>…</source>`. Rédige une brève :
> "titre" de 12 mots maximum avec le nom de la société ; "texte" entre 100 et 150 mots, information
> principale d'abord puis chiffres clés avec leur période ; "faits_cles" 2 à 4 faits ; "chiffres" :
> chaque chiffre utilisé, avec l'extrait exact de la source où il apparaît.

Associé à un schéma JSON imposé par l'API (sorties structurées).

**3. Prompt de correction de longueur**

> Ta brève fait N mots. Réécris-la pour qu'elle fasse entre 100 et 150 mots, avec les mêmes règles
> (aucun chiffre absent de la source).

Le nombre de mots est compté par le code ; une seule relance est faite si la longueur est hors cible.

## Erreur de l'IA détectée

Pendant le développement, assisté par Claude, la première version des règles de sélection proposée
par l'IA plaçait en tête du classement un communiqué de Crédit Agricole S.A. annonçant le
remboursement anticipé d'obligations (score 9). En relisant le classement sur les données réelles,
deux erreurs sont apparues :

- le mot « Révisable » dans « Taux Fixe Révisable » (caractéristique de l'obligation) était compté
  comme une « révision de perspectives » ;
- « remboursement » et « obligations » étaient comptés comme une opération sur le capital, alors qu'un
  remboursement anticipé d'obligations est une opération de trésorerie courante pour une banque.

Correction : le motif ne cible plus que « révision » ou « révisé », et un malus spécifique s'applique
aux remboursements d'obligations. La publication tombe à 4 points, sous le seuil de 5.
Enseignement : une règle écrite par une IA sur la base de mots-clés plausibles doit être relue
contre des données réelles, d'où le test qui imprime le classement de l'échantillon.

`<À compléter : une erreur observée sur une brève générée en production, par exemple un chiffre
signalé « introuvable », avec l'extrait et l'explication.>`

## Améliorations possibles

- **Sélection** : faire lire le début du PDF des titres génériques par un petit modèle pour
  reclasser ; pondérer par la capitalisation ou l'historique de couverture ; détecter les doublons
  par similarité de titre plutôt que par fenêtre de temps.
- **Vérification** : rattacher chaque chiffre à son contexte (période, périmètre) et comparer le
  contexte, pas seulement la valeur ; demander au modèle les citations via l'API de citations et
  vérifier qu'elles existent mot pour mot dans la source ; OCR pour les PDF scannés.
- **Produit** : file d'attente (génération en arrière-plan plutôt que depuis le navigateur),
  validation humaine avant publication, historique des versions de brève, authentification réelle à
  la place du jeton admin.
- **Données** : ingestion incrémentale (depuis le dernier `uin_dat_amf` connu) et traitement des
  correctifs (`REC`) pour mettre à jour une brève existante.
- **Qualité** : jeu d'évaluation de brèves annotées pour mesurer le taux de chiffres introuvables
  selon le modèle et le prompt.

## Temps passé

`<À compléter honnêtement>`
