<script lang="ts">
  import ActionsModal from './components/ActionsModal.svelte';
  import AssignModal from './components/AssignModal.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import ConnectionLostBanner from './components/ConnectionLostBanner.svelte';
  import CreateEventDialog from './components/CreateEventDialog.svelte';
  import EventsPanel from './components/EventsPanel.svelte';
  import HospitalsPanel from './components/HospitalsPanel.svelte';
  import HospitalAssignmentModal from './components/HospitalAssignmentModal.svelte';
  import LogPanel from './components/LogPanel.svelte';
  import IncidentRecordsModal from './components/IncidentRecordsModal.svelte';
  import MapPanel from './components/MapPanel.svelte';
  import SessionGate from './components/SessionGate.svelte';
  import SpeechRequestsQueue from './components/SpeechRequestsQueue.svelte';
  import StatisticsModal from './components/StatisticsModal.svelte';
  import Topbar from './components/Topbar.svelte';
  import Tooltip from './components/Tooltip.svelte';
  import VehicleContextMenu from './components/VehicleContextMenu.svelte';
  import VehiclesPanel from './components/VehiclesPanel.svelte';
  import { loadGroupOverrides } from './lib/classify';
  import { startPolling } from './lib/polling';
  import { app, initSettings } from './lib/state.svelte';

  initSettings();
  void loadGroupOverrides();
  startPolling();

  const DEFAULT_LAYOUT = { col: 0.58, left: 0.72, right: 0.55 };

  const clamp = (x: number) => Math.min(0.85, Math.max(0.15, x));

  function storedLayout(): typeof DEFAULT_LAYOUT {
    try {
      const saved = JSON.parse(localStorage.getItem('panelLayout') ?? '{}');
      return {
        col: Number.isFinite(saved.col) ? clamp(saved.col) : DEFAULT_LAYOUT.col,
        left: Number.isFinite(saved.left) ? clamp(saved.left) : DEFAULT_LAYOUT.left,
        right: Number.isFinite(saved.right) ? clamp(saved.right) : DEFAULT_LAYOUT.right,
      };
    } catch {
      return DEFAULT_LAYOUT;
    }
  }

  const initialLayout = storedLayout();
  let colRatio = $state(initialLayout.col);
  let leftRowRatio = $state(initialLayout.left);
  let rightRowRatio = $state(initialLayout.right);
  const showSessionGate = $derived(app.lastSuccessfulSync === null && !app.stateHealthy);
  const connectionLost = $derived(app.lastSuccessfulSync !== null && !app.stateHealthy);

  type DragKind = 'col' | 'left' | 'right';
  let drag: { kind: DragKind; container: HTMLElement } | null = $state(null);

  function startDrag(kind: DragKind, e: PointerEvent): void {
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    drag = { kind, container };
    e.preventDefault();
  }

  function onMove(e: PointerEvent): void {
    if (!drag) return;
    const rect = drag.container.getBoundingClientRect();
    if (drag.kind === 'col') {
      colRatio = clamp((e.clientX - rect.left) / rect.width);
    } else if (drag.kind === 'left') {
      leftRowRatio = clamp((e.clientY - rect.top) / rect.height);
    } else {
      rightRowRatio = clamp((e.clientY - rect.top) / rect.height);
    }
  }

  function endDrag(): void {
    if (drag) persistLayout();
    drag = null;
  }

  function persistLayout(): void {
    localStorage.setItem('panelLayout', JSON.stringify({ col: colRatio, left: leftRowRatio, right: rightRowRatio }));
  }

  function resetLayout(): void {
    colRatio = DEFAULT_LAYOUT.col;
    leftRowRatio = DEFAULT_LAYOUT.left;
    rightRowRatio = DEFAULT_LAYOUT.right;
    persistLayout();
  }

  function onSeparatorKey(kind: DragKind, e: KeyboardEvent): void {
    const delta = e.shiftKey ? 0.1 : 0.03;
    const direction = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (!direction && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const value = e.key === 'Home' ? 0.15 : e.key === 'End' ? 0.85 : null;
    if (kind === 'col') colRatio = value ?? clamp(colRatio + direction * delta);
    else if (kind === 'left') leftRowRatio = value ?? clamp(leftRowRatio + direction * delta);
    else rightRowRatio = value ?? clamp(rightRowRatio + direction * delta);
    persistLayout();
  }
</script>

<svelte:window onpointermove={onMove} onpointerup={endDrag} />

<Topbar onResetLayout={resetLayout} />

{#if showSessionGate}
  <SessionGate />
{:else}
  {#if connectionLost}<ConnectionLostBanner />{/if}
  <main
    class="layout"
    style="grid-template-columns: minmax(0, {colRatio}fr) 6px minmax(0, {1 - colRatio}fr);"
  >
    <div
      class="col"
      style="grid-template-rows: minmax(0, {leftRowRatio}fr) 6px minmax(0, {1 - leftRowRatio}fr);"
    >
      <MapPanel />
      <div
        class="splitter-row"
        class:active={drag?.kind === 'left'}
        onpointerdown={(e) => startDrag('left', e)}
        onkeydown={(e) => onSeparatorKey('left', e)}
        ondblclick={() => { leftRowRatio = DEFAULT_LAYOUT.left; persistLayout(); }}
        role="slider"
        aria-orientation="horizontal"
        aria-label="Höhe von Karte und Meldungen ändern"
        aria-valuemin="15"
        aria-valuemax="85"
        aria-valuenow={Math.round(leftRowRatio * 100)}
        tabindex="0"
      ></div>
      <div class="bottom-row">
        <LogPanel />
        <HospitalsPanel />
      </div>
    </div>

    <div
      class="splitter-col"
      class:active={drag?.kind === 'col'}
      onpointerdown={(e) => startDrag('col', e)}
      onkeydown={(e) => onSeparatorKey('col', e)}
      ondblclick={() => { colRatio = DEFAULT_LAYOUT.col; persistLayout(); }}
      role="slider"
      aria-orientation="vertical"
      aria-label="Breite von Karte und Übersicht ändern"
      aria-valuemin="15"
      aria-valuemax="85"
      aria-valuenow={Math.round(colRatio * 100)}
      tabindex="0"
    ></div>

    <div
      class="col"
      style="grid-template-rows: minmax(0, {rightRowRatio}fr) 6px minmax(0, {1 - rightRowRatio}fr);"
    >
      <VehiclesPanel />
      <div
        class="splitter-row"
        class:active={drag?.kind === 'right'}
        onpointerdown={(e) => startDrag('right', e)}
        onkeydown={(e) => onSeparatorKey('right', e)}
        ondblclick={() => { rightRowRatio = DEFAULT_LAYOUT.right; persistLayout(); }}
        role="slider"
        aria-orientation="horizontal"
        aria-label="Höhe von Fahrzeugen und Einsätzen ändern"
        aria-valuemin="15"
        aria-valuemax="85"
        aria-valuenow={Math.round(rightRowRatio * 100)}
        tabindex="0"
      ></div>
      <EventsPanel />
    </div>
  </main>
{/if}

{#key app.assignEvent?.id}
  {#if app.assignEvent}
    <AssignModal />
  {/if}
{/key}

{#if app.createEventPos}
  <CreateEventDialog />
{/if}

{#key app.contextMenu}
  {#if app.contextMenu}
    <VehicleContextMenu />
  {/if}
{/key}

{#if app.actionsOpen}
  <ActionsModal />
{/if}

{#if app.statisticsOpen}
  <StatisticsModal />
{/if}

{#if app.recordsOpen}
  <IncidentRecordsModal />
{/if}

{#if app.hospitalAssignmentVehicleId !== null}
  <HospitalAssignmentModal />
{/if}

{#if app.confirmDialog}
  <ConfirmDialog />
{/if}

{#if app.speechQueueOpen && app.lastSuccessfulSync !== null}
  <SpeechRequestsQueue />
{/if}

{#if app.notice}
  <div class="notice {app.notice.kind}" role="status">{app.notice.message}</div>
{/if}

<Tooltip />

<style>
  .layout {
    display: grid;
    gap: 0;
    padding: 8px;
    flex: 1 1 auto;
    min-height: 0;
  }

  .col {
    display: grid;
    min-height: 0;
    min-width: 0;
  }

  .bottom-row {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    gap: 8px;
    min-height: 0;
  }

  .splitter-col {
    margin: 0 1px;
  }

  .splitter-row {
    margin: 1px 0;
  }

  .notice {
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 100;
    max-width: min(420px, calc(100vw - 28px));
    padding: 9px 12px;
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--good);
    border-radius: var(--radius-sm);
    background: var(--panel-header);
    box-shadow: var(--shadow);
  }

  .notice.error { border-left-color: var(--danger); }

  @media (max-width: 1100px) {
    .layout {
      display: grid;
      grid-template-columns: 1fr !important;
      grid-template-rows: minmax(620px, 1fr) minmax(620px, 1fr);
      gap: 8px;
      overflow: auto;
    }

    .splitter-col {
      display: none;
    }
  }

  @media (max-width: 760px) {
    .layout {
      grid-template-rows: 820px 680px;
      padding: 6px;
    }

    .bottom-row {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(220px, 1fr) minmax(180px, 0.8fr);
    }
  }
</style>
