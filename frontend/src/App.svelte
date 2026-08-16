<script lang="ts">
  import { onDestroy } from 'svelte';
  import ActionsModal from './components/ActionsModal.svelte';
  import AssignModal from './components/AssignModal.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import ConnectionLostBanner from './components/ConnectionLostBanner.svelte';
  import CreateEventDialog from './components/CreateEventDialog.svelte';
  import HospitalAssignmentModal from './components/HospitalAssignmentModal.svelte';
  import RoutingEditorPage from './components/RoutingEditorPage.svelte';
  import SessionGate from './components/SessionGate.svelte';
  import ShortcutPanel from './components/ShortcutPanel.svelte';
  import SpeechRequestsQueue from './components/SpeechRequestsQueue.svelte';
  import SessionOverviewModal from './components/SessionOverviewModal.svelte';
  import Topbar from './components/Topbar.svelte';
  import Tooltip from './components/Tooltip.svelte';
  import VehicleContextMenu from './components/VehicleContextMenu.svelte';
  import WorkspaceArea from './components/WorkspaceArea.svelte';
  import WorkspaceEditorModal from './components/WorkspaceEditorModal.svelte';
  import NoticeToast from './components/NoticeToast.svelte';
  import { loadGroupOverrides } from './lib/classify';
  import { shortcutActionForEvent, type ShortcutAction } from './lib/keyboard-shortcuts';
  import { startPolling } from './lib/polling';
  import { configureSounds, loadSoundManifest } from './lib/sounds';
  import {
    app,
    closeEventFromSync,
    focusVehicleFromSync,
    initSettings,
    openEventFromSync,
    reconcileSyncedEvent,
    setDispatchSelectionFromSync,
    setHighlightFromSync,
  } from './lib/state.svelte';
  import { startUiSync, uiSyncScope, updateUiSyncPresence } from './lib/ui-sync';
  import { AREA_IDS, cloneWorkspace, loadWorkspaces, saveWorkspaces, setWorkspaceInUrl, workspaceIdFromUrl, workspaceUrl, type AreaId, type WorkspaceLayout } from './lib/workspaces';

  const pageParams = new URLSearchParams(location.search);
  const localHostname = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1';
  const routingEditorRequested = import.meta.env.DEV && localHostname && pageParams.get('routing_editor') === '1';
  const routingEditorModId = pageParams.get('mod_id')?.trim() ?? '';

  if (!routingEditorRequested) {
    initSettings();
    void loadGroupOverrides();
    void loadSoundManifest().then(() => {
      configureSounds(app.soundEnabled, app.soundVolume, app.soundProfile);
      startPolling();
    });
  }

  const clamp = (x: number) => Math.min(0.85, Math.max(0.15, x));
  const loadedWorkspaces = loadWorkspaces();
  const initialWorkspaceId = workspaceIdFromUrl(loadedWorkspaces);
  const initialWorkspace = loadedWorkspaces.find((workspace) => workspace.id === initialWorkspaceId) ?? loadedWorkspaces[0];
  let workspaces = $state(loadedWorkspaces);
  let activeWorkspaceId = $state(initialWorkspace.id);
  let workspaceEditorOpen = $state(false);
  let colRatio = $state(initialWorkspace.ratios.col);
  let leftRowRatio = $state(initialWorkspace.ratios.left);
  let rightRowRatio = $state(initialWorkspace.ratios.right);
  const activeWorkspace = $derived(workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0]);
  const hasLeftTop = $derived(activeWorkspace.areas.leftTop.length > 0);
  const hasLeftBottom = $derived(activeWorkspace.areas.leftBottom.length > 0);
  const hasRightTop = $derived(activeWorkspace.areas.rightTop.length > 0);
  const hasRightBottom = $derived(activeWorkspace.areas.rightBottom.length > 0);
  const hasLeft = $derived(hasLeftTop || hasLeftBottom);
  const hasRight = $derived(hasRightTop || hasRightBottom);
  const hasCurrentEventPanel = $derived(AREA_IDS.some((area) => activeWorkspace.areas[area].includes('current_event')));
  const showSessionGate = $derived(app.lastSuccessfulSync === null && !app.stateHealthy);
  const connectionLost = $derived(app.lastSuccessfulSync !== null && !app.stateHealthy);

  const stopUiSync = startUiSync({
    onOpenEvent: (eventId, hostedHere) => openEventFromSync(eventId, hostedHere),
    onCloseEvent: closeEventFromSync,
    onHighlight: setHighlightFromSync,
    onFocusVehicle: focusVehicleFromSync,
    onDispatchSelection: setDispatchSelectionFromSync,
    onSnapshot: (eventId, vehicleIds, hostedHere) => openEventFromSync(eventId, hostedHere, vehicleIds),
    onCurrentEventHostChange: (remoteHostAvailable) => {
      if (app.assignEvent) app.currentEventHostedRemotely = !hasCurrentEventPanel && remoteHostAvailable;
    },
  });
  onDestroy(stopUiSync);

  $effect(() => {
    updateUiSyncPresence(
      uiSyncScope(app.apiBase, app.sessionToken),
      activeWorkspace.id,
      AREA_IDS.flatMap((area) => activeWorkspace.areas[area]),
      app.assignEvent?.id ?? null,
      app.dispatchVehicleIds,
      Boolean(app.assignEvent && !app.currentEventHostedRemotely),
    );
  });

  $effect(() => {
    void app.events;
    reconcileSyncedEvent();
  });

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
    saveWorkspace({ ...cloneWorkspace(activeWorkspace), ratios: { col: colRatio, left: leftRowRatio, right: rightRowRatio } });
  }

  function persistPanelRatios(area: AreaId, ratios: number[]): void {
    saveWorkspace({
      ...cloneWorkspace(activeWorkspace),
      panelRatios: { ...activeWorkspace.panelRatios, [area]: ratios },
    });
  }

  function resetLayout(): void {
    colRatio = 0.58;
    leftRowRatio = 0.62;
    rightRowRatio = 0.55;
    persistLayout();
  }

  function saveWorkspace(workspace: WorkspaceLayout): void {
    const index = workspaces.findIndex((item) => item.id === workspace.id);
    workspaces = index === -1
      ? [...workspaces, cloneWorkspace(workspace)]
      : workspaces.map((item) => item.id === workspace.id ? cloneWorkspace(workspace) : item);
    saveWorkspaces(workspaces);
    if (workspace.id === activeWorkspaceId) {
      colRatio = workspace.ratios.col;
      leftRowRatio = workspace.ratios.left;
      rightRowRatio = workspace.ratios.right;
    }
  }

  function selectWorkspace(id: string): void {
    const workspace = workspaces.find((item) => item.id === id);
    if (!workspace) return;
    activeWorkspaceId = id;
    colRatio = workspace.ratios.col;
    leftRowRatio = workspace.ratios.left;
    rightRowRatio = workspace.ratios.right;
    setWorkspaceInUrl(id);
  }

  function deleteWorkspace(id: string): void {
    if (id === 'standard') return;
    workspaces = workspaces.filter((workspace) => workspace.id !== id);
    saveWorkspaces(workspaces);
    if (activeWorkspaceId === id) selectWorkspace(workspaces[0].id);
  }

  function openWorkspaceTab(id: string): void {
    const workspace = workspaces.find((item) => item.id === id);
    if (workspace) window.open(workspaceUrl(workspace), '_blank', 'noopener');
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

  function executeShortcutAction(action: ShortcutAction): void {
    if (action === 'toggle-help') {
      app.shortcutsOpen = !app.shortcutsOpen;
      return;
    }
    app.shortcutsOpen = false;
    if (action.startsWith('workspace-')) {
      const index = Number(action.slice(-1)) - 1;
      const workspace = workspaces[index];
      if (workspace) selectWorkspace(workspace.id);
      return;
    }
    if (app.lastSuccessfulSync === null) return;
    if (action === 'focus-vehicle-search') app.focusVehicleSearchSeq += 1;
    else if (action === 'fit-map') app.fitMapSeq += 1;
    else if (action === 'toggle-speech-requests') app.speechQueueOpen = !app.speechQueueOpen;
    else if (action === 'open-actions') app.actionsOpen = true;
    else if (action === 'open-overview') app.sessionOverviewOpen = true;
  }

  function onGlobalKeydown(event: KeyboardEvent): void {
    if (routingEditorRequested) return;
    const action = shortcutActionForEvent(event);
    if (!action) return;
    event.preventDefault();
    if (app.shortcutsOpen && action !== 'toggle-help') return;
    executeShortcutAction(action);
  }
</script>

<svelte:window onpointermove={onMove} onpointerup={endDrag} onkeydown={onGlobalKeydown} />

{#if routingEditorRequested}
  <RoutingEditorPage modId={routingEditorModId} />
{:else}
  <Topbar onResetLayout={resetLayout} onOpenWorkspaceEditor={() => (workspaceEditorOpen = true)} onOpenShortcuts={() => (app.shortcutsOpen = true)} workspaceName={activeWorkspace.name} />

{#if app.shortcutsOpen}<ShortcutPanel onAction={executeShortcutAction} />{/if}

{#if showSessionGate}
  <SessionGate />
{:else}
  {#if connectionLost}<ConnectionLostBanner />{/if}
  <main
    class="layout"
    class:single-column={!hasLeft || !hasRight}
    style={hasLeft && hasRight
      ? `grid-template-columns: minmax(0, ${colRatio}fr) 6px minmax(0, ${1 - colRatio}fr);`
      : 'grid-template-columns: minmax(0, 1fr);'}
  >
    {#if hasLeft}
      <div
        class="col"
        style={hasLeftTop && hasLeftBottom
          ? `grid-template-rows: minmax(0, ${leftRowRatio}fr) 6px minmax(0, ${1 - leftRowRatio}fr);`
          : 'grid-template-rows: minmax(0, 1fr);'}
      >
        {#if hasLeftTop}<WorkspaceArea panels={activeWorkspace.areas.leftTop} direction={activeWorkspace.directions.leftTop} ratios={activeWorkspace.panelRatios.leftTop} onRatiosChange={(ratios) => persistPanelRatios('leftTop', ratios)} />{/if}
        {#if hasLeftTop && hasLeftBottom}
          <div
            class="splitter-row"
            class:active={drag?.kind === 'left'}
            onpointerdown={(e) => startDrag('left', e)}
            onkeydown={(e) => onSeparatorKey('left', e)}
            ondblclick={() => { leftRowRatio = 0.62; persistLayout(); }}
            role="slider"
            aria-orientation="horizontal"
            aria-label="Höhe der linken Bereiche ändern"
            aria-valuemin="15"
            aria-valuemax="85"
            aria-valuenow={Math.round(leftRowRatio * 100)}
            tabindex="0"
          ></div>
        {/if}
        {#if hasLeftBottom}<WorkspaceArea panels={activeWorkspace.areas.leftBottom} direction={activeWorkspace.directions.leftBottom} ratios={activeWorkspace.panelRatios.leftBottom} onRatiosChange={(ratios) => persistPanelRatios('leftBottom', ratios)} />{/if}
      </div>
    {/if}

    {#if hasLeft && hasRight}
      <div
        class="splitter-col"
        class:active={drag?.kind === 'col'}
        onpointerdown={(e) => startDrag('col', e)}
        onkeydown={(e) => onSeparatorKey('col', e)}
        ondblclick={() => { colRatio = 0.58; persistLayout(); }}
        role="slider"
        aria-orientation="vertical"
        aria-label="Breite der Arbeitsbereiche ändern"
        aria-valuemin="15"
        aria-valuemax="85"
        aria-valuenow={Math.round(colRatio * 100)}
        tabindex="0"
      ></div>
    {/if}

    {#if hasRight}
      <div
        class="col"
        style={hasRightTop && hasRightBottom
          ? `grid-template-rows: minmax(0, ${rightRowRatio}fr) 6px minmax(0, ${1 - rightRowRatio}fr);`
          : 'grid-template-rows: minmax(0, 1fr);'}
      >
        {#if hasRightTop}<WorkspaceArea panels={activeWorkspace.areas.rightTop} direction={activeWorkspace.directions.rightTop} ratios={activeWorkspace.panelRatios.rightTop} onRatiosChange={(ratios) => persistPanelRatios('rightTop', ratios)} />{/if}
        {#if hasRightTop && hasRightBottom}
          <div
            class="splitter-row"
            class:active={drag?.kind === 'right'}
            onpointerdown={(e) => startDrag('right', e)}
            onkeydown={(e) => onSeparatorKey('right', e)}
            ondblclick={() => { rightRowRatio = 0.55; persistLayout(); }}
            role="slider"
            aria-orientation="horizontal"
            aria-label="Höhe der rechten Bereiche ändern"
            aria-valuemin="15"
            aria-valuemax="85"
            aria-valuenow={Math.round(rightRowRatio * 100)}
            tabindex="0"
          ></div>
        {/if}
        {#if hasRightBottom}<WorkspaceArea panels={activeWorkspace.areas.rightBottom} direction={activeWorkspace.directions.rightBottom} ratios={activeWorkspace.panelRatios.rightBottom} onRatiosChange={(ratios) => persistPanelRatios('rightBottom', ratios)} />{/if}
      </div>
    {/if}
  </main>
{/if}

{#if workspaceEditorOpen}
  <WorkspaceEditorModal
    {workspaces}
    activeId={activeWorkspaceId}
    onSelect={selectWorkspace}
    onSave={saveWorkspace}
    onDelete={deleteWorkspace}
    onOpenTab={openWorkspaceTab}
    onClose={() => (workspaceEditorOpen = false)}
  />
{/if}

{#key app.assignEvent?.id}
  {#if app.assignEvent && !hasCurrentEventPanel && !app.currentEventHostedRemotely}
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

{#if app.sessionOverviewOpen}
  <SessionOverviewModal />
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
{/if}

{#if routingEditorRequested && app.confirmDialog}
  <ConfirmDialog />
{/if}

{#key app.notice?.id}<NoticeToast />{/key}

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

  .splitter-col {
    margin: 0 1px;
  }

  .splitter-row {
    margin: 1px 0;
  }

  @media (max-width: 1100px) {
    .layout {
      display: grid;
      grid-template-columns: 1fr !important;
      gap: 8px;
      overflow: auto;
    }

    .layout:not(.single-column) {
      grid-template-rows: minmax(620px, 1fr) minmax(620px, 1fr);
    }

    .layout.single-column {
      grid-template-rows: minmax(620px, 1fr);
    }

    .splitter-col {
      display: none;
    }
  }

  @media (max-width: 760px) {
    .layout:not(.single-column) {
      grid-template-rows: minmax(70vh, 820px) minmax(65vh, 680px);
    }

    .layout {
      padding: 6px;
    }

    .splitter-row { min-height: 12px; touch-action: none; }
  }
</style>
