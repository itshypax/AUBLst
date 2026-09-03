<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { MapPin, X } from '../lib/fontawesome-icons';
  import { api } from '../lib/api';
  import { focusTrap } from '../lib/focus';
  import { refreshState } from '../lib/polling';
  import { roadLocationLabel } from '../lib/routing';
  import { app, canWrite, showNotice } from '../lib/state.svelte';

  const pos = app.createEventPos!;
  const locationLabel = roadLocationLabel(pos, app.routing);

  let name = $state('');
  let errorMsg = $state('');
  let input: HTMLInputElement | undefined = $state();
  let busy = $state(false);

  $effect(() => {
    input?.focus();
  });

  function close(): void {
    app.createEventPos = null;
  }

  async function create(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    try {
      busy = true;
      errorMsg = '';
      await api('events_create', { name: trimmed, x: pos.x, y: pos.y });
      app.createEventPos = null;
      showNotice(`Einsatz "${trimmed}" angelegt`);
      void refreshState();
    } catch (err) {
      errorMsg = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !busy) close();
    else if (e.key === 'Enter' && e.target === input) {
      e.preventDefault();
      void create();
    }
  }

  function onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) close();
  }
</script>

<div class="backdrop" onclick={onBackdropClick} onkeydown={onKeydown} role="presentation" use:focusTrap={{ initial: '[data-autofocus]' }} tabindex="-1">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="create-event-title">
    <header>
      <span class="icon"><FaIcon icon={MapPin} size={15} /></span>
      <h3 id="create-event-title">Neuer Einsatz</h3>
      <button class="ghost" data-tooltip="Abbrechen" aria-label="Abbrechen" disabled={busy} onclick={close}><FaIcon icon={X} size={16} /></button>
    </header>
    <div class="body">
      <span class="meta" title={`Position ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}`}>{locationLabel ?? `Position ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}`}</span>
      <input type="text" bind:this={input} bind:value={name} placeholder="Einsatzstichwort" data-autofocus disabled={busy} />
      {#if errorMsg}
        <span class="error">{errorMsg}</span>
      {/if}
    </div>
    <footer>
      <button disabled={busy} onclick={close}>Abbrechen</button>
      <button class="primary" disabled={!name.trim() || busy || !canWrite()} onclick={() => void create()}>{busy ? 'Wird angelegt …' : 'Anlegen'}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 6, 10, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }

  .dialog {
    width: min(380px, 90vw);
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--panel-header);
    border-bottom: 1px solid var(--border);
  }

  header .icon {
    color: var(--accent);
    display: inline-flex;
  }

  h3 {
    margin: 0;
    font-size: 14px;
    flex: 1;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
  }

  .meta {
    font-size: 12px;
    color: var(--text-dim);
  }

  .error {
    color: var(--danger);
    font-size: 12px;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }
</style>
