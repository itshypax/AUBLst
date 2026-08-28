export const STATUS_LABELS: Readonly<Record<number, string>> = {
  0: 'Alarmiert',
  1: 'Einsatzbereit Funk',
  2: 'Einsatzbereit Wache',
  3: 'Einsatz übernommen',
  4: 'An Einsatzstelle',
  5: 'Sprechwunsch',
  6: 'Nicht einsatzbereit',
  7: 'Patient aufgenommen',
  8: 'Am Transportziel',
  9: 'Sonderstatus',
};

export function statusCode(value: number | string): number | null {
  if (String(value).trim().toUpperCase() === 'C') return 0;
  const code = Number(value);
  return Number.isFinite(code) ? code : null;
}

export function statusDisplay(value: number | string): string {
  return statusCode(value) === 0 ? 'C' : String(value);
}

export function statusLabel(value: number | string): string {
  const code = statusCode(value);
  return code === null ? `Status ${value}` : (STATUS_LABELS[code] ?? `Status ${statusDisplay(value)}`);
}
