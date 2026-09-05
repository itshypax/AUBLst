<script lang="ts">
  import { onDestroy } from 'svelte';
  import AssignModal from './components/AssignModal.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import ConnectionLostBanner from './components/ConnectionLostBanner.svelte';
  import CreateEventDialog from './components/CreateEventDialog.svelte';
  import SessionGate from './components/SessionGate.svelte';
  import Topbar from './components/Topbar.svelte';
  import Tooltip from './components/Tooltip.svelte';
  import VehicleContextMenu from './components/VehicleContextMenu.svelte';
  import WorkspaceEditBar from './components/WorkspaceEditBar.svelte';
  import WorkspaceGrid from './components/WorkspaceGrid.svelte';
  import NoticeToast from './components/NoticeToast.svelte';
  import { loadGroupOverrides } from './lib/classify';
  import { startPolling } from './lib/polling';
  import { configureSounds, loadSoundManifest } from './lib/sounds';
  import {
    canWrite,    app,
    closeEventFromSync,
    focusVehicleFromSync,
    initSettings,
    openEventFromSync,
    reconcileSyncedEvent,
    setDispatchSelectionFromSync,
    setHighlightFromSync,
    showNotice,
  } from './lib/state.svelte';
  import { fetchLayout, importLayoutFromServer } from './lib/layout-library';
  import { startUiSync, uiSyncScope, updateUiSyncPresence } from './lib/ui-sync';
  import {
    addPanel,
    cloneWorkspace,
    loadWorkspaces,
    panelTypes,
    resetWorkspaceLayout,
    saveWorkspaces,
    setWorkspaceInUrl,
    sharedLayoutCodeFromUrl,
    workspaceIdFromUrl,
    nextWorkspaceId,
    workspaceUrl,
    type PanelId,
    type WorkspaceLayout,
  } from './lib/workspaces';

  const pageParams = new URLSearchParams(location.search);
  const localHostname =
    location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1';
  const routingEditorRequested = import.meta.env.DEV && localHostname && pageParams.get('routing_editor') === '1';
  const monitorRequested = pageParams.get('view') === 'monitor' || pageParams.get('monitor') === '1';
  const routingEditorModId = pageParams.get('mod_id')?.trim() ?? '';
  let RoutingEditorComponent = $state<null | (typeof import('./components/RoutingEditorPage.svelte'))['default']>(null);
  let AlarmMonitorComponent = $state<null | (typeof import('./components/AlarmMonitorPage.svelte'))['default']>(null);
  let ActionsComponent = $state<null | (typeof import('./components/ActionsModal.svelte'))['default']>(null);
  let HospitalAssignmentComponent = $state<
    null | (typeof import('./components/HospitalAssignmentModal.svelte'))['default']
  >(null);
  let OverviewComponent = $state<null | (typeof import('./components/SessionOverviewModal.svelte'))['default']>(null);
  let WorkspaceEditorComponent = $state<null | (typeof import('./components/WorkspaceEditorModal.svelte'))['default']>(
    null,
  );

  if (routingEditorRequested) {
    void import('./components/RoutingEditorPage.svelte').then((module) => (RoutingEditorComponent = module.default));
  } else if (monitorRequested) {
    void import('./components/AlarmMonitorPage.svelte').then((module) => (AlarmMonitorComponent = module.default));
  }

  if (!routingEditorRequested) {
    initSettings();
    void loadGroupOverrides();
    void loadSoundManifest().then(() => {
      configureSounds(app.soundEnabled, app.soundVolume, app.soundProfile);
      startPolling();
    });
  }

  const loadedWorkspaces = loadWorkspaces();
  const initialWorkspaceId = workspaceIdFromUrl(loadedWorkspaces);
  let workspaces = $state(loadedWorkspaces);
  let activeWorkspaceId = $state(initialWorkspaceId);
  let workspaceEditorOpen = $state(false);
  let layoutEditing = $state(false);
  const activeWorkspace = $derived(workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0]);
  const activePanelTypes = $derived(panelTypes(activeWorkspace));
  const hasCurrentEventPanel = $derived(activePanelTypes.includes('current_event'));
  const showSessionGate = $derived(app.lastSuccessfulSync === null && !app.stateHealthy);
  const connectionLost = $derived(app.lastSuccessfulSync !== null && !app.stateHealthy);

  $effect(() => {
    if (app.actionsOpen && !ActionsComponent) {
      void import('./components/ActionsModal.svelte').then((module) => (ActionsComponent = module.default));
    }
    if (app.hospitalAssignmentVehicleId !== null && !HospitalAssignmentComponent) {
      void import('./components/HospitalAssignmentModal.svelte').then(
        (module) => (HospitalAssignmentComponent = module.default),
      );
    }
    if (app.sessionOverviewOpen && !OverviewComponent) {
      void import('./components/SessionOverviewModal.svelte').then((module) => (OverviewComponent = module.default));
    }
    if (workspaceEditorOpen && !WorkspaceEditorComponent) {
      void import('./components/WorkspaceEditorModal.svelte').then(
        (module) => (WorkspaceEditorComponent = module.default),
      );
    }
  });

  const stopUiSync = monitorRequested
    ? () => undefined
    : startUiSync({
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
    if (monitorRequested) return;
    updateUiSyncPresence(
      uiSyncScope(app.apiBase, app.sessionToken),
      activeWorkspace.id,
      activePanelTypes,
      app.assignEvent?.id ?? null,
      app.dispatchVehicleIds,
      Boolean(app.assignEvent && !app.currentEventHostedRemotely),
    );
  });

  $effect(() => {
    void app.events;
    reconcileSyncedEvent();
  });

  function saveWorkspace(workspace: WorkspaceLayout): void {
    const index = workspaces.findIndex((item) => item.id === workspace.id);
    workspaces =
      index === -1
        ? [...workspaces, cloneWorkspace(workspace)]
        : workspaces.map((item) => (item.id === workspace.id ? cloneWorkspace(workspace) : item));
    saveWorkspaces(workspaces);
  }

  function selectWorkspace(id: string): void {
    if (!workspaces.some((item) => item.id === id)) return;
    activeWorkspaceId = id;
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

  function resetLayout(): void {
    saveWorkspace(resetWorkspaceLayout(activeWorkspace));
  }

  function addPanelToLayout(type: PanelId): void {
    const next = addPanel(activeWorkspace, type);
    if (next) saveWorkspace(next);
    else showNotice('Kein Platz für ein weiteres Fenster. Erst ein Fenster verkleinern oder entfernen.', 'error');
  }

  function startLayoutEditing(): void {
    workspaceEditorOpen = false;
    layoutEditing = true;
  }

  // Geteilter Link (?layout=CODE): sobald eine Sitzung steht, das Layout vom
  // Server als eigene Kopie mit neuem Code übernehmen. Ohne Schreibrecht
  // bleibt es eine lokale Kopie ohne Code.
  const sharedLayoutCode = monitorRequested || routingEditorRequested ? null : sharedLayoutCodeFromUrl();
  let sharedLayoutApplied = false;
  $effect(() => {
    if (!sharedLayoutCode || sharedLayoutApplied || !app.stateHealthy) return;
    sharedLayoutApplied = true;
    const imported = canWrite()
      ? importLayoutFromServer(sharedLayoutCode)
      : fetchLayout(sharedLayoutCode).then((layout) => {
          const local = { ...layout, id: nextWorkspaceId() };
          delete local.code;
          return local;
        });
    void imported
      .then((layout) => {
        saveWorkspace(layout);
        selectWorkspace(layout.id);
        showNotice(layout.code ? `Ansicht „${layout.name}“ übernommen, eigener Code ${layout.code}` : `Ansicht „${layout.name}“ lokal übernommen`);
      })
      .catch((error) => showNotice((error as Error).message, 'error'));
  });
</script>

{#if routingEditorRequested}
  {#if RoutingEditorComponent}<RoutingEditorComponent modId={routingEditorModId} />{/if}
{:else if monitorRequested}
  {#if AlarmMonitorComponent}<AlarmMonitorComponent />{/if}
{:else}
  <Topbar
    onResetLayout={resetLayout}
    onOpenWorkspaceEditor={() => (workspaceEditorOpen = true)}
    onEditLayout={startLayoutEditing}
    workspaceName={activeWorkspace.name}
  />

  {#if showSessionGate}
    <SessionGate />
  {:else}
    {#if connectionLost}<ConnectionLostBanner />{/if}
    {#if layoutEditing}
      <WorkspaceEditBar layout={activeWorkspace} onAdd={addPanelToLayout} onReset={resetLayout} onDone={() => (layoutEditing = false)} />
    {/if}
    <main class="layout">
      <WorkspaceGrid
        layout={activeWorkspace}
        editing={layoutEditing}
        onChange={saveWorkspace}
        onNotice={(message) => showNotice(message, 'error')}
      />
    </main>
  {/if}

  {#if workspaceEditorOpen && WorkspaceEditorComponent}
    <WorkspaceEditorComponent
      {workspaces}
      activeId={activeWorkspaceId}
      onSelect={selectWorkspace}
      onSave={saveWorkspace}
      onDelete={deleteWorkspace}
      onOpenTab={openWorkspaceTab}
      onEditLayout={startLayoutEditing}
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

  {#if app.actionsOpen && ActionsComponent}
    <ActionsComponent />
  {/if}

  {#if app.sessionOverviewOpen && OverviewComponent}
    <OverviewComponent />
  {/if}

  {#if app.hospitalAssignmentVehicleId !== null && HospitalAssignmentComponent}
    <HospitalAssignmentComponent />
  {/if}

  {#if app.confirmDialog}
    <ConfirmDialog />
  {/if}
{/if}

{#if routingEditorRequested && app.confirmDialog}
  <ConfirmDialog />
{/if}

<NoticeToast />

<Tooltip />

<style>
  .layout {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
  }
</style>
