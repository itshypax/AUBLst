<script lang="ts">
  import { vehicleDisplayName, vehicleTypeLabel } from '../../lib/classify';
  import type { Vehicle } from '../../lib/types';
  import StatusBadge from '../StatusBadge.svelte';

  let {
    vehicle,
    checked,
    hideStatus,
    distance,
    disabled,
    mode,
    onToggle,
    onModeChange,
  }: {
    vehicle: Vehicle;
    checked: boolean;
    hideStatus: boolean;
    distance: string;
    disabled: boolean;
    mode: string;
    onToggle: () => void;
    onModeChange: (mode: string) => void;
  } = $props();

  const title = $derived(`${vehicleDisplayName(vehicle)}${vehicleTypeLabel(vehicle) ? ` · Typ ${vehicleTypeLabel(vehicle)}` : ''}`);
  const secondary = $derived(vehicleTypeLabel(vehicle));
</script>

<div class="veh" class:checked>
  <label>
    <input type="checkbox" {checked} {disabled} onchange={onToggle} />
    {#if !hideStatus}<StatusBadge value={vehicle.status} />{/if}
    <span class="identity" data-tooltip={title}>
      <span class="name">{vehicleDisplayName(vehicle)}</span>
      {#if secondary}<span class="secondary">{secondary}</span>{/if}
    </span>
    {#if distance}<span class="distance">{distance}</span>{/if}
  </label>
  {#if vehicle.modes}
    <select value={mode} data-tooltip="Ausrückmodus" aria-label={`Ausrückmodus für ${vehicleDisplayName(vehicle)}`} {disabled} onchange={(event) => onModeChange(event.currentTarget.value)}>
      {#each vehicle.modes.split(',') as option (option)}<option value={option}>{option}</option>{/each}
    </select>
  {/if}
</div>

<style>
  .veh { display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 5px 6px; border: 1px solid transparent; border-radius: var(--radius-sm); }
  .veh:hover, .veh.checked { border-color: var(--selection); background: var(--accent-soft); }
  label { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; cursor: pointer; }
  input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); }
  .identity { display: flex; flex: 1; min-width: 0; flex-direction: column; line-height: 1.2; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .secondary { overflow: hidden; color: var(--text-dim); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .distance { margin-left: auto; flex: 0 0 auto; color: var(--text-dim); font-size: 11px; font-variant-numeric: tabular-nums; }
  select { width: 100%; padding: 2px 6px; font-size: 12px; }
</style>
