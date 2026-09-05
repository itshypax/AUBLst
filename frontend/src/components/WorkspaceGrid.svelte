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
    removePanel,
    resizePanel,
    resizePanelRect,
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

  type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
  const RESIZE_EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  // Während des Ziehens hält preview die zuletzt gültige Anordnung; sie wird
  // direkt gerendert, damit das Fenster live an der Zielstelle erscheint.
  interface DragState {
    key: string;
    mode: 'move' | ResizeEdge;
    startX: number;
    startY: number;
    origin: WorkspacePanel;
    preview: WorkspaceLayout;
    valid: boolean;
  }

  let container: HTMLDivElement | undefined = $state();
  let drag = $state<DragState | null>(null);
  const shown = $derived(drag?.preview ?? layout);
  const stackOrder = $derived(new Map(stackedPanels(shown).map((item, index) => [item.key, index])));
  const NO_SPACE = 'Dort ist kein Platz für das Fenster.';

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function startDrag(panel: WorkspacePanel, mode: DragState['mode'], event: PointerEvent): void {
    if (!editing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    drag = {
      key: panel.key,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...panel },
      preview: layout,
      valid: true,
    };
  }

  // Ziehen an einer Kante: links und oben verschieben zugleich die Position.
  function resizedRect(origin: WorkspacePanel, edge: ResizeEdge, dx: number, dy: number): GridRect {
    let { x, y, w, h } = origin;
    if (edge.includes('w')) {
      x = clamp(origin.x + dx, 0, origin.x + origin.w - MIN_PANEL_WIDTH);
      w = origin.x + origin.w - x;
    }
    if (edge.includes('e')) w = clamp(origin.w + dx, MIN_PANEL_WIDTH, GRID_COLUMNS - origin.x);
    if (edge.includes('n')) {
      y = clamp(origin.y + dy, 0, origin.y + origin.h - MIN_PANEL_HEIGHT);
      h = origin.y + origin.h - y;
    }
    if (edge.includes('s')) h = clamp(origin.h + dy, MIN_PANEL_HEIGHT, GRID_ROWS - origin.y);
    return { x, y, w, h };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || !container) return;
    const rect = container.getBoundingClientRect();
    const dx = Math.round((event.clientX - drag.startX) / (rect.width / GRID_COLUMNS));
    const dy = Math.round((event.clientY - drag.startY) / (rect.height / GRID_ROWS));
    const origin = drag.origin;
    const next = drag.mode === 'move'
      ? movePanel(layout, drag.key, clamp(origin.x + dx, 0, GRID_COLUMNS - origin.w), clamp(origin.y + dy, 0, GRID_ROWS - origin.h))
      : resizePanelRect(layout, drag.key, resizedRect(origin, drag.mode, dx, dy));
    drag = next ? { ...drag, preview: next, valid: true } : { ...drag, valid: false };
  }

  function sameRects(a: WorkspaceLayout, b: WorkspaceLayout): boolean {
    return a.panels.length === b.panels.length
      && a.panels.every((panel, index) => {
        const other = b.panels[index];
        return panel.key === other.key && panel.x === other.x && panel.y === other.y && panel.w === other.w && panel.h === other.h;
      });
  }

  function endDrag(): void {
    if (!drag) return;
    const finished = drag;
    drag = null;
    if (!finished.valid) onNotice(NO_SPACE);
    if (sameRects(finished.preview, layout)) return;
    onChange(finished.preview);
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
    const vehiclesTab = value === 'fire' || value === 'rescue' || value === 'all' ? value : undefined;
    onChange(updatePanelSettings(layout, panel.key, { vehiclesTab }));
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
    <MapPanel
      filterSettings={panel.settings?.mapFilters ?? null}
      onFilterSettingsChange={(mapFilters) => onChange(updatePanelSettings(layout, panel.key, { mapFilters }))}
    />
  {:else if panel.type === 'vehicles'}
    <VehiclesPanel pinnedTab={panel.settings?.vehiclesTab ?? null} />
  {:else if panel.type === 'events'}
    <EventsPanel
      filterSettings={panel.settings?.eventsFilters ?? null}
      onFilterSettingsChange={(eventsFilters) => onChange(updatePanelSettings(layout, panel.key, { eventsFilters }))}
    />
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
  {#if editing}
    <div class="grid-lines" aria-hidden="true"></div>
  {/if}
  {#each shown.panels as panel (panel.key)}
    <div
      class="grid-panel"
      class:dragging={drag?.key === panel.key}
      class:invalid={drag?.key === panel.key && !drag.valid}
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
          <span class="handle-icon"><FaIcon icon={Move} size={13} /></span>
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
              <option value="all">FW und RD zusammen</option>
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
        {#each RESIZE_EDGES as edge (edge)}
          <div
            class={`resize-handle edge-${edge}`}
            data-resize={edge}
            aria-hidden="true"
            onpointerdown={(event) => startDrag(panel, edge, event)}
          ></div>
        {/each}
      {/if}
      {@render renderPanel(panel)}
    </div>
  {/each}
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

  /* Rasterlinien im Innenbereich; die Zellen decken sich mit dem CSS-Grid. */
  .grid-lines {
    position: absolute;
    inset: 8px;
    z-index: 0;
    pointer-events: none;
    opacity: 0.5;
    background-image:
      linear-gradient(to right, var(--border) 1px, transparent 1px),
      linear-gradient(to bottom, var(--border) 1px, transparent 1px);
    background-size: calc(100% / 24) calc(100% / 16);
  }

  .grid-panel {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 0;
    border-radius: var(--radius);
  }

  .grid-panel :global(.panel) {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .editing .grid-panel {
    outline: 1px dashed var(--border-strong);
    outline-offset: -1px;
    background: var(--panel);
  }

  .editing .grid-panel:has(.edit-handle:focus-visible) {
    outline: 2px solid var(--accent-outline);
  }

  .editing .grid-panel :global(.panel) {
    pointer-events: none;
    opacity: 0.7;
  }

  .editing .grid-panel.dragging {
    z-index: 7;
    outline: 2px solid var(--accent-outline);
    box-shadow: var(--shadow);
  }

  .editing .grid-panel.dragging.invalid {
    outline-color: var(--danger);
  }

  .edit-handle {
    position: absolute;
    inset: 0 0 auto 0;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    border-radius: var(--radius) var(--radius) 0 0;
    background: var(--panel-header);
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .dragging .edit-handle {
    cursor: grabbing;
  }

  .edit-handle:focus-visible {
    outline: none;
  }

  .handle-icon {
    display: inline-flex;
    color: var(--text-dim);
  }

  .handle-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .edit-handle select {
    max-width: 170px;
    padding: 2px 4px;
    font-size: 11px;
  }

  .edit-handle .remove {
    width: 24px;
    height: 24px;
    padding: 0;
    justify-content: center;
    color: var(--text-dim);
  }

  .edit-handle .remove:hover {
    color: var(--text);
  }

  .resize-handle {
    position: absolute;
    z-index: 7;
    touch-action: none;
  }

  .resize-handle:hover {
    background: var(--border-strong);
  }

  .edge-n, .edge-s { left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
  .edge-e, .edge-w { top: 14px; bottom: 14px; width: 6px; cursor: ew-resize; }
  .edge-n { top: 0; }
  .edge-s { bottom: 0; }
  .edge-e { right: 0; }
  .edge-w { left: 0; }
  .edge-ne, .edge-nw, .edge-se, .edge-sw { width: 14px; height: 14px; }
  .edge-ne { top: 0; right: 0; cursor: nesw-resize; border-radius: 0 var(--radius) 0 0; }
  .edge-sw { bottom: 0; left: 0; cursor: nesw-resize; border-radius: 0 0 0 var(--radius); }
  .edge-nw { top: 0; left: 0; cursor: nwse-resize; border-radius: var(--radius) 0 0 0; }
  .edge-se { bottom: 0; right: 0; cursor: nwse-resize; border-radius: 0 0 var(--radius) 0; }

  /* Die Ecke rechts unten bleibt als Hinweis sichtbar, die übrigen Griffe zeigen sich beim Überfahren. */
  .edge-se {
    background: linear-gradient(135deg, transparent 55%, var(--border-strong) 55%);
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
    .grid-lines {
      display: none;
    }

    .editing .grid-panel {
      outline: none;
    }

    .editing .grid-panel :global(.panel) {
      pointer-events: auto;
      opacity: 1;
    }
  }
</style>
