<script lang="ts">
  import type { AreaDirection, PanelId } from '../lib/workspaces';
  import CurrentEventPanel from './CurrentEventPanel.svelte';
  import EventsPanel from './EventsPanel.svelte';
  import HospitalsPanel from './HospitalsPanel.svelte';
  import LogPanel from './LogPanel.svelte';
  import MapPanel from './MapPanel.svelte';
  import SpeechRequestsPanel from './SpeechRequestsPanel.svelte';
  import VehiclesPanel from './VehiclesPanel.svelte';

  let { panels, direction, ratios, onRatiosChange }: {
    panels: PanelId[];
    direction: AreaDirection;
    ratios: number[];
    onRatiosChange: (ratios: number[]) => void;
  } = $props();

  let panelRatios = $state<number[]>([]);
  let drag = $state<{ index: number; start: number; size: number; before: number; after: number } | null>(null);

  $effect(() => {
    if (drag) return;
    const candidates = ratios.length === panels.length ? ratios : Array(panels.length).fill(1);
    const sum = candidates.reduce((total, ratio) => total + ratio, 0) || 1;
    panelRatios = candidates.map((ratio) => ratio / sum);
  });

  function tracks(): string {
    const parts = panels.flatMap((_, index) => [
      `minmax(0, ${panelRatios[index] ?? 1}fr)`,
      ...(index < panels.length - 1 ? ['6px'] : []),
    ]);
    const property = direction === 'row' ? 'grid-template-columns' : 'grid-template-rows';
    return `${property}: ${parts.join(' ')};`;
  }

  function startDrag(index: number, event: PointerEvent): void {
    const container = (event.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    drag = {
      index,
      start: direction === 'row' ? event.clientX : event.clientY,
      size: direction === 'row' ? rect.width : rect.height,
      before: panelRatios[index],
      after: panelRatios[index + 1],
    };
    event.preventDefault();
  }

  function resizePair(index: number, before: number, after: number): void {
    const pair = before + after;
    const minimum = Math.min(0.08, pair / 3);
    const nextBefore = Math.max(minimum, Math.min(pair - minimum, before));
    const next = [...panelRatios];
    next[index] = nextBefore;
    next[index + 1] = pair - nextBefore;
    panelRatios = next;
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag) return;
    const position = direction === 'row' ? event.clientX : event.clientY;
    const before = drag.before + (position - drag.start) / drag.size;
    resizePair(drag.index, before, drag.before + drag.after - before);
  }

  function endDrag(): void {
    if (!drag) return;
    drag = null;
    onRatiosChange([...panelRatios]);
  }

  function onSeparatorKey(index: number, event: KeyboardEvent): void {
    const directionKey = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    if (!directionKey && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const pair = panelRatios[index] + panelRatios[index + 1];
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? pair : panelRatios[index] + directionKey * (event.shiftKey ? 0.1 : 0.03);
    resizePair(index, target, pair - target);
    onRatiosChange([...panelRatios]);
  }

  function resetPair(index: number): void {
    const pair = panelRatios[index] + panelRatios[index + 1];
    resizePair(index, pair / 2, pair / 2);
    onRatiosChange([...panelRatios]);
  }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={endDrag} />

<div
  class="workspace-area {direction}"
  style={tracks()}
>
  {#each panels as panel, index (panel)}
    {#if panel === 'map'}
      <MapPanel />
    {:else if panel === 'vehicles'}
      <VehiclesPanel />
    {:else if panel === 'events'}
      <EventsPanel />
    {:else if panel === 'current_event'}
      <CurrentEventPanel />
    {:else if panel === 'logs'}
      <LogPanel />
    {:else if panel === 'speech_requests'}
      <SpeechRequestsPanel />
    {:else if panel === 'hospitals'}
      <HospitalsPanel />
    {/if}
    {#if index < panels.length - 1}
      <div
        class={direction === 'row' ? 'splitter-col' : 'splitter-row'}
        class:active={drag?.index === index}
        onpointerdown={(event) => startDrag(index, event)}
        onkeydown={(event) => onSeparatorKey(index, event)}
        ondblclick={() => resetPair(index)}
        role="slider"
        aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
        aria-label={`Größe zwischen ${panel} und ${panels[index + 1]} ändern`}
        aria-valuemin="8"
        aria-valuemax="92"
        aria-valuenow={Math.round((panelRatios[index] / (panelRatios[index] + panelRatios[index + 1])) * 100)}
        tabindex="0"
      ></div>
    {/if}
  {/each}
</div>

<style>
  .workspace-area {
    display: grid;
    gap: 0;
    min-width: 0;
    min-height: 0;
  }

  .workspace-area.column {
    grid-template-columns: minmax(0, 1fr);
  }

  .workspace-area.row {
    grid-template-rows: minmax(0, 1fr);
  }

</style>
