<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { Check, TrafficCone, X } from '../lib/fontawesome-icons';
  import { api } from '../lib/api';
  import { actionUnits } from '../lib/classify';
  import { focusTrap } from '../lib/focus';
  import { app, askConfirm, canWrite, showNotice } from '../lib/state.svelte';
  import type { Vehicle } from '../lib/types';

  const actions = $derived(actionUnits(app.vehicles));

  let sent = $state<Record<number, string>>({});
  let pending = $state<Set<number>>(new Set());

  function close(): void {
    app.actionsOpen = false;
  }

  async function trigger(v: Vehicle, mode: string): Promise<void> {
    if (pending.has(v.id)) return;
    if (!(await askConfirm(`${v.name || v.game_vehicle_id}: "${mode}" auslösen?`))) return;
    pending = new Set(pending).add(v.id);
    try {
      await api('vehicles_alarm', { vehicle_id: v.id, mode });
      sent = { ...sent, [v.id]: mode };
      showNotice(`${mode} gesendet`);
    } catch (err) {
      app.lastError = (err as Error).message;
    } finally {
      const next = new Set(pending);
      next.delete(v.id);
      pending = next;
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !app.confirmDialog) close();
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()} onkeydown={onKeydown} use:focusTrap={{ initial: '[data-autofocus]' }} tabindex="-1">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="actions-title">
    <header>
      <span class="icon"><FaIcon icon={TrafficCone} size={16} /></span>
      <h3 id="actions-title">Aktionen</h3>
      <button class="ghost" data-tooltip="Schließen" aria-label="Schließen" data-autofocus onclick={close}><FaIcon icon={X} size={18} /></button>
    </header>
    <div class="body">
      {#each actions as a (a.id)}
        <div class="card">
          <div class="card-head">
            <span class="card-name">{a.name || a.game_vehicle_id}</span>
            {#if sent[a.id]}
              <span class="sent"><FaIcon icon={Check} size={13} /> {sent[a.id]}</span>
            {/if}
          </div>
          <div class="modes">
            {#each (a.modes ?? '').split(',').filter(Boolean) as mode (mode)}
              <button class="mode" class:release={/freigeben|aufheben/i.test(mode)} disabled={pending.has(a.id) || !canWrite()} onclick={() => void trigger(a, mode)}>
                {pending.has(a.id) ? 'Wird gesendet …' : mode}
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <div class="empty-hint">Keine Aktionen verfügbar</div>
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 6, 10, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .modal {
    width: min(520px, 92vw);
    max-height: 85vh;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--panel-header);
    border-bottom: 1px solid var(--border);
  }

  header .icon {
    color: var(--warn);
    display: inline-flex;
  }

  h3 {
    margin: 0;
    font-size: 15px;
    flex: 1;
  }

  .body {
    padding: 14px 16px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-raised);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .card-name {
    font-weight: 700;
    flex: 1;
  }

  .sent {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--good);
  }

  .modes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 6px;
  }

  .mode {
    justify-content: center;
    border-color: var(--status-4-border);
    background: rgba(230, 60, 60, 0.1);
  }

  .mode:hover:not(:disabled) {
    background: rgba(230, 60, 60, 0.22);
    border-color: var(--status-4-start);
  }

  .mode.release {
    border-color: var(--status-1-border);
    background: rgba(25, 201, 146, 0.08);
  }

  .mode.release:hover:not(:disabled) {
    background: rgba(25, 201, 146, 0.18);
    border-color: var(--status-1-start);
  }
</style>
