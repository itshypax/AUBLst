<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { Move, X } from '../lib/fontawesome-icons';
  import {
    GRID_COLUMNS,
    GRID_ROWS,
    MIN_PANEL_HEIGHT,
    MIN_PANEL_WIDTH,
    PANEL_LABELS,
    movePanel,
    rectFits,
    removePanel,
    resizePanel,
    stackedPanels,
    updatePanelSettings,
    type GridRect,
    type WorkspaceLayout,
    type WorkspacePanel,
  } from '../lib/workspaces';
  import BmaPanel from './BmaPanel.svelte';
  import CurrentEventPanel from './CurrentEventPanel.svelte';
  import EventsPanel from './EventsPanel.svelte';
  import HospitalsPanel from './HospitalsPanel.svelte';
  import LogPanel from './LogPanel.svelte';
  import MapPanel from './MapPanel.svelte';
  import SpeechRequestsPanel from './SpeechRequestsPanel.svelte';
  import VehiclesPanel from './VehiclesPanel.svelte';

  let {
    layout,
    editing = false,
    onChange,
    onNotice = () => undefined,
  }: {
    layout: WorkspaceLayout;
    editing?: boolean;
    onChange: (layout: WorkspaceLayout) => void;
    onNotice?: (message: string) => void;
  } = $props();

  interface DragState {
    key: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origin: WorkspacePanel;
    candidate: GridRect;
    valid: boolean;
  }

  let container: HTMLDivElement | undefined = $state();
  let drag = $state<DragState | null>(null);
  const stackOrder = $derived(new Map(stackedPanels(layout).map((item, index) => [item.key, index])));
  const NO_SPACE = 'Dort ist kein Platz für das Fenster.';

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  // Frei oder tauschbar: gleiches Rechteck wie ein anderes Panel gleicher Größe.
  function candidateValid(rect: GridRect, key: string): boolean {
    if (rectFits(layout, rect, key)) return true;
    return layout.panels.some((item) => item.key !== key && item.x === rect.x && item.y === rect.y && item.w === rect.w && item.h === rect.h);
  }

  function startDrag(panel: WorkspacePanel, mode: DragState['mode'], event: PointerEvent): void {
    if (!editing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = {
      key: panel.key,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...panel },
      candidate: { x: panel.x, y: panel.y, w: panel.w, h: panel.h },
      valid: true,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || !container) return;
    const rect = container.getBoundingClientRect();
    const cellWidth = rect.width / GRID_COLUMNS;
    const cellHeight = rect.height / GRID_ROWS;
    const dx = Math.round((event.clientX - drag.startX) / cellWidth);
    const dy = Math.round((event.clientY - drag.startY) / cellHeight);
    const origin = drag.origin;
    const candidate: GridRect = drag.mode === 'move'
      ? {
          x: clamp(origin.x + dx, 0, GRID_COLUMNS - origin.w),
          y: clamp(origin.y + dy, 0, GRID_ROWS - origin.h),
          w: origin.w,
          h: origin.h,
        }
      : {
          x: origin.x,
          y: origin.y,
          w: clamp(origin.w + dx, MIN_PANEL_WIDTH, GRID_COLUMNS - origin.x),
          h: clamp(origin.h + dy, MIN_PANEL_HEIGHT, GRID_ROWS - origin.y),
        };
    drag = { ...drag, candidate, valid: candidateValid(candidate, drag.key) };
  }

  function endDrag(): void {
    if (!drag) return;
    const finished = drag;
    drag = null;
    const unchanged = finished.candidate.x === finished.origin.x && finished.candidate.y === finished.origin.y
      && finished.candidate.w === finished.origin.w && finished.candidate.h === finished.origin.h;
    if (unchanged) return;
    if (!finished.valid) {
      onNotice(NO_SPACE);
      return;
    }
    const next = finished.mode === 'move'
      ? movePanel(layout, finished.key, finished.candidate.x, finished.candidate.y)
      : resizePanel(layout, finished.key, finished.candidate.w, finished.candidate.h);
    if (next) onChange(next);
    else onNotice(NO_SPACE);
  }

  function onHandleKey(panel: WorkspacePanel, event: KeyboardEvent): void {
    if (!editing) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onChange(removePanel(layout, panel.key));
      return;
    }
    const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const next = event.shiftKey
      ? resizePanel(layout, panel.key, panel.w + step[0], panel.h + step[1])
      : movePanel(layout, panel.key, panel.x + step[0], panel.y + step[1]);
    if (next) onChange(next);
    else onNotice(NO_SPACE);
  }

  function setVehiclesTab(panel: WorkspacePanel, value: string): void {
    onChange(updatePanelSettings(layout, panel.key, { vehiclesTab: value === 'fire' || value === 'rescue' ? value : undefined }));
  }

  function stop(event: Event): void {
    event.stopPropagation();
  }

  function gridArea(rect: GridRect): string {
    return `grid-column: ${rect.x + 1} / span ${rect.w}; grid-row: ${rect.y + 1} / span ${rect.h};`;
  }
</script>

