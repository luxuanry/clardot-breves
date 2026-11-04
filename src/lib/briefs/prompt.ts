import type { Publication } from "@/lib/types";

/**
 * Prompts are kept in one file so they can be versioned, reviewed and quoted in the README.
 */

export const SYSTEM_PROMPT = `Tu es journaliste financier pour une lettre d'information B2B. Tu rédiges des brèves factuelles à partir de communiqués réglementés déposés auprès de l'AMF.

Règles impératives :
- N'utilise QUE les informations présentes dans le document source fourni. Aucune connaissance extérieure, aucune supposition sur le contexte de marché ou le cours de bourse.
- Recopie chaque chiffre exactement comme il apparaît dans la source (même valeur, même unité, même période). Ne calcule rien : pas de variation, de total ou de conversion que la source ne donne pas.
- Si la source n'a pas assez de substance pour une brève (document purement administratif, texte illisible), mets "source_suffisante" à false et explique pourquoi dans "texte".
- Ton neutre et factuel, pas de superlatifs ni de recommandation d'investissement.
- Rédige en français, même si la source est en anglais.`;

export function buildUserPrompt(p: Publication, sourceText: string, truncated: boolean): string {
  return `Métadonnées de la publication (issues de l'AMF) :
- Société : ${p.company}${p.isin ? ` (ISIN ${p.isin})` : ""}
- Type : ${p.category} > ${p.subtype}
- Titre déposé : ${p.title}
- Date de dépôt : ${p.publishedAt}

Document source${truncated ? " (tronqué aux premières pages)" : ""} :
<source>
${sourceText}
</source>

Rédige une brève d'actualité :
- "titre" : un titre informatif de 12 mots maximum, avec le nom de la société.
- "texte" : entre 100 et 150 mots. Commence par l'information principale, puis les chiffres clés avec leur période de référence.
- "faits_cles" : 2 à 4 faits essentiels, une phrase courte chacun.
- "chiffres" : chaque chiffre utilisé dans le titre ou le texte, avec l'extrait exact de la source (moins de 25 mots) où il apparaît.
- "source_suffisante" : true ou false.`;
}

/** JSON schema enforced through structured outputs, so parsing never depends on free text. */
export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titre", "texte", "faits_cles", "chiffres", "source_suffisante"],
  properties: {
    titre: { type: "string" },
    texte: { type: "string" },
    faits_cles: { type: "array", items: { type: "string" } },
    chiffres: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["valeur", "extrait_source"],
        properties: {
          valeur: { type: "string" },
          extrait_source: { type: "string" },
        },
      },
    },
    source_suffisante: { type: "boolean" },
  },
} as const;

export function lengthFeedback(words: number): string {
  return `Ta brève fait ${words} mots. Réécris-la pour qu'elle fasse entre 100 et 150 mots, avec les mêmes règles (aucun chiffre absent de la source). Réponds avec le même format JSON.`;
}
