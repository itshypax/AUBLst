<script lang="ts">
  import { X } from 'lucide-svelte';
  import type { EventCategory } from '../../lib/classify';
  import { dismissible } from '../../lib/dismissible-details';
  import StatusBadge from '../StatusBadge.svelte';

  const CATEGORY_LABELS: Record<EventCategory, string> = {
    fire: 'Brand',
    hazard: 'Gefahrgut',
    water: 'Wasser',
    thl: 'Hilfeleistung',
    medical: 'Rettungsdienst',
    other: 'Sonstige',
  };
  const CATEGORIES = Object.keys(CATEGORY_LABELS) as EventCategory[];
  const STATUS_LABELS = ['Alarmiert', 'Einsatzbereit Funk', 'Einsatzbereit Wache', 'Einsatz übernommen', 'An Einsatzstelle', 'Sprechwunsch', 'Nicht einsatzbereit', 'Patient aufgenommen', 'Am Transportziel'];

  let {
    showVehicles,
    showEvents,
    hiddenStatuses,
    hiddenCategories,
    hiddenStations,
    stations,
    categoryColor,
    onShowVehiclesChange,
    onShowEventsChange,
    onToggleStatus,
    onToggleCategory,
    onToggleStation,
    onReset,
    onClose,
  }: {
    showVehicles: boolean;
    showEvents: boolean;
    hiddenStatuses: Set<number>;
    hiddenCategories: Set<EventCategory>;
    hiddenStations: Set<string>;
    stations: string[];
    categoryColor: (category: EventCategory) => string;
    onShowVehiclesChange: (checked: boolean) => void;
    onShowEventsChange: (checked: boolean) => void;
    onToggleStatus: (status: number) => void;
    onToggleCategory: (category: EventCategory) => void;
    onToggleStation: (station: string) => void;
    onReset: () => void;
    onClose: () => void;
  } = $props();

  function stop(event: Event): void {
    event.stopPropagation();
  }
</script>

<div
  class="map-filters"
  onpointerdown={stop}
  onpointerup={stop}
  onclick={stop}
  onkeydown={stop}
  oncontextmenu={stop}
  role="dialog"
  aria-label="Kartenfilter"
  tabindex="-1"
  use:dismissible={{
    onDismiss: onClose,
    ignore: (target) => target instanceof Element && Boolean(target.closest('[data-map-filters-trigger]')),
  }}
>
  <div class="filter-head"><strong>Kartenfilter</strong><button class="ghost" data-tooltip="Schließen" aria-label="Kartenfilter schließen" onclick={onClose}><X size={14} /></button></div>
  <div class="filter-section two">
    <label><input type="checkbox" checked={showVehicles} onchange={(event) => onShowVehiclesChange(event.currentTarget.checked)} /> Fahrzeuge</label>
    <label><input type="checkbox" checked={showEvents} onchange={(event) => onShowEventsChange(event.currentTarget.checked)} /> Einsätze</label>
  </div>
  <div class="filter-section"><span>Status</span><div class="options statuses">
    {#each STATUS_LABELS as label, status (status)}
      <label data-tooltip={label}><input type="checkbox" checked={!hiddenStatuses.has(status)} onchange={() => onToggleStatus(status)} /><StatusBadge value={status} /></label>
    {/each}
  </div></div>
  <div class="filter-section"><span>Einsatzarten</span><div class="options categories">
    {#each CATEGORIES as category (category)}
      <label><input type="checkbox" checked={!hiddenCategories.has(category)} onchange={() => onToggleCategory(category)} /><i style={`background: ${categoryColor(category)}`}></i>{CATEGORY_LABELS[category]}</label>
    {/each}
  </div></div>
  <div class="filter-section"><span>Wachen</span><div class="options stations">
    {#each stations as stationName (stationName)}
      <label><input type="checkbox" checked={!hiddenStations.has(stationName)} onchange={() => onToggleStation(stationName)} />{stationName}</label>
    {/each}
  </div></div>
  <button class="reset-filter" onclick={onReset}>Alle anzeigen</button>
</div>

<style>
  .map-filters { position: absolute; top: 48px; right: 10px; z-index: 7; width: min(330px, calc(100% - 20px)); max-height: calc(100% - 62px); overflow: auto; padding: 10px; border: 1px solid var(--border-strong); background: rgba(21, 22, 25, 0.98); box-shadow: var(--shadow); cursor: default; }
  .filter-head { display: flex; align-items: center; padding-bottom: 7px; border-bottom: 1px solid var(--border); }
  .filter-head strong { flex: 1; font-size: 12px; }
  .filter-section { padding: 9px 0; border-bottom: 1px solid var(--border); }
  .filter-section > span { display: block; margin-bottom: 7px; color: var(--text-dim); font-size: 10px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; }
  .filter-section.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .filter-section label { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11px; }
  .options { display: grid; gap: 6px; }
  .options.statuses { grid-template-columns: repeat(5, 1fr); }
  .options.categories, .options.stations { grid-template-columns: 1fr 1fr; }
  .options.statuses label { justify-content: center; }
  .options i { width: 8px; height: 8px; flex: 0 0 auto; }
  .reset-filter { width: 100%; margin-top: 9px; justify-content: center; font-size: 11px; }
</style>