{#snippet renderPanel(panel: WorkspacePanel)}
  {#if panel.type === 'map'}
    <MapPanel />
  {:else if panel.type === 'vehicles'}
    <VehiclesPanel pinnedTab={panel.settings?.vehiclesTab ?? null} />
  {:else if panel.type === 'events'}
    <EventsPanel />
  {:else if panel.type === 'current_event'}
    <CurrentEventPanel />
  {:else if panel.type === 'logs'}
    <LogPanel />
  {:else if panel.type === 'speech_requests'}
    <SpeechRequestsPanel />
  {:else if panel.type === 'hospitals'}
    <HospitalsPanel />
  {:else if panel.type === 'bmas'}
    <BmaPanel />
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="workspace-grid"
  class:editing
  bind:this={container}
  role="region"
  aria-label="Arbeitsfläche"
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
>
  {#each layout.panels as panel (panel.key)}
    <div
      class="grid-panel"
      class:dragging={drag?.key === panel.key}
      data-panel-key={panel.key}
      style={`${gridArea(panel)} order: ${stackOrder.get(panel.key) ?? 0};`}
    >
      {#if editing}
        <div
          class="edit-handle"
          data-grid-handle
          role="button"
          aria-label={`${PANEL_LABELS[panel.type]} anordnen`}
          tabindex="0"
          onpointerdown={(event) => startDrag(panel, 'move', event)}
          onkeydown={(event) => onHandleKey(panel, event)}
        >
          <FaIcon icon={Move} size={13} />
          <span class="handle-title">{PANEL_LABELS[panel.type]}</span>
          {#if panel.type === 'vehicles'}
            <select
              aria-label={`Tab für ${PANEL_LABELS[panel.type]}`}
              value={panel.settings?.vehiclesTab ?? ''}
              onpointerdown={stop}
              onkeydown={stop}
              onchange={(event) => setVehiclesTab(panel, event.currentTarget.value)}
            >
              <option value="">Beide Tabs</option>
              <option value="fire">Nur Feuerwehr</option>
              <option value="rescue">Nur Rettungsdienst</option>
            </select>
          {/if}
          <button
            class="ghost icon-button remove"
            aria-label={`${PANEL_LABELS[panel.type]} entfernen`}
            onpointerdown={stop}
            onclick={() => onChange(removePanel(layout, panel.key))}
          ><FaIcon icon={X} size={13} /></button>
        </div>
        <div class="resize-handle" aria-hidden="true" onpointerdown={(event) => startDrag(panel, 'resize', event)}></div>
      {/if}
      {@render renderPanel(panel)}
    </div>
  {/each}
  {#if drag}
    <div class="ghost-target" class:invalid={!drag.valid} style={gridArea(drag.candidate)}></div>
  {/if}
  {#if !layout.panels.length}
    <div class="empty-grid">Diese Ansicht hat keine Fenster. Über „Anordnung bearbeiten“ lassen sich welche hinzufügen.</div>
  {/if}
</div>

<style>
  .workspace-grid {
    position: relative;
    display: grid;
    grid-template-columns: repeat(24, minmax(0, 1fr));
    grid-template-rows: repeat(16, minmax(0, 1fr));
    gap: 6px;
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    padding: 8px;
  }

  .grid-panel {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 0;
  }

  .grid-panel :global(.panel) {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .editing .grid-panel :global(.panel) {
    pointer-events: none;
    opacity: 0.7;
  }

  .editing .grid-panel.dragging {
    opacity: 0.45;
  }

  .edit-handle {
    position: absolute;
    inset: 0 0 auto 0;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: var(--radius) var(--radius) 0 0;
    background: var(--accent);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .edit-handle:focus-visible {
    outline: 2px solid #fff;
    outline-offset: -2px;
  }

  .handle-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .edit-handle select {
    max-width: 150px;
    padding: 2px 4px;
    font-size: 11px;
  }

  .edit-handle .remove {
    width: 24px;
    height: 24px;
    padding: 0;
    justify-content: center;
    color: #fff;
  }

  .resize-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    z-index: 6;
    width: 20px;
    height: 20px;
    border-radius: 0 0 var(--radius) 0;
    background: linear-gradient(135deg, transparent 55%, var(--accent) 55%);
    cursor: nwse-resize;
    touch-action: none;
  }

  .ghost-target {
    z-index: 5;
    border: 2px dashed var(--good);
    border-radius: var(--radius);
    background: rgba(46, 201, 142, 0.16);
    pointer-events: none;
  }

  .ghost-target.invalid {
    border-color: var(--danger);
    background: rgba(232, 91, 98, 0.16);
  }

  .empty-grid {
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: var(--text-dim);
    text-align: center;
  }

  @media (max-width: 1100px) {
    .workspace-grid {
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow: auto;
    }

    .grid-panel {
      flex: 0 0 auto;
      min-height: 60vh;
    }

    .edit-handle,
    .resize-handle,
    .ghost-target {
      display: none;
    }

    .editing .grid-panel :global(.panel) {
      pointer-events: auto;
      opacity: 1;
    }
  }
</style>
