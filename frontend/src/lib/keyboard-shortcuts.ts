export type ShortcutAction =
  | 'toggle-help'
  | 'focus-vehicle-search'
  | 'fit-map'
  | 'toggle-speech-requests'
  | 'open-actions'
  | 'open-overview'
  | 'workspace-1'
  | 'workspace-2'
  | 'workspace-3';

export interface ShortcutDefinition {
  action: ShortcutAction;
  keys: string[];
  label: string;
  group: 'Navigation' | 'Leitstelle';
}

export const SHORTCUTS: ShortcutDefinition[] = [
  { action: 'toggle-help', keys: ['F1', '?'], label: 'Diese Übersicht öffnen', group: 'Navigation' },
  { action: 'workspace-1', keys: ['1'], label: 'Erste Arbeitsansicht öffnen', group: 'Navigation' },
  { action: 'workspace-2', keys: ['2'], label: 'Zweite Arbeitsansicht öffnen', group: 'Navigation' },
  { action: 'workspace-3', keys: ['3'], label: 'Dritte Arbeitsansicht öffnen', group: 'Navigation' },
  { action: 'focus-vehicle-search', keys: ['F'], label: 'Fahrzeugsuche fokussieren', group: 'Leitstelle' },
  { action: 'fit-map', keys: ['M'], label: 'Karte einpassen', group: 'Leitstelle' },
  { action: 'toggle-speech-requests', keys: ['S'], label: 'Sprechwünsche öffnen oder schließen', group: 'Leitstelle' },
  { action: 'open-actions', keys: ['A'], label: 'Aktionen öffnen', group: 'Leitstelle' },
  { action: 'open-overview', keys: ['O'], label: 'Einsatzakte und Statistik öffnen', group: 'Leitstelle' },
];

function editableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function shortcutActionForEvent(event: KeyboardEvent): ShortcutAction | null {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return null;
  const key = event.key.length === 1 ? event.key.toLocaleLowerCase('de') : event.key;
  if (key === 'F1' || (!editableTarget(event.target) && key === '?')) return 'toggle-help';
  if (editableTarget(event.target) || event.shiftKey) return null;

  const actions: Record<string, ShortcutAction> = {
    f: 'focus-vehicle-search',
    m: 'fit-map',
    s: 'toggle-speech-requests',
    a: 'open-actions',
    o: 'open-overview',
    '1': 'workspace-1',
    '2': 'workspace-2',
    '3': 'workspace-3',
  };
  return actions[key] ?? null;
}
