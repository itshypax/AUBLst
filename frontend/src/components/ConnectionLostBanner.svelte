<script lang="ts">
  import { RefreshCw, TriangleAlert } from 'lucide-svelte';
  import { refreshState } from '../lib/polling';
  import { app } from '../lib/state.svelte';

  let now = $state(Date.now());
  let refreshing = $state(false);

  $effect(() => {
    const timer = window.setInterval(() => (now = Date.now()), 1000);
    return () => window.clearInterval(timer);
  });

  const age = $derived(app.lastSuccessfulSync ? Math.max(0, Math.floor((now - app.lastSuccessfulSync) / 1000)) : 0);

  async function retry(): Promise<void> {
    refreshing = true;
    await refreshState();
    refreshing = false;
  }
</script>

<div class="connection-lost" role="alert">
  <TriangleAlert size={15} />
  <span>Verbindung unterbrochen · letzter Stand vor {age} {age === 1 ? 'Sekunde' : 'Sekunden'}</span>
  <button disabled={refreshing} onclick={() => void retry()}>
    <span class:spinning={refreshing}><RefreshCw size={14} /></span>
    Erneut versuchen
  </button>
</div>

<style>
  .connection-lost { min-height: 34px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 4px 12px; border-bottom: 1px solid #7d4d16; background: #34220f; color: #ffd59e; font-size: 12px; }
  button { min-height: 25px; padding: 3px 8px; border-color: #7d4d16; background: #291b0d; font-size: 11px; }
  .spinning { display: inline-flex; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 560px) { .connection-lost span { flex: 1; } .connection-lost button { font-size: 0; } }
</style>
