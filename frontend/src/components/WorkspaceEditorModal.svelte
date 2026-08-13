<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { ArrowDown, ArrowUp, Copy, ExternalLink, LayoutGrid, Save, Trash2, X } from '../lib/fontawesome-icons';
  import { focusTrap } from '../lib/focus';
  import { AREA_IDS, cloneWorkspace, DEFAULT_WORKSPACES, nextWorkspaceId, PANEL_IDS, type AreaId, type PanelId, type WorkspaceLayout } from '../lib/workspaces';

  let {
    workspaces,
    activeId,
    onSelect,
    onSave,
    onDelete,
    onOpenTab,
    onClose,
  }: {
    workspaces: WorkspaceLayout[];
    activeId: string;
    onSelect: (id: string) => void;
    onSave: (workspace: WorkspaceLayout) => void;
    onDelete: (id: string) => void;
    onOpenTab: (id: string) => void;
    onClose: () => void;
  } = $props();

  const panelLabels: Record<PanelId, string> = {
    map: 'Karte',
    vehicles: 'Fahrzeuge',
    events: 'Einsätze',
    current_event: 'Aktueller Einsatz',
    logs: 'Funk',
    hospitals: 'Krankenhäuser',
  };
  const areaLabels: Record<AreaId, string> = {
    leftTop: 'Links oben',
    leftBottom: 'Links unten',
    rightTop: 'Rechts oben',
    rightBottom: 'Rechts unten',
  };

  let draft = $state(cloneWorkspace(DEFAULT_WORKSPACES[0]));
  let loadedDraftId = $state('');

  $effect(() => {
    const selected = workspaces.find((workspace) => workspace.id === activeId);
    if (selected && loadedDraftId !== activeId) {
      draft = cloneWorkspace(selected);
      loadedDraftId = activeId;
    }
  });

  function areaFor(panel: PanelId): AreaId | 'hidden' {
    return AREA_IDS.find((area) => draft.areas[area].includes(panel)) ?? 'hidden';
  }

  function placePanel(panel: PanelId, target: AreaId | 'hidden'): void {
    const areas = Object.fromEntries(AREA_IDS.map((area) => [area, draft.areas[area].filter((item) => item !== panel)])) as Record<AreaId, PanelId[]>;
    if (target !== 'hidden') areas[target] = [...areas[target], panel];
    draft = { ...draft, areas };
  }

  function move(panel: PanelId, direction: -1 | 1): void {
    const area = areaFor(panel);
    if (area === 'hidden') return;
    const panels = [...draft.areas[area]];
    const index = panels.indexOf(panel);
    const target = index + direction;
    if (target < 0 || target >= panels.length) return;
    [panels[index], panels[target]] = [panels[target], panels[index]];
    draft = { ...draft, areas: { ...draft.areas, [area]: panels } };
  }

  function save(closeAfterwards = true): void {
    draft = { ...draft, name: draft.name.trim() || 'Unbenannte Ansicht' };
    onSave(cloneWorkspace(draft));
    if (closeAfterwards) onClose();
  }

  function duplicate(): void {
    const copy = { ...cloneWorkspace(draft), id: nextWorkspaceId(), name: `${draft.name.trim() || 'Ansicht'} Kopie` };
    onSave(copy);
    onSelect(copy.id);
  }

  function openTab(): void {
    save(false);
    onOpenTab(draft.id);
  }

  function selectWorkspace(id: string): void {
    onSelect(id);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onClose();
  }
</script>

