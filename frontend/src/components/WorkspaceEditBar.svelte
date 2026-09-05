<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { Check, Plus, RefreshCw } from '../lib/fontawesome-icons';
  import { MULTI_INSTANCE_PANELS, PANEL_IDS, PANEL_LABELS, type PanelId, type WorkspaceLayout } from '../lib/workspaces';

  let {
    layout,
    onAdd,
    onReset,
    onDone,
  }: {
    layout: WorkspaceLayout;
    onAdd: (type: PanelId) => void;
    onReset: () => void;
    onDone: () => void;
  } = $props();

  function addable(type: PanelId): boolean {
    return MULTI_INSTANCE_PANELS.has(type) || !layout.panels.some((panel) => panel.type === type);
  }
</script>

<div class="edit-bar" role="toolbar" aria-label="Anordnung bearbeiten">
  <span class="hint">Fenster am blauen Kopf ziehen, an der Ecke rechts unten die Größe ändern. Pfeiltasten verschieben, Umschalt + Pfeile ändern die Größe.</span>
  <span class="add-group">
    {#each PANEL_IDS as type (type)}
      <button class="ghost add" disabled={!addable(type)} onclick={() => onAdd(type)}>
        <FaIcon icon={Plus} size={12} />
        {PANEL_LABELS[type]}
      </button>
    {/each}
  </span>
  <button class="ghost" onclick={onReset}><FaIcon icon={RefreshCw} size={13} /> Zurücksetzen</button>
  <button class="primary" onclick={onDone}><FaIcon icon={Check} size={13} /> Fertig</button>
</div>

<style>
  .edit-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--panel-header);
  }

  .hint {
    flex: 1 1 100%;
    color: var(--text-dim);
    font-size: 12px;
  }

  .add-group {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-right: auto;
  }

  .add {
    padding: 4px 8px;
    font-size: 12px;
  }

  .primary {
    background: var(--accent);
    border-color: var(--accent);
  }
</style>
