import type { ScryfallCard } from './types';

/** Lookup key for a card name: case-, quote- and whitespace-insensitive. */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s*\/\/?\s*/g, ' // ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** "Front // Back" -> "Front". Scryfall's collection endpoint only matches the front face. */
export function frontFace(name: string): string {
  return name.split(' // ')[0];
}

/** Every key a card can be looked up by: its full name and each face name. */
export function cardKeys(card: ScryfallCard): string[] {
  const keys = [nameKey(card.name)];
  for (const f of card.card_faces ?? []) keys.push(nameKey(f.name));
  return [...new Set(keys)];
}

/** Oracle text across faces, joined the way Scryfall prints it. */
export function oracleText(card: ScryfallCard): string {
  if (card.oracle_text !== undefined) return card.oracle_text;
  return (card.card_faces ?? []).map((f) => f.oracle_text ?? '').join('\n//\n');
}

/** The face that is actually played (front face for transforming/modal cards). */
export function playedFace(card: ScryfallCard) {
  const f = card.card_faces?.[0];
  return {
    mana_cost: card.mana_cost ?? f?.mana_cost ?? '',
    type_line: f?.type_line ?? card.type_line,
    power: card.power ?? f?.power,
    toughness: card.toughness ?? f?.toughness,
    oracle_text: card.card_faces ? (f?.oracle_text ?? '') : (card.oracle_text ?? ''),
  };
}

export function isBasicLand(card: ScryfallCard): boolean {
  return /\bBasic\b.*\bLand\b/.test(card.type_line);
}
