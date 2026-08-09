<script lang="ts">
  import { Bed, Hospital, ShieldPlus, X } from 'lucide-svelte';
  import { api } from '../lib/api';
  import { focusTrap } from '../lib/focus';
  import { refreshState } from '../lib/polling';
  import { app, canWrite, showNotice } from '../lib/state.svelte';
  import type { Hospital as HospitalRow } from '../lib/types';

  const vehicleId = app.hospitalAssignmentVehicleId!;
  const vehicle = $derived(app.vehicles.find((item) => item.id === vehicleId));
  const current = $derived(app.hospitalReservations.find((item) => item.vehicle_id === vehicleId && item.status === 'reserved'));
  let busy = $state(false);
  let errorMsg = $state('');

  function distanceMeters(hospital: HospitalRow): number | null {
    if (!vehicle) return null;
    const distance = Math.hypot(Number(hospital.x) - Number(vehicle.x), Number(hospital.y) - Number(vehicle.y)) / 10;
    return Number.isFinite(distance) ? distance : null;
  }

  function distanceText(hospital: HospitalRow): string {
    const distance = distanceMeters(hospital);
    if (distance === null) return 'Entfernung unbekannt';
    if (distance < 1000) return `${Math.round(distance)} m`;
    return `${(distance / 1000).toFixed(1).replace('.', ',')} km`;
  }

  const nearestHospitalId = $derived.by(() => {
    let nearest: { id: number; distance: number } | null = null;
    for (const hospital of app.hospitals) {
      const distance = distanceMeters(hospital);
      if (distance !== null && (!nearest || distance < nearest.distance)) nearest = { id: hospital.id, distance };
    }
    return nearest?.id ?? null;
  });

  function close(): void {
    if (!busy) app.hospitalAssignmentVehicleId = null;
  }

  function reserved(hospitalId: number, bedType: 'ward' | 'icu'): number {
    return app.hospitalReservations.filter((item) => item.hospital_id === hospitalId && item.bed_type === bedType && item.vehicle_id !== vehicleId).length;
  }

  function free(hospital: HospitalRow, bedType: 'ward' | 'icu'): number {
    const reported = bedType === 'icu' ? Number(hospital.icu_available) : Number(hospital.ward_available);
    return Math.max(0, reported - reserved(hospital.id, bedType));
  }

  async function assign(hospital: HospitalRow, bedType: 'ward' | 'icu'): Promise<void> {
    if (busy || free(hospital, bedType) < 1) return;
    busy = true;
    errorMsg = '';
    try {
      await api('hospital_reservation_set', { vehicle_id: vehicleId, hospital_id: hospital.id, bed_type: bedType });
      await refreshState();
      showNotice(`${vehicle?.name || vehicle?.game_vehicle_id} für ${hospital.name || 'Klinik'} vorgemerkt`);
      app.hospitalAssignmentVehicleId = null;
    } catch (error) {
      errorMsg = (error as Error).message;
    } finally {
      busy = false;
    }
  }

  async function clear(): Promise<void> {
    if (busy) return;
    busy = true;
    errorMsg = '';
    try {
      await api('hospital_reservation_clear', { vehicle_id: vehicleId });
      await refreshState();
      showNotice('Klinikvormerkung aufgehoben');
      app.hospitalAssignmentVehicleId = null;
    } catch (error) {
      errorMsg = (error as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && close()} onkeydown={(event) => event.key === 'Escape' && close()} use:focusTrap={{ initial: '[data-autofocus]' }} tabindex="-1">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="hospital-assignment-title">
    <header>
      <Hospital size={16} />
      <div>
        <h3 id="hospital-assignment-title">{current ? 'Klinikzuweisung ändern' : 'Klinik zuweisen'}</h3>
        <span>{vehicle?.name || vehicle?.game_vehicle_id || 'Fahrzeug'}</span>
      </div>
      <button class="ghost" data-autofocus data-tooltip="Schließen" aria-label="Schließen" disabled={busy} onclick={close}><X size={16} /></button>
    </header>

    <div class="body">
      <p>
        {#if current}
          Aktuell: {current.hospital_name || 'Klinik'} · {current.bed_type === 'icu' ? 'Intensiv' : 'Normal'}. Eine andere Auswahl ersetzt diese Zuweisung.
        {:else}
          Die Auswahl reserviert rechnerisch einen Platz, bis EM4 die neue Bettenzahl nach der Ankunft bestätigt.
        {/if}
      </p>
      <div class="hospital-list">
        {#each app.hospitals as hospital (hospital.id)}
          <div class="hospital-row">
            <div class="hospital-name">
              <strong>{hospital.name || 'Krankenhaus'}</strong>
              <span class:nearest={hospital.id === nearestHospitalId}>{distanceText(hospital)}</span>
            </div>
            <button
              class:active={current?.hospital_id === hospital.id && current?.bed_type === 'ward'}
              disabled={busy || !canWrite() || free(hospital, 'ward') < 1}
              onclick={() => void assign(hospital, 'ward')}
            >
              <Bed size={14} /> Normal <span>{free(hospital, 'ward')} frei</span>
            </button>
            <button
              class:active={current?.hospital_id === hospital.id && current?.bed_type === 'icu'}
              disabled={busy || !canWrite() || free(hospital, 'icu') < 1}
              onclick={() => void assign(hospital, 'icu')}
            >
              <ShieldPlus size={14} /> Intensiv <span>{free(hospital, 'icu')} frei</span>
            </button>
          </div>
        {/each}
      </div>
      {#if errorMsg}<div class="error" role="alert">{errorMsg}</div>{/if}
    </div>

    <footer>
      {#if current}
        <button class="danger" disabled={busy || !canWrite()} onclick={() => void clear()}>Zuweisung aufheben</button>
      {/if}
      <span></span>
      <button disabled={busy} onclick={close}>Abbrechen</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 18px; background: rgba(4, 6, 10, 0.6); }
  .dialog { width: min(680px, 96vw); max-height: min(760px, 92vh); display: flex; flex-direction: column; overflow: hidden; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow); }
  header { display: flex; align-items: center; gap: 9px; padding: 11px 14px; border-bottom: 1px solid var(--border); background: var(--panel-header); color: var(--accent); }
  header div { flex: 1; min-width: 0; }
  h3 { margin: 0; color: var(--text); font-size: 14px; }
  header span { color: var(--text-dim); font-size: 11px; }
  .body { padding: 14px; overflow: auto; }
  p { margin: 0 0 12px; color: var(--text-dim); font-size: 12px; }
  .hospital-list { border: 1px solid var(--border); }
  .hospital-row { display: grid; grid-template-columns: minmax(140px, 1fr) 150px 150px; gap: 7px; align-items: center; padding: 8px; border-bottom: 1px solid var(--border); }
  .hospital-row:last-child { border-bottom: 0; }
  .hospital-name { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
  .hospital-name strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .hospital-name span { flex: 0 0 auto; color: var(--text-dim); font-size: 11px; font-weight: 400; }
  .hospital-name span.nearest { color: var(--good-text); font-weight: 700; }
  .hospital-row button { justify-content: flex-start; font-size: 12px; }
  .hospital-row button span { margin-left: auto; color: var(--text-dim); font-size: 10px; }
  .hospital-row button.active { border-color: var(--selection); background: var(--accent-soft); }
  .error { margin-top: 10px; padding: 8px 10px; border-left: 3px solid var(--danger); background: rgba(255, 82, 82, 0.08); color: var(--danger); font-size: 12px; }
  footer { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border); }
  footer span { flex: 1; }
  .danger { color: var(--danger); }
  @media (max-width: 620px) { .hospital-row { grid-template-columns: 1fr 1fr; } .hospital-name { grid-column: 1 / -1; } }
</style>
