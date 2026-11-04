# Brèves AMF

Petite application full stack qui récupère les informations réglementées publiées sur
[info-financiere.gouv.fr](https://www.info-financiere.gouv.fr/), sélectionne celles qui méritent un
article, rédige des brèves avec un LLM et contrôle que les chiffres des brèves figurent bien dans le
document source.

- Dépôt : https://github.com/luxuanry/clardot-breves
- Lancer en local : voir « Démarrage » ci-dessous (une clé Groq gratuite suffit pour générer des brèves).

## Démarrage

```bash
npm install
cp .env.example .env.local   # renseigner une clé Groq (gratuite) ou Anthropic, et Supabase
npm run dev                  # http://localhost:3000
npm test                     # 28 tests unitaires et d'intégration
```

Sans variables Supabase, l'application fonctionne en mode démo (stockage en mémoire du serveur, perdu
au redémarrage). Avec `AMF_USE_FIXTURE=1`, l'ingestion rejoue un instantané réel de l'API (100
publications du 3 et 4 novembre 2026, dans `fixtures/`), utile hors ligne.

`npm run dev:clean` arrête un éventuel serveur de développement de ce projet resté actif sur les
ports 3000 à 3010, puis redémarre depuis le bon dossier (`npm run dev:clean -- demo` pour le mode
instantané).

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
| LLM | Groq (palier gratuit, modèle `openai/gpt-oss-120b`) par défaut, Anthropic en option | Une petite couche fournisseur (`briefs/llm.ts`) isole l'appel : le reste du code ne dépend pas du fournisseur. Réponse contrainte par un schéma JSON (`json_schema`), puis validée avec Zod : pas de parsing de texte libre. |
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
briefs/llm.ts        appel Groq ou Anthropic, même interface
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
   avec leur échelle (k, M, Md, millions, milliards) et leur unité (%, €, $, £, EUR...). Les années,
   les petits entiers sans unité (« 3e trimestre », « 9 mois »), les jours du mois (« 30 septembre »)
   et les exercices décalés (« 2026/27 ») sont ignorés.
3. Les nombres sont normalisés : formats français et anglais (`1 234,5`, `1,234.5`, `750.000.000`),
   espaces insécables, notation comptable des montants négatifs (`(1 248) millions d'euros`,
   `(4) %`). Un séparateur ambigu (`1,234`) donne deux lectures possibles.
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

