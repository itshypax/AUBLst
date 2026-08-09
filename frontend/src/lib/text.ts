// Das Spiel schickt Meldungen teils mit HTML-Entities (&#x1F691 = Emoji)
export function decodeEntities(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/&#x([0-9a-f]+);?/gi, (match, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return match;
      }
    })
    .replace(/&#(\d+);?/g, (match, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return match;
      }
    });
}
