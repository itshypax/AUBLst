<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { Map as MapIcon } from '../lib/fontawesome-icons';
  import { reservationAffectsCapacity } from '../lib/hospital-reservations';
  import { compareHospitalNames, hospitalCapacityLevel } from '../lib/hospital-capacity';
  import { app } from '../lib/state.svelte';

  interface HospitalLocation {
    direction: string;
    onMap: boolean;
  }

  const sortedHospitals = $derived([...app.hospitals].sort((left, right) => compareHospitalNames(left.name, right.name)));

  function locationFor(name: string | null): HospitalLocation | null {
    const normalized = (name ?? '').toLocaleLowerCase('de').replace(/[^a-zäöüß]/g, '');
    if (normalized.includes('uniklinik') || normalized.includes('universitaetsklinik'))
      return { direction: 'Nordwest', onMap: true };
    if (normalized.includes('hanseklinik')) return { direction: 'Südost', onMap: true };
    if (normalized.includes('berg')) return { direction: 'West', onMap: false };
    if (normalized.includes('lichtenau')) return { direction: 'Ost', onMap: false };
    return null;
  }

  function capacityShare(value: number, total: number): number {
    const t = Number(total);
    if (!t) return 0;
    return Math.min(100, Math.max(0, (Number(value) / t) * 100));
  }

  function reservationCount(hospitalId: number, bedType: 'ward' | 'icu'): number {
    return app.hospitalReservations.filter(
      (item) =>
        item.hospital_id === hospitalId && item.bed_type === bedType && reservationAffectsCapacity(item, app.vehicles),
    ).length;
  }

  function capacityTooltip(label: string, effective: number, total: number, reserved: number): string {
    return `${label}: ${effective}/${total} frei${reserved > 0 ? ` · ${reserved} vorgemerkt` : ''}`;
  }
</script>

{#snippet bedCell(hospitalId: number, bedType: 'ward' | 'icu', label: string, available: number, total: number)}
  {@const reserved = reservationCount(hospitalId, bedType)}
  {@const effective = Math.max(0, Number(available) - reserved)}
  <div
    class="bed {hospitalCapacityLevel(effective)}"
    data-tooltip={capacityTooltip(label, effective, total, reserved)}
  >
    <span class="bed-label">{label}</span>
    <span class="capacity" aria-label={`${label}: ${effective} frei von ${total}, ${reserved} vorgemerkt`}>
      <span class="available {hospitalCapacityLevel(effective)}" style="width: {capacityShare(effective, total)}%"></span>
      {#if reserved > 0}
        <span class="reserved" style="width: {capacityShare(reserved, total)}%"></span>
      {/if}
    </span>
    <span class="value {hospitalCapacityLevel(effective)}"><strong>{effective}</strong> frei <small>von {total}</small></span>
  </div>
{/snippet}

<section class="panel">
  <div class="panel-header">
    <h2>Krankenhäuser</h2>
  </div>
  <div class="panel-body">
    {#each sortedHospitals as h (h.id)}
      {@const location = locationFor(h.name)}
      <div class="hospital">
        <div class="name" data-tooltip={h.name}>
          <span class="hospital-name">{h.name || 'Krankenhaus'}</span>
          {#if location}
            <span class="hospital-meta">
              <span class="meta-tag direction">{location.direction}</span>
              {#if location.onMap}
                <span class="meta-tag map-location" data-tooltip="Auf der Karte" aria-label="Auf der Karte"
                  ><FaIcon icon={MapIcon} size={11} /></span
                >
              {/if}
            </span>
          {/if}
        </div>
        {@render bedCell(h.id, 'ward', 'Normal', h.ward_available, h.ward_total)}
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
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    font-weight: 600;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    grid-row: 1 / 3;
  }

  .hospital-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .hospital-meta {
    display: flex;
    gap: 4px;
    min-width: 0;
  }

  .meta-tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-height: 17px;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-raised);
    color: var(--text-dim);
    font-size: 9px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
  }

  .map-location {
    width: 17px;
    justify-content: center;
    padding-inline: 2px;
    color: var(--accent-outline);
  }

  .bed {
    display: grid;
    grid-template-columns: 43px minmax(38px, 64px) minmax(72px, auto);
    align-items: center;
    gap: 3px 5px;
    min-width: 0;
  }

  .bed-label {
    font-size: 10px;
    color: var(--text-dim);
  }

  .capacity {
    height: 8px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 2px;
    overflow: hidden;
    display: flex;
  }

  .bed.full .capacity {
    border-color: rgba(232, 82, 74, 0.65);
  }

  .available {
    display: inline-block;
    height: 100%;
    transition: width 0.4s ease;
  }

  .reserved {
    display: inline-block;
    height: 100%;
    flex: 0 0 auto;
    background: repeating-linear-gradient(135deg, rgba(210, 222, 235, 0.72) 0 2px, rgba(210, 222, 235, 0.14) 2px 4px);
    border-left: 1px solid rgba(210, 222, 235, 0.75);
  }

  .available.ok {
    background: var(--good);
  }

  .available.low {
    background: var(--hospital-capacity-low);
  }

  .available.full {
    background: var(--danger);
  }

  .value {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
    white-space: nowrap;
  }

  .value strong {
    color: var(--good-text);
  }

  .value small {
    color: var(--text-dim);
    font-size: 9px;
    font-weight: 400;
  }

  .value.low strong {
    color: var(--hospital-capacity-low-text);
  }

  .value.full strong {
    color: var(--danger-text);
  }

  @media (max-width: 520px) {
    .hospital {
      grid-template-columns: minmax(64px, 0.8fr) minmax(150px, 1.2fr);
      column-gap: 6px;
    }

    .bed {
      grid-template-columns: 39px minmax(30px, 1fr) auto;
    }
  }
</style>
