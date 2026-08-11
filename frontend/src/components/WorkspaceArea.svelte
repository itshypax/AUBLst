<script lang="ts">
  import type { AreaDirection, PanelId } from '../lib/workspaces';
  import EventsPanel from './EventsPanel.svelte';
  import HospitalsPanel from './HospitalsPanel.svelte';
  import LogPanel from './LogPanel.svelte';
  import MapPanel from './MapPanel.svelte';
  import VehiclesPanel from './VehiclesPanel.svelte';

  let { panels, direction }: { panels: PanelId[]; direction: AreaDirection } = $props();
</script>

<div
  class="workspace-area {direction}"
  style={direction === 'row'
    ? `grid-template-columns: repeat(${panels.length}, minmax(0, 1fr));`
    : `grid-template-rows: repeat(${panels.length}, minmax(0, 1fr));`}
>
  {#each panels as panel (panel)}
    {#if panel === 'map'}
      <MapPanel />
    {:else if panel === 'vehicles'}
      <VehiclesPanel />
    {:else if panel === 'events'}
      <EventsPanel />
    {:else if panel === 'logs'}
      <LogPanel />
    {:else if panel === 'hospitals'}
      <HospitalsPanel />
    {/if}
  {/each}
</div>

<style>
  .workspace-area {
    display: grid;
    gap: 8px;
    min-width: 0;
    min-height: 0;
  }

  .workspace-area.column {
    grid-template-columns: minmax(0, 1fr);
  }

  .workspace-area.row {
    grid-template-rows: minmax(0, 1fr);
  }
</style>
