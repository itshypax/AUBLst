<script lang="ts">
  import { onMount } from 'svelte';
  import AdminLog from './AdminLog.svelte';
  import AdminMetrics from './AdminMetrics.svelte';
  import AdminMods from './AdminMods.svelte';
  import AdminSessions from './AdminSessions.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import { loadOperatorKey, operatorPost, OperatorKeyError, saveOperatorKey } from '../../lib/admin';
  import { app } from '../../lib/state.svelte';

  const tabs = [
    { id: 'mods', label: 'Mods' },
    { id: 'sessions', label: 'Sitzungen' },
    { id: 'metrics', label: 'Messwerte' },
    { id: 'log', label: 'Adapter-Log' },
  ] as const;

  type TabId = (typeof tabs)[number]['id'];

  function tabFromHash(): TabId {
    const id = location.hash.replace('#', '');
    return tabs.some((tab) => tab.id === id) ? (id as TabId) : 'mods';
  }

  let key = $state(loadOperatorKey());
  let input = $state('');
  let error = $state('');
  let checking = $state(false);
  let tab = $state<TabId>(tabFromHash());

  // Ein Abruf prüft den Schlüssel, bevor die Bereiche ihn benutzen; sonst
  // zählt ein Tippfehler in jedem Bereich als eigener Fehlversuch.
  async function check(candidate: string): Promise<void> {
    checking = true;
    error = '';
    try {
      await operatorPost('admin_mods', candidate);
      key = candidate;
      saveOperatorKey(candidate);
    } catch (cause) {
      error = (cause as Error).message;
      if (cause instanceof OperatorKeyError) forget();
    } finally {
      checking = false;
    }
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const candidate = input.trim();
    input = '';
    if (candidate) void check(candidate);
  }

  function forget(): void {
    key = '';
    saveOperatorKey('');
  }

  function select(id: TabId): void {
    tab = id;
    history.replaceState(null, '', `#${id}`);
  }

  onMount(() => {
    if (key) void check(key);
    const onHashChange = (): void => {
      tab = tabFromHash();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });
</script>

<header class="bar">
  <h1>Zentrale</h1>
  {#if key}
    <nav>
      {#each tabs as entry (entry.id)}
        <button class="tab" class:active={tab === entry.id} onclick={() => select(entry.id)}>{entry.label}</button>
      {/each}
    </nav>
    <a class="back" href="../">Zur Leitstelle</a>
    <button class="ghost" onclick={forget}>Schlüssel vergessen</button>
  {/if}
</header>

<main class="admin">
  {#if !key}
    <form class="key-form" onsubmit={submit}>
      <label>
        <span>Betreiber-Schlüssel</span>
        <input type="password" bind:value={input} autocomplete="off" spellcheck="false" />
      </label>
      <button type="submit" class="primary" disabled={!input.trim() || checking}>Anmelden</button>
      <p>Der Schlüssel steht in der Backend-Konfiguration als OPERATOR_KEY. Er wird nur für diesen Tab gemerkt.</p>
    </form>
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if key}
    {#if tab === 'mods'}
      <AdminMods {key} />
    {:else if tab === 'sessions'}
      <AdminSessions {key} />
    {:else if tab === 'metrics'}
      <AdminMetrics {key} />
    {:else}
      <AdminLog {key} />
    {/if}
  {/if}
</main>

{#if app.confirmDialog}
  <ConfirmDialog />
{/if}

<style>
  /* Die Leitstelle sperrt das Scrollen, die Zentrale ist eine normale Seite. */
  :global(body) {
    overflow: auto;
  }
  :global(#app) {
    height: auto;
    min-height: 100vh;
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  h1 {
    margin: 0;
    font-size: 16px;
  }
  nav {
    display: flex;
    gap: 4px;
    margin-right: auto;
  }
  .tab {
    padding: 6px 12px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--text-dim);
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.active {
    border-color: var(--border);
    background: var(--bg);
    color: var(--text);
  }
  .back {
    color: var(--text-dim);
    font-size: 13px;
  }
  .admin {
    max-width: 1100px;
    margin: 0 auto;
    padding: 20px 20px 48px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .key-form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
    max-width: 480px;
  }
  .key-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 220px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .key-form p {
    flex-basis: 100%;
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }
  .error {
    margin: 0;
    color: var(--danger-text);
    font-size: 13px;
  }
</style>
