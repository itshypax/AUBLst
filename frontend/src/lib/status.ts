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

// Zusatz zur Anzeige: Spielstatus für "2C" (alarmiert, laut Spiel noch auf 2)
// und Sprechaufforderung für "3J". C hat Vorrang vor J.
export interface StatusExtras {
  gameStatus?: number | null;
  called?: boolean;
}

export function statusCode(value: number | string): number | null {
  if (String(value).trim().toUpperCase() === 'C') return 0;
  const code = Number(value);
  return Number.isFinite(code) ? code : null;
}

export function statusDisplay(value: number | string, extra: StatusExtras = {}): string {
  if (statusCode(value) === 0) {
    const game = extra.gameStatus == null ? NaN : Number(extra.gameStatus);
    return Number.isFinite(game) && game !== 0 ? `${game}C` : 'C';
  }
  if (extra.called) return `${value}J`;
  return String(value);
}

export function statusLabel(value: number | string, extra: StatusExtras = {}): string {
  const code = statusCode(value);
  if (code !== 0 && extra.called) return 'Sprechaufforderung';
  return code === null ? `Status ${value}` : (STATUS_LABELS[code] ?? `Status ${statusDisplay(value)}`);
}

export function statusClass(value: number | string, called = false): string {
  const code = statusCode(value);
  if (code === null) return 'status-unknown';
  if (code === 0) return 'status-0';
  return called ? 'status-called' : `status-${code}`;
}
