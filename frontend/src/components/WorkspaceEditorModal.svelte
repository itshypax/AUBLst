<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { onMount } from 'svelte';
  import { Copy, Download, ExternalLink, LayoutGrid, Plus, RefreshCw, Save, Trash2, Upload, X } from '../lib/fontawesome-icons';
  import { focusTrap } from '../lib/focus';
  import { deleteLayoutFromServer, fetchLayout, fetchLayoutList, layoutShareUrl, saveLayoutToServer, type LayoutSummary } from '../lib/layout-library';
  import { askConfirm, canWrite, showNotice } from '../lib/state.svelte';
  import { cloneWorkspace, DEFAULT_WORKSPACES, nextWorkspaceId, PANEL_LABELS, parseWorkspaceImport, serializeWorkspace, type WorkspaceLayout } from '../lib/workspaces';

  let {
    workspaces,
    activeId,
    onSelect,
    onSave,
    onDelete,
    onOpenTab,
    onEditLayout,
    onClose,
  }: {
    workspaces: WorkspaceLayout[];
    activeId: string;
    onSelect: (id: string) => void;
    onSave: (workspace: WorkspaceLayout) => void;
    onDelete: (id: string) => void;
    onOpenTab: (id: string) => void;
    onEditLayout: () => void;
    onClose: () => void;
  } = $props();

  const active = $derived(workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0]);
  let name = $state('');
  let loadedNameFor = $state('');
  let importError = $state('');
  let importInput = $state<HTMLInputElement>();
  let serverLayouts = $state<LayoutSummary[]>([]);
  let serverError = $state('');
  let serverBusy = $state(false);
  let serverLoaded = $state(false);
  const shareUrl = $derived(active?.code ? layoutShareUrl(active.code) : '');

  async function loadServerList(): Promise<void> {
    serverBusy = true;
    serverError = '';
    try {
      serverLayouts = await fetchLayoutList();
      serverLoaded = true;
    } catch (error) {
      serverError = (error as Error).message;
    } finally {
      serverBusy = false;
    }
  }

  onMount(() => {
    void loadServerList();
  });

  async function saveToServer(asNew: boolean): Promise<void> {
    if (serverBusy) return;
    serverBusy = true;
    serverError = '';
    try {
      const saved = await saveLayoutToServer({ ...cloneWorkspace(active), name: name.trim() || active.name }, asNew);
      onSave(saved);
      showNotice(`„${saved.name}“ auf dem Server gespeichert, Code ${saved.code}`);
      serverBusy = false;
      await loadServerList();
    } catch (error) {
      serverError = (error as Error).message;
      serverBusy = false;
    }
  }

  async function loadFromServer(code: string): Promise<void> {
    if (serverBusy) return;
    serverBusy = true;
    serverError = '';
    try {
      const layout = await fetchLayout(code);
      onSave(layout);
      onSelect(layout.id);
      showNotice(`„${layout.name}“ vom Server übernommen`);
    } catch (error) {
      serverError = (error as Error).message;
    } finally {
      serverBusy = false;
    }
  }

  async function removeFromServer(summary: LayoutSummary): Promise<void> {
    if (serverBusy) return;
    if (!(await askConfirm(`„${summary.name}“ (${summary.code}) vom Server löschen? Andere verlieren damit den Zugriff über den Code.`))) return;
    serverBusy = true;
    serverError = '';
    try {
      await deleteLayoutFromServer(summary.code);
      for (const workspace of workspaces) {
        if (workspace.code === summary.code) {
          const local = cloneWorkspace(workspace);
          delete local.code;
          onSave(local);
        }
      }
      serverBusy = false;
      await loadServerList();
    } catch (error) {
      serverError = (error as Error).message;
      serverBusy = false;
    }
  }

  async function copyShareLink(): Promise<void> {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      showNotice('Link kopiert');
    } catch {
      showNotice('Link konnte nicht kopiert werden, bitte aus dem Feld übernehmen', 'error');
    }
  }

  $effect(() => {
    if (active && loadedNameFor !== active.id) {
      name = active.name;
      loadedNameFor = active.id;
    }
  });

  function panelSummary(workspace: WorkspaceLayout): string {
    if (!workspace.panels.length) return 'Keine Fenster';
    return workspace.panels.map((panel) => PANEL_LABELS[panel.type]).join(', ');
  }

  function rename(): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === active.name) return;
    onSave({ ...cloneWorkspace(active), name: trimmed.slice(0, 60) });
  }

  function duplicate(): void {
    const copy = { ...cloneWorkspace(active), id: nextWorkspaceId(), name: `${active.name.trim() || 'Ansicht'} Kopie` };
    delete copy.code;
    onSave(copy);
    onSelect(copy.id);
  }

  function createNew(): void {
    const created = { ...cloneWorkspace(DEFAULT_WORKSPACES[0]), id: nextWorkspaceId(), name: 'Neue Ansicht' };
    onSave(created);
    onSelect(created.id);
  }

  function exportActive(): void {
    const blob = new Blob([serializeWorkspace(active)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${active.name.replace(/[^\wäöüÄÖÜß-]+/g, '_') || 'ansicht'}.aublst-layout.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(event: Event): Promise<void> {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    importError = '';
    try {
      const imported = parseWorkspaceImport(await file.text());
      if (!imported) throw new Error('Die Datei enthält keine Arbeitsansicht.');
      const workspace = { ...imported, id: nextWorkspaceId() };
      onSave(workspace);
      onSelect(workspace.id);
    } catch (error) {
      importError = (error as Error).message;
    } finally {
      if (importInput) importInput.value = '';
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onClose();
  }
</script>

<div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()} onkeydown={onKeydown} use:focusTrap={{ initial: '[data-autofocus]' }} tabindex="-1">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="workspace-title">
    <header>
      <FaIcon icon={LayoutGrid} size={17} />
      <h3 id="workspace-title">Ansichten</h3>
      <button class="ghost icon-button" data-autofocus aria-label="Schließen" onclick={onClose}><FaIcon icon={X} size={18} /></button>
    </header>

    <div class="body">
      <ul class="workspace-list" aria-label="Gespeicherte Ansichten">
        {#each workspaces as workspace (workspace.id)}
          <li>
            <button class="workspace-row" class:active={workspace.id === activeId} aria-current={workspace.id === activeId ? 'true' : undefined} onclick={() => onSelect(workspace.id)}>
              <span class="workspace-name">{workspace.name}{#if workspace.code}<span class="code" title="Teilcode">{workspace.code}</span>{/if}</span>
              <span class="workspace-panels">{panelSummary(workspace)}</span>
            </button>
          </li>
        {/each}
      </ul>

      <div class="active-section">
        <label class="name-field">
          <span>Name der Ansicht</span>
          <input type="text" maxlength="60" bind:value={name} onblur={rename} onkeydown={(event) => event.key === 'Enter' && rename()} />
        </label>
        <div class="actions">
          <button class="primary" onclick={onEditLayout}><FaIcon icon={LayoutGrid} size={14} /> Anordnung bearbeiten</button>
          <button class="ghost" onclick={duplicate}><FaIcon icon={Copy} size={14} /> Duplizieren</button>
          <button class="ghost" onclick={() => onOpenTab(activeId)}><FaIcon icon={ExternalLink} size={14} /> In neuem Tab</button>
          {#if activeId !== 'standard'}
            <button class="ghost delete" onclick={() => onDelete(activeId)}><FaIcon icon={Trash2} size={14} /> Löschen</button>
          {/if}
        </div>
      </div>

      <section class="server-section" aria-labelledby="server-title">
        <div class="section-head">
          <h4 id="server-title">Server-Bibliothek</h4>
          <button class="ghost icon-button" aria-label="Liste neu laden" disabled={serverBusy} onclick={() => void loadServerList()}><FaIcon icon={RefreshCw} size={14} /></button>
        </div>
        <div class="actions">
          <button class="ghost" disabled={serverBusy || !canWrite()} onclick={() => void saveToServer(false)}>
            <FaIcon icon={Upload} size={14} /> {active?.code ? `Auf Server speichern (${active.code})` : 'Auf Server speichern'}
          </button>
          {#if active?.code}
            <button class="ghost" disabled={serverBusy || !canWrite()} onclick={() => void saveToServer(true)}><FaIcon icon={Copy} size={14} /> Als neues Layout speichern</button>
            <button class="ghost" onclick={() => void copyShareLink()}><FaIcon icon={ExternalLink} size={14} /> Link kopieren</button>
          {/if}
        </div>
        {#if shareUrl}
          <label class="share-field">
            <span>Teil-Link</span>
            <input type="text" readonly value={shareUrl} onfocus={(event) => event.currentTarget.select()} />
          </label>
        {/if}
        {#if serverError}<span class="import-error" role="alert">{serverError}</span>{/if}
        {#if serverLoaded && !serverLayouts.length}
          <span class="server-empty">Noch keine Layouts auf dem Server.</span>
        {/if}
        {#if serverLayouts.length}
          <ul class="server-list" aria-label="Layouts auf dem Server">
            {#each serverLayouts as summary (summary.code)}
              <li>
                <span class="server-name">{summary.name}<span class="code">{summary.code}</span></span>
                <span class="server-actions">
                  <button class="ghost" disabled={serverBusy} aria-label={`${summary.name} laden`} onclick={() => void loadFromServer(summary.code)}><FaIcon icon={Download} size={14} /> Laden</button>
                  <button class="ghost icon-button delete" disabled={serverBusy || !canWrite()} aria-label={`${summary.name} vom Server löschen`} onclick={() => void removeFromServer(summary)}><FaIcon icon={Trash2} size={14} /></button>
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <div class="file-section">
        <button class="ghost" onclick={createNew}><FaIcon icon={Plus} size={14} /> Neue Ansicht</button>
        <button class="ghost" onclick={exportActive}><FaIcon icon={Download} size={14} /> Als Datei exportieren</button>
        <button class="ghost" onclick={() => importInput?.click()}><FaIcon icon={Upload} size={14} /> Datei importieren</button>
        <input bind:this={importInput} class="import-input" type="file" accept="application/json,.json" aria-label="Ansicht aus Datei importieren" onchange={(event) => void importFile(event)} />
        {#if importError}<span class="import-error" role="alert">{importError}</span>{/if}
      </div>
    </div>

    <footer>
      <span class="spacer"></span>
      <button onclick={onClose}><FaIcon icon={Save} size={14} /> Schließen</button>
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
  .body { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
  .workspace-list { margin: 0; padding: 0; list-style: none; border: 1px solid var(--border); }
  .workspace-list li + li { border-top: 1px solid var(--border); }
  .workspace-row { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: 100%; padding: 8px 10px; border: 0; border-radius: 0; background: transparent; color: var(--text); text-align: left; }
  .workspace-row.active { background: var(--bg-raised); box-shadow: inset 3px 0 0 var(--accent); }
  .workspace-name { display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .code { padding: 1px 6px; border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-dim); font-family: ui-monospace, monospace; font-size: 11px; font-weight: 500; letter-spacing: 0.08em; }
  .workspace-panels { color: var(--text-dim); font-size: 12px; }
  .active-section { display: flex; flex-direction: column; gap: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; color: var(--text-dim); font-size: 12px; }
  .name-field input { width: 100%; }
  .actions, .file-section { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .file-section { padding-top: 10px; border-top: 1px solid var(--border); }
  .server-section { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid var(--border); }
  .section-head { display: flex; align-items: center; gap: 8px; }
  .section-head h4 { margin: 0; flex: 1; font-size: 13px; }
  .share-field input { width: 100%; font-family: ui-monospace, monospace; font-size: 12px; }
  .server-empty { color: var(--text-dim); font-size: 12px; }
  .server-list { margin: 0; padding: 0; list-style: none; border: 1px solid var(--border); }
  .server-list li { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
  .server-list li + li { border-top: 1px solid var(--border); }
  .server-name { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-actions { display: flex; gap: 4px; }
  .import-input { display: none; }
  .import-error { flex-basis: 100%; color: var(--danger-text); font-size: 12px; }
  .spacer { flex: 1; }
  .delete { color: var(--danger-text); }
  .primary { background: var(--accent); border-color: var(--accent); }
  .icon-button { width: 28px; height: 28px; padding: 0; justify-content: center; }
</style>
