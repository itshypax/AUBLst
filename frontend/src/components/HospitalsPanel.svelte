<script lang="ts">
  import { Hospital as HospitalIcon, Map as MapIcon } from 'lucide-svelte';
  import { app } from '../lib/state.svelte';

  interface HospitalLocation {
    direction: string;
    onMap: boolean;
  }

  function locationFor(name: string | null): HospitalLocation | null {
    const normalized = (name ?? '').toLocaleLowerCase('de').replace(/[^a-zäöüß]/g, '');
    if (normalized.includes('uniklinik') || normalized.includes('universitaetsklinik')) return { direction: 'Nordwest', onMap: true };
    if (normalized.includes('hanseklinik')) return { direction: 'Südost', onMap: true };
    if (normalized.includes('berg')) return { direction: 'West', onMap: false };
    if (normalized.includes('lichtenau')) return { direction: 'Ost', onMap: false };
    return null;
  }

  // 0 Betten frei = rot, 1 = orange, sonst grün
  function level(available: number): 'ok' | 'low' | 'full' {
    const n = Number(available);
    if (n === 0) return 'full';
    if (n < 2) return 'low';
    return 'ok';
  }

  function occupancy(available: number, total: number): number {
    const t = Number(total);
    if (!t) return 0;
    return Math.min(100, Math.max(0, ((t - Number(available)) / t) * 100));
  }


  function reservationCount(hospitalId: number, bedType: 'ward' | 'icu'): number {
    return app.hospitalReservations.filter((item) => item.hospital_id === hospitalId && item.bed_type === bedType).length;
  }
</script>

{#snippet bedCell(hospitalId: number, bedType: 'ward' | 'icu', label: string, available: number, total: number)}
  {@const reserved = reservationCount(hospitalId, bedType)}
  {@const effective = Math.max(0, Number(available) - reserved)}
  <span class="bed" data-tooltip="{label}: {available} gemeldet · {reserved} vorgemerkt · {effective} verfügbar">
    <span class="bed-label">{label}</span>
    <span class="bar">
      <span class="fill {level(available)}" style="width: {occupancy(available, total)}%"></span>
      {#if reserved > 0}
        <span class="reserved" style="left: {occupancy(available, total)}%; width: {Math.min(100 - occupancy(available, total), total ? reserved / total * 100 : 0)}%"></span>
      {/if}
    </span>
    <span class="value {level(effective)}">{effective}/{total}</span>
  </span>
{/snippet}

<section class="panel">
  <div class="panel-header">
    <span class="icon"><HospitalIcon size={14} /></span>
    <h2>Krankenhäuser</h2>
  </div>
  <div class="panel-body">
    {#each app.hospitals as h (h.id)}
      {@const location = locationFor(h.name)}
      <div class="hospital">
        <span class="name" data-tooltip={h.name}>
          <span class="hospital-name">{h.name || 'Krankenhaus'}</span>
          {#if location}
            <span class="direction">{location.direction}</span>
            {#if location.onMap}
              <span class="map-location" data-tooltip="Auf der Karte" aria-label="Auf der Karte"><MapIcon size={12} /></span>
            {/if}
          {/if}
        </span>
        {@render bedCell(h.id, 'ward', 'Betten', h.ward_available, h.ward_total)}
        {@render bedCell(h.id, 'icu', 'Intensiv', h.icu_available, h.icu_total)}
      </div>
    {/each}
    {#if !app.hospitals.length}
      <div class="empty-hint">Keine Krankenhäuser gemeldet</div>
    {/if}
  </div>
</section>

<style>
  .hospital {
    display: grid;
    grid-template-columns: minmax(72px, 1fr) auto;
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 10px;
    row-gap: 4px;
    padding: 7px 8px;
    border-bottom: 1px solid var(--border);
  }

  .hospital:last-child {
    border-bottom: none;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    grid-row: 1 / 3;
  }

  .hospital-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .direction {
    flex: 0 0 auto;
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 500;
  }

  .map-location {
    display: inline-flex;
    flex: 0 0 auto;
    color: var(--accent);
  }

  .bed {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: 0 0 auto;
  }

  .bed-label {
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .bar {
    width: 52px;
    height: 7px;
    border-radius: 4px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    overflow: hidden;
    display: inline-block;
    position: relative;
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    transition: width 0.4s ease;
  }

  .reserved {
    position: absolute;
    top: 0;
    bottom: 0;
    background: repeating-linear-gradient(135deg, rgba(210, 222, 235, 0.72) 0 2px, rgba(210, 222, 235, 0.14) 2px 4px);
    border-left: 1px solid rgba(210, 222, 235, 0.75);
  }

  .fill.ok {
    background: linear-gradient(90deg, var(--status-1-start), var(--status-1-end));
  }

  .fill.low {
    background: linear-gradient(90deg, var(--status-3-start), var(--status-3-end));
  }

  .fill.full {
    background: linear-gradient(90deg, var(--status-4-start), var(--status-4-end));
  }

  .value {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
    min-width: 32px;
    text-align: right;
  }

  .value.low {
    color: var(--warn);
  }

  .value.full {
    color: var(--danger);
    font-weight: 700;
  }
</style>
