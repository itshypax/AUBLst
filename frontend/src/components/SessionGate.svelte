<script lang="ts">
  import { CircleAlert, FlaskConical, KeyRound, LoaderCircle, RadioTower, ServerCog } from 'lucide-svelte';
  import { createDemoSession } from '../lib/demo-session';
  import { dismissibleDetails } from '../lib/dismissible-details';
  import { switchSession } from '../lib/polling';
  import { app } from '../lib/state.svelte';
  import { userFacingError } from '../lib/user-facing-error';

  let token = $state(app.sessionToken);
  let pin = $state(app.pin);
  let apiBase = $state(app.apiBase);
  let submitting = $state(false);
  let activeAction = $state<'connect' | 'demo' | null>(null);
  let localError = $state('');
  let tokenInput: HTMLInputElement;

  const issue = $derived(app.lastError ? userFacingError(app.lastError, 'state') : null);
  const connecting = $derived(Boolean(app.sessionToken && !app.lastError && !app.stateHealthy) || submitting || app.sessionChanging);

  $effect(() => {
    if (!tokenInput) return;
    const input = tokenInput;
    requestAnimationFrame(() => {
      if (input.isConnected) input.focus();
    });
  });

  async function connect(): Promise<void> {
    const nextToken = token.trim();
    if (!nextToken) {
      localError = 'Gib zuerst einen Sitzungscode ein.';
      tokenInput.focus();
      return;
    }
    localError = '';
    submitting = true;
    activeAction = 'connect';
    try {
      await switchSession(apiBase, nextToken, pin);
    } finally {
      submitting = false;
      activeAction = null;
    }
  }

  async function openDemo(): Promise<void> {
    localError = '';
    submitting = true;
    activeAction = 'demo';
    try {
      const demo = await createDemoSession(apiBase.trim() || app.apiBase);
      await switchSession(apiBase, demo.token, demo.pin);
    } catch (error) {
      localError = (error as Error).message;
    } finally {
      submitting = false;
      activeAction = null;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !connecting) void connect();
  }
</script>

<main class="session-start">
  <div class="session-dialog" role="dialog" aria-labelledby="session-title" aria-describedby="session-description">
    <div class="dialog-title" id="session-title">
      <RadioTower size={17} />
      Mit der Leitstelle verbinden
    </div>
    <div class="dialog-body">
      <p id="session-description">Gib den Sitzungscode ein, den EM4 für dieses Spiel anzeigt.</p>
      <label>
        <span>Sitzungscode</span>
        <input bind:this={tokenInput} class="token" type="text" bind:value={token} maxlength="10" spellcheck="false" autocomplete="off" onkeydown={onKeydown} />
      </label>
      <label>
        <span><KeyRound size={13} /> PIN, falls eingerichtet</span>
        <input type="password" bind:value={pin} autocomplete="off" onkeydown={onKeydown} />
      </label>
      <button class="connect" disabled={connecting} onclick={() => void connect()}>
        {#if activeAction === 'connect'}<span class="spinner"><LoaderCircle size={15} /></span> Verbindung wird geprüft{:else}Verbinden{/if}
      </button>
      <button class="demo" disabled={connecting} onclick={() => void openDemo()}>
        {#if activeAction === 'demo'}<span class="spinner"><LoaderCircle size={15} /></span> Demo wird angelegt{:else}<FlaskConical size={15} /> Demo-Sitzung anlegen{/if}
      </button>

      <details class="server-settings" use:dismissibleDetails>
        <summary><ServerCog size={14} /> Serveradresse</summary>
        <label>
          <span>Adresse der Leitstellen-API</span>
          <input type="text" bind:value={apiBase} spellcheck="false" autocomplete="url" />
        </label>
      </details>

      {#if localError}
        <div class="connection-alert" role="alert"><CircleAlert size={16} /><span>{localError}</span></div>
      {:else if issue}
        <div class="connection-alert" role="alert">
          <CircleAlert size={16} />
          <div><strong>{issue.title}</strong><span>{issue.message}</span></div>
        </div>
      {:else if connecting}
        <div class="connecting" aria-live="polite">Die Sitzung wird geladen. Das kann einen Moment dauern.</div>
      {/if}
    </div>
    <div class="dialog-help"><strong>Wo finde ich den Code?</strong> EM4 beziehungsweise der Adapter öffnet die Leitstelle normalerweise bereits mit der passenden Sitzung.</div>
  </div>
</main>

<style>
  .session-start { flex: 1 1 auto; min-height: 0; display: grid; place-items: center; padding: 32px; background: #111214; }
  .session-dialog { width: min(440px, calc(100vw - 32px)); border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--panel); box-shadow: var(--shadow); }
  .dialog-title { display: flex; align-items: center; gap: 10px; padding: 15px 17px; border-bottom: 1px solid var(--border); font-size: 16px; font-weight: 650; }
  .dialog-title :global(svg) { color: var(--danger); }
  .dialog-body { display: flex; flex-direction: column; gap: 13px; padding: 17px; }
  p { margin: 0 0 2px; color: var(--text-dim); }
  label { display: flex; flex-direction: column; gap: 5px; color: var(--text-dim); font-size: 12px; }
  label span { display: inline-flex; align-items: center; gap: 4px; }
  input { width: 100%; height: 36px; }
  input.token { letter-spacing: .14em; font: 650 16px ui-monospace, 'Cascadia Mono', Consolas, monospace; }
  .connect { height: 36px; justify-content: center; border-color: var(--accent); background: var(--accent); color: #fff; font-weight: 650; }
  .connect:hover:not(:disabled) { border-color: #71a5ff; background: #5c98ff; }
  .demo { height: 34px; justify-content: center; background: transparent; }
  .server-settings { border-top: 1px solid var(--border); padding-top: 10px; }
  .server-settings summary { display: inline-flex; align-items: center; gap: 6px; color: var(--text-dim); cursor: pointer; font-size: 12px; }
  .server-settings[open] summary { margin-bottom: 10px; color: var(--text); }
  .server-settings input { height: 32px; font: 12px ui-monospace, 'Cascadia Mono', Consolas, monospace; letter-spacing: 0; }
  .spinner { display: inline-flex; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .connecting { color: var(--text-dim); font-size: 12px; }
  .connection-alert { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; padding: 9px 10px; border-left: 3px solid var(--danger); background: rgba(232, 82, 74, .09); color: var(--danger-text); font-size: 12px; }
  .connection-alert :global(svg) { margin-top: 1px; }
  .connection-alert div { display: flex; flex-direction: column; gap: 2px; }
  .connection-alert strong { color: var(--text); }
  .dialog-help { padding: 11px 17px 14px; border-top: 1px solid var(--border); color: var(--text-dim); font-size: 12px; }
  .dialog-help strong { color: var(--text); font-weight: 600; }
  @media (max-width: 560px) { .session-start { padding: 16px; } }
</style>
