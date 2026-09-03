<script lang="ts">
  import { onMount } from 'svelte';
  import { cloneRoutingConfig, type RoutingConfig } from '../lib/routing';
  import { app } from '../lib/state.svelte';
  import type { MapContentRect } from '../lib/types';
  import MapPanel from './MapPanel.svelte';

  let { modId }: { modId: string } = $props();
  let loading = $state(true);
  let error = $state('');

  onMount(() => {
    void load();
  });

  async function load(): Promise<void> {
    loading = true;
    error = '';
    if (!modId) {
      error = 'In der URL fehlt die mod_id, zum Beispiel mod_id=AUBMP.';
      loading = false;
      return;
    }
    try {
      const response = await fetch(`/__routing-editor?mod_id=${encodeURIComponent(modId)}`, { cache: 'no-store' });
      const data = await response.json() as { error?: string; map_image_url?: string; map_content_rect?: MapContentRect | null; routing?: RoutingConfig };
      if (!response.ok || !data.map_image_url || !data.routing) throw new Error(data.error || 'Kartendaten konnten nicht geladen werden');
      app.modId = modId;
      app.mapBounds = { min_x: 0, min_y: 0, max_x: 1, max_y: 1 };
      app.mapImageUrl = data.map_image_url;
      app.mapContentRect = data.map_content_rect ?? null;
      app.routing = cloneRoutingConfig(data.routing);
      app.vehicles = [];
      app.events = [];
    } catch (loadError) {
      error = (loadError as Error).message;
    } finally {
      loading = false;
    }
  }
</script>

<main class="routing-page">
  {#if loading}
    <div class="editor-state">Karte {modId || 'unbekannt'} wird geladen …</div>
  {:else if error}
    <div class="editor-state error" role="alert">
      <strong>Straßeneditor konnte nicht geladen werden</strong>
      <span>{error}</span>
      <button onclick={() => void load()}>Erneut versuchen</button>
    </div>
  {:else}
    <MapPanel standaloneModId={modId} />
  {/if}
</main>

<style>
  .routing-page { flex: 1 1 auto; min-height: 0; padding: 8px; background: var(--bg); }
  .routing-page :global(.map-panel) { height: 100%; }
  .editor-state { width: min(460px, calc(100% - 32px)); margin: 80px auto; padding: 16px; border: 1px solid var(--border-strong); background: var(--panel); color: var(--text-dim); }
  .editor-state.error { border-left: 3px solid var(--danger); }
  .editor-state strong, .editor-state span { display: block; }
  .editor-state strong { margin-bottom: 5px; color: var(--text); }
  .editor-state button { margin-top: 14px; }
</style>