<div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()} onkeydown={onKeydown} use:focusTrap={{ initial: '[data-autofocus]' }} tabindex="-1">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="workspace-title">
    <header>
      <FaIcon icon={LayoutGrid} size={17} />
      <h3 id="workspace-title">Arbeitsansicht bearbeiten</h3>
      <button class="ghost icon-button" data-autofocus aria-label="Schließen" onclick={onClose}><FaIcon icon={X} size={18} /></button>
    </header>

    <div class="toolbar">
      <label>
        <span>Ansicht</span>
        <select value={activeId} onchange={(event) => selectWorkspace(event.currentTarget.value)}>
          {#each workspaces as workspace (workspace.id)}
            <option value={workspace.id}>{workspace.name}</option>
          {/each}
        </select>
      </label>
      <button class="ghost" onclick={duplicate}><FaIcon icon={Copy} size={14} /> Duplizieren</button>
      <button class="ghost" onclick={openTab}><FaIcon icon={ExternalLink} size={14} /> In neuem Tab</button>
    </div>

    <div class="body">
      <label class="name-field">
        <span>Name</span>
        <input type="text" maxlength="60" bind:value={draft.name} />
      </label>

      <div class="panel-table">
        <div class="table-head"><span>Panel</span><span>Bereich</span><span>Reihenfolge</span></div>
        {#each PANEL_IDS as panel (panel)}
          {@const area = areaFor(panel)}
          {@const position = area === 'hidden' ? -1 : draft.areas[area].indexOf(panel)}
          {@const lastPosition = area === 'hidden' ? -1 : draft.areas[area].length - 1}
          <div class="panel-row">
            <span class="panel-name">{panelLabels[panel]}</span>
            <select aria-label={`${panelLabels[panel]} platzieren`} value={area} onchange={(event) => placePanel(panel, event.currentTarget.value as AreaId | 'hidden')}>
              {#each AREA_IDS as candidate (candidate)}<option value={candidate}>{areaLabels[candidate]}</option>{/each}
              <option value="hidden">Ausgeblendet</option>
            </select>
            <span class="order-actions">
              <button class="ghost icon-button" aria-label={`${panelLabels[panel]} nach vorne`} disabled={area === 'hidden' || position === 0} onclick={() => move(panel, -1)}><FaIcon icon={ArrowUp} size={14} /></button>
              <button class="ghost icon-button" aria-label={`${panelLabels[panel]} nach hinten`} disabled={area === 'hidden' || position === lastPosition} onclick={() => move(panel, 1)}><FaIcon icon={ArrowDown} size={14} /></button>
            </span>
          </div>
        {/each}
      </div>

      <div class="area-settings">
        {#each AREA_IDS as area (area)}
          <label>
            <span>{areaLabels[area]}</span>
            <select bind:value={draft.directions[area]} disabled={draft.areas[area].length < 2}>
              <option value="row">Nebeneinander</option>
              <option value="column">Untereinander</option>
            </select>
          </label>
        {/each}
      </div>
    </div>

    <footer>
      {#if activeId !== 'standard'}
        <button class="ghost delete" onclick={() => onDelete(activeId)}><FaIcon icon={Trash2} size={14} /> Ansicht löschen</button>
      {/if}
      <span class="spacer"></span>
      <button onclick={onClose}>Abbrechen</button>
      <button class="primary save" onclick={() => save()}><FaIcon icon={Save} size={14} /> Speichern</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; background: rgba(4, 6, 10, 0.66); }
  .modal { width: min(680px, 94vw); max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow); }
  header, footer { display: flex; align-items: center; gap: 9px; padding: 11px 14px; background: var(--panel-header); }
  header { border-bottom: 1px solid var(--border); }
  footer { border-top: 1px solid var(--border); }
  header :global(svg) { color: var(--text-dim); }
  h3 { margin: 0; flex: 1; font-size: 15px; }
  .toolbar { display: flex; align-items: end; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .toolbar label { flex: 1; }
  label { display: flex; flex-direction: column; gap: 4px; color: var(--text-dim); font-size: 12px; }
  .body { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
  .name-field input { width: 100%; }
  .panel-table { border: 1px solid var(--border); }
  .table-head, .panel-row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(150px, 1fr) 84px; align-items: center; gap: 10px; min-height: 42px; padding: 6px 10px; }
  .table-head { min-height: 32px; color: var(--text-dim); background: var(--bg-raised); font-size: 11px; }
  .panel-row + .panel-row { border-top: 1px solid var(--border); }
  .panel-name { font-weight: 600; }
  .order-actions { display: flex; justify-content: flex-end; gap: 3px; }
  .area-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .spacer { flex: 1; }
  .delete { color: var(--danger-text); }
  .save { background: var(--accent); border-color: var(--accent); }
  .icon-button { width: 28px; height: 28px; padding: 0; justify-content: center; }
  @media (max-width: 620px) {
    .toolbar { flex-wrap: wrap; }
    .toolbar label { flex-basis: 100%; }
    .table-head, .panel-row { grid-template-columns: minmax(90px, 1fr) minmax(130px, 1fr) 64px; gap: 6px; padding-inline: 7px; }
    .area-settings { grid-template-columns: 1fr; }
  }
</style>