Limites : le contrôle vérifie la présence d'une valeur, pas son sens. Un chiffre juste attribué à la
mauvaise période ou au mauvais périmètre passe le contrôle. Le signe est ignoré volontairement
(« -3 % » s'écrit souvent « baisse de 3 % »), donc une inversion hausse/baisse n'est pas détectée.
Surtout, un contrôle des chiffres ne voit ni une information importante omise, ni une interprétation
ajoutée : les deux erreurs réelles décrites plus bas avaient toutes deux 100 % de chiffres vérifiés.
Une brève marquée « chiffres vérifiés » reste donc à relire par un humain avant publication.

## Prompts clés

Les prompts de production sont dans `src/lib/briefs/prompt.ts`.

**1. Prompt système (règles de rédaction)**

> Tu es journaliste financier pour une lettre d'information B2B. [...] N'utilise QUE les informations
> présentes dans le document source fourni. [...] Reprends chaque chiffre avec la même valeur, la même
> unité et la même période que dans la source. Ne calcule rien. [...] Les montants négatifs notés entre
> parenthèses [...] s'écrivent en clair dans la brève. [...] N'ajoute aucune interprétation ni
> conclusion qui ne soit pas écrite dans la source. [...] Les citations de dirigeants et les
> affirmations promotionnelles sont attribuées à la société. [...] Ne signale pas l'absence d'une
> information.

La plupart de ces règles viennent d'erreurs observées sur de vraies brèves (section suivante) :
l'interdiction de calculer vise les marges et variations recalculées par le modèle, les trois
dernières règles corrigent les erreurs Alstom, ONWARD et Publicis.

**2. Prompt utilisateur (format et hiérarchie de l'information)**

> Métadonnées de la publication [...] Document source : `<source>…</source>`. Rédige une brève :
> "titre" de 12 mots maximum avec le nom de la société ; "texte" entre 100 et 150 mots. Commence par
> l'information la plus importante pour un lecteur [...]. Si le communiqué révise des objectifs ou
> des perspectives, c'est en général l'information principale : donne l'ancien et le nouvel objectif
> tels qu'écrits dans la source. [...] "chiffres" : chaque chiffre utilisé, avec l'extrait exact de la
> source où il apparaît.

Associé à un schéma JSON imposé par l'API (sorties structurées), puis validé avec Zod.

**3. Prompt de correction de longueur**

> Ta brève fait N mots. Réécris-la pour qu'elle fasse entre 100 et 150 mots, avec les mêmes règles
> (aucun chiffre absent de la source).

Le nombre de mots est compté par le code ; une seule relance est faite si la longueur est hors cible.

**Contraintes du palier gratuit Groq.** La limite mesurée est de 8 000 jetons par minute pour
`openai/gpt-oss-120b`, et une requête en réserve environ 2 900 à 3 700 (texte source, raisonnement du
modèle, réponse). Dans la première version, une seule brève passait par minute, et le bouton « générer
le top 5 » échouait pour les quatre suivantes. Ajustements : texte source tronqué à 6 000 caractères
(la vérification se fait toujours sur le PDF complet), budget de sortie réduit à 2 000 jetons,
attente automatique côté interface quand le quota est atteint (délai croissant), et une relance quand
Groq renvoie un JSON vide (`json_validate_failed`, observé sur le communiqué FORVIA).

## Erreur de l'IA détectée

J'ai généré des brèves sur des publications réelles du 2 et 3 novembre 2026, puis relu chacune face à
son PDF. Les chiffres étaient presque toujours corrects ; les erreurs significatives portaient sur la
hiérarchie de l'information et sur des interprétations ajoutées, ce que le contrôle automatique ne voit
pas.

### Erreur principale : Alstom, l'information principale omise

Publication : *Résultats préliminaires d'Alstom pour le premier semestre de l'exercice fiscal 2026/27*
(2 novembre 2026).

- **Source** : dès le sous-titre, « Perspectives 2026/27 ajustées en raison de certaines difficultés
  d'exécution en Europe ». La marge d'exploitation ajustée attendue passe d'environ 6,5 % à environ
  1 %, le cash-flow libre attendu d'une génération « positive » à (1,5) milliard d'euros.
- **Brève générée** : titre « Alstom publie résultats semestre 2026/27 : chiffre d'affaires 9,3 Mds € »,
  texte centré sur le chiffre d'affaires et les commandes. **L'abaissement des objectifs n'apparaît
  nulle part.** Le texte reprend aussi la notation comptable telle quelle (« marge d'environ (4) % »,
  « free cash-flow négatif de (1 248) millions »), peu lisible et ambiguë pour un lecteur.
- **Contrôle automatique** : 9 chiffres sur 9 retrouvés dans la source, brève marquée « vérifiée ».
  C'est ce qui rend l'erreur intéressante : la brève était exacte chiffre par chiffre, mais trompeuse.
- **Détection** : relecture de la brève face au PDF.
- **Cause** : le prompt demandait de commencer par « l'information principale » sans dire ce que c'est
  pour un communiqué financier, et demandait de « recopier chaque chiffre exactement comme il apparaît »,
  ce qui a poussé le modèle à recopier les parenthèses.
- **Correction** : le prompt désigne les révisions d'objectifs comme information principale probable,
  demande l'ancien et le nouvel objectif, et impose d'écrire les montants négatifs en clair. Le
  contrôle des chiffres lit désormais la notation comptable (tests ajoutés). Après correction, la
  brève titre « Alstom révise à la baisse ses perspectives 2026/27 », donne les anciens et nouveaux
  objectifs, et ses 15 chiffres sont retrouvés dans la source.

### Deuxième erreur : ONWARD Medical, interprétation ajoutée

Publication en anglais : *ONWARD Medical Delivers Revenue of EUR 2.5M in Q3 2026* (3 novembre 2026).

- **Source** : « An initial EUR 20M was drawn at closing to fully repay all outstanding amounts and
  retire the Company's former financing agreement », soit un refinancement de dette existante.
- **Brève générée** : « 20 M€ […] débloqué […], renforçant ainsi la solidité financière de
  l'entreprise », puis « Ces opérations illustrent la capacité de l'entreprise à financer ses
  initiatives tout en maintenant une discipline financière stricte ». La première conclusion n'est pas
  dans la source ; la seconde reprend une citation du directeur général (« maintaining financial
  discipline ») présentée comme un constat du journaliste, avec « stricte » en plus.
- **Contrôle automatique** : tous les chiffres retrouvés.
- **Correction** : règles « aucune interprétation absente de la source » et « attribuer citations et
  affirmations promotionnelles à la société ». Après correction, la brève ouvre sur le chiffre
  d'affaires du trimestre et indique que les 20 M€ servent « à rembourser son précédent financement ».

### Autres observations

- **Effet de bord de ma propre correction** (Publicis) : après l'ajout de la règle sur les objectifs,
  le modèle a conclu une brève par « Aucun changement d'objectif financier n'est indiqué dans le
  communiqué », phrase de remplissage. Il reprenait aussi « le premier AI growth engine du secteur »
  sans l'attribuer. Règle ajoutée : ne pas signaler l'absence d'une information. Enseignement : chaque
  modification de prompt doit être relue sur plusieurs communiqués, pas seulement sur celui qui l'a
  motivée.
- **Limite restante** (FORVIA) : le titre « finalise la cession d'Interiors » laisse penser que
  l'opération est faite, alors que la source annonce une clôture au quatrième trimestre. Une erreur de
  temps verbal que ni le prompt ni le contrôle ne couvrent aujourd'hui.

### Erreur de l'IA pendant le développement

Le code a été écrit avec l'aide de Claude. La première version des règles de sélection proposée par
l'IA plaçait en tête un communiqué de Crédit Agricole S.A. annonçant le remboursement anticipé
d'obligations (score 9) : le mot « Révisable » dans « Taux Fixe Révisable » était compté comme une
« révision de perspectives », et le remboursement d'obligations comme une opération sur le capital.
Correction : motif limité à « révision » ou « révisé », malus pour les remboursements d'obligations ;
la publication tombe à 4 points, sous le seuil de 5. Enseignement : une règle écrite par une IA à
partir de mots-clés plausibles doit être relue face à des données réelles.

## Améliorations possibles

- **Sélection** : faire lire le début du PDF des titres génériques par un petit modèle pour
  reclasser ; pondérer par la capitalisation ou l'historique de couverture ; détecter les doublons
  par similarité de titre plutôt que par fenêtre de temps.
- **Vérification** : rattacher chaque chiffre à son contexte (période, périmètre) et comparer le
  contexte, pas seulement la valeur ; demander au modèle les citations via l'API de citations et
  vérifier qu'elles existent mot pour mot dans la source ; OCR pour les PDF scannés.
- **Contrôle du sens, au-delà des chiffres** : les erreurs observées (information principale omise,
  interprétation ajoutée, temps verbal) passent le contrôle des chiffres. Pistes : un second appel qui
  vérifie, phrase par phrase, que chaque affirmation de la brève est soutenue par un extrait de la
  source ; une règle simple qui alerte quand la source contient « perspectives ajustées / objectifs
  révisés » et que la brève ne parle pas d'objectifs ; une relecture humaine obligatoire avant
  publication.
- **Produit** : file d'attente (génération en arrière-plan plutôt que depuis le navigateur),
  validation humaine avant publication, historique des versions de brève, authentification réelle à
  la place du jeton admin.
- **Données** : ingestion incrémentale (depuis le dernier `uin_dat_amf` connu) et traitement des
  correctifs (`REC`) pour mettre à jour une brève existante.
- **Qualité** : jeu d'évaluation de brèves annotées (les cas Alstom, ONWARD, Publicis et FORVIA en
  seraient le point de départ) pour mesurer l'effet de chaque changement de prompt ou de modèle, au
  lieu de juger sur un seul communiqué.

## Temps passé

`<À compléter : temps réel, en distinguant si possible compréhension des données, développement assisté
par IA, tests sur données réelles et rédaction du README.>`
