<script lang="ts">
  import FaIcon from '../FaIcon.svelte';
  import { Crosshair, MapPin, Minus, Move, Plus, Route, SlidersHorizontal } from '../../lib/fontawesome-icons';

  let {
    editorAvailable,
    editorOpen,
    placing,
    filtersOpen,
    standalone,
    onZoomIn,
    onZoomOut,
    onReset,
    onMapKeydown,
    onToggleEditor,
    onTogglePlacing,
    onToggleFilters,
  }: {
    editorAvailable: boolean;
    editorOpen: boolean;
    placing: boolean;
    filtersOpen: boolean;
    standalone: boolean;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onReset: () => void;
    onMapKeydown: (event: KeyboardEvent) => void;
    onToggleEditor: () => void;
    onTogglePlacing: () => void;
    onToggleFilters: () => void;
  } = $props();

  function stop(event: PointerEvent): void {
    event.stopPropagation();
  }
</script>

<div class="map-controls" role="toolbar" aria-label="Kartensteuerung">
  <button data-tooltip="Vergrößern" aria-label="Karte vergrößern" onpointerdown={stop} onpointerup={stop} onclick={onZoomIn}><FaIcon icon={Plus} size={15} /></button>
  <button data-tooltip="Verkleinern" aria-label="Karte verkleinern" onpointerdown={stop} onpointerup={stop} onclick={onZoomOut}><FaIcon icon={Minus} size={15} /></button>
  <button data-tooltip="Karte einpassen" aria-label="Karte einpassen" onpointerdown={stop} onpointerup={stop} onclick={onReset}><FaIcon icon={Crosshair} size={15} /></button>
  <button data-tooltip="Karte mit Pfeiltasten verschieben" aria-label="Karte mit Pfeiltasten verschieben" onpointerdown={stop} onpointerup={stop} onkeydown={onMapKeydown}><FaIcon icon={Move} size={15} /></button>
  {#if editorAvailable}
    <button class:active={editorOpen} aria-pressed={editorOpen} data-tooltip="Straßennetz bearbeiten" aria-label="Straßennetz bearbeiten" onpointerdown={stop} onpointerup={stop} onclick={onToggleEditor}><FaIcon icon={Route} size={15} /></button>
  {/if}
  {#if !standalone}
    <button class="create-event" class:active={placing} aria-pressed={placing} disabled={editorOpen} data-tooltip="Einsatz auf der Karte anlegen" onpointerdown={stop} onpointerup={stop} onclick={onTogglePlacing}><FaIcon icon={MapPin} size={15} /> Einsatz anlegen</button>
    <button data-map-filters-trigger class:active={filtersOpen} aria-pressed={filtersOpen} disabled={editorOpen} data-tooltip="Kartenfilter" aria-label="Kartenfilter öffnen" onpointerdown={stop} onpointerup={stop} onclick={onToggleFilters}><FaIcon icon={SlidersHorizontal} size={15} /></button>
  {/if}
</div>

<style>
  .map-controls { position: absolute; top: 10px; right: 10px; display: flex; gap: 4px; z-index: 6; }
  button { min-width: 30px; height: 30px; padding: 0 7px; justify-content: center; background: rgba(21, 22, 25, 0.94); }
  button.active { border-color: var(--accent-outline); background: #25282d; }
  @media (max-width: 700px) {
    .create-event { width: 30px; font-size: 0; }
    .create-event :global(svg) { margin: 0; }
  }
</style>
