<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { BellRing, ChevronDown, Clock3, MessageSquarePlus, MessageSquareText, Radio, RadioTower, Search, Trash2, Undo2 } from '../lib/fontawesome-icons';
  import { api } from '../lib/api';
  import { alarmVehicleCount, hasMapPosition, isActionUnit, isHiddenUnit, isHospitalTransportUnit, vehicleDisplayName, vehicleDisplayNameForIdentifier } from '../lib/classify';
  import { reservationAffectsCapacity } from '../lib/hospital-reservations';
  import { refreshState } from '../lib/polling';
  import { createRouteCalculator, formatDistance } from '../lib/routing';
  import { buildSpeechRequestEntries } from '../lib/speech-requests';
  import { app, canWrite, openVehicleMenu, setDispatchVehicleIds, showNotice, toggleDispatchVehicle } from '../lib/state.svelte';
  import { decodeEntities } from '../lib/text';
  import type { EventFeedback, HospitalReservation, StateResponse, Vehicle } from '../lib/types';
  import EmptyState from './EmptyState.svelte';
  import StatusBadge from './StatusBadge.svelte';

  let vehicleSearch = $state('');
  let showResults = $state(false);
  let vehicleCombobox = $state<HTMLDivElement>();
  let feedbackRows = $state<EventFeedback[]>([]);
  let feedbackText = $state('');
  let modes = $state<Record<number, string>>({});
  let busy = $state(false);
  let feedbackBusy = $state(false);
  let returning = $state<Set<number>>(new Set());
  let alarmTransitionVehicleIds = $state<Set<number>>(new Set());
  let alarmTransitionEventId = $state<number | null>(null);
  let errorMsg = $state('');

  const QUICK_UNITS = [
    { label: 'POL', gameVehicleId: 'FUSTW', name: 'Streifenwagen' },
    { label: 'BEST', gameVehicleId: 'BSW', name: 'Bestatter' },
    { label: 'ASF', gameVehicleId: 'ASF', name: 'Abschleppwagen' },
  ] as const;

  const currentEvent = $derived(app.assignEvent ? app.events.find((event) => event.id === app.assignEvent?.id) ?? app.assignEvent : null);
  const currentEventId = $derived(currentEvent?.id ?? null);
  const assignedIds = $derived(new Set(app.assignments.filter((item) => Number(item.event_id) === currentEventId).map((item) => Number(item.vehicle_id))));
  const assignedModes = $derived(new Map(app.assignments
    .filter((item) => Number(item.event_id) === currentEventId && item.alarm_modes?.length)
    .map((item) => [Number(item.vehicle_id), item.alarm_modes ?? []])));
  const assignedVehicles = $derived(app.vehicles.filter((vehicle) =>
    assignedIds.has(vehicle.id) && !(canStageAgain(vehicle) && app.dispatchVehicleIds.includes(vehicle.id))
  ));
  const fireLeader = $derived(app.assignments.find((item) => Number(item.event_id) === currentEventId && item.leader_role === 'fire'));
  const medicalLeader = $derived(app.assignments.find((item) => Number(item.event_id) === currentEventId && item.leader_role === 'medical'));
  const fireLeaderVehicle = $derived(app.vehicles.find((vehicle) => vehicle.id === Number(fireLeader?.vehicle_id)));
  const medicalLeaderVehicle = $derived(app.vehicles.find((vehicle) => vehicle.id === Number(medicalLeader?.vehicle_id)));
  const stagedVehicles = $derived(app.dispatchVehicleIds
    .map((id) => app.vehicles.find((vehicle) => vehicle.id === id))
    .filter((vehicle): vehicle is Vehicle => vehicle !== undefined)
    .filter((vehicle) => !assignedIds.has(vehicle.id) || canStageAgain(vehicle)));
  const availableVehicles = $derived(app.vehicles.filter((vehicle) => {
    const status = Number(vehicle.status);
    return !isActionUnit(vehicle) && (!assignedIds.has(vehicle.id) || isHiddenUnit(vehicle)) && !app.dispatchVehicleIds.includes(vehicle.id) && (isHiddenUnit(vehicle) || status === 1 || status === 2);
  }));
  const stagedVehicleCount = $derived(stagedVehicles.reduce((count, vehicle) => count + alarmVehicleCount(vehicle, modes[vehicle.id]), 0));
  const matchingVehicles = $derived.by(() => {
    const terms = vehicleSearch.trim().toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
    const rows = terms.length
      ? availableVehicles.filter((vehicle) => {
          const label = `${vehicle.name ?? ''} ${vehicle.type ?? ''} ${vehicle.game_vehicle_id}`.toLocaleLowerCase('de');
          return terms.every((term) => label.includes(term));
        })
      : availableVehicles;
    return rows;
  });
  const isAvailableInGame = $derived(!currentEvent || currentEvent.created_by !== 'frontend' || (currentEvent.game_event_id !== null && String(currentEvent.game_event_id).trim() !== ''));
  const routeToEvent = $derived(currentEvent ? createRouteCalculator(currentEvent, app.routing) : null);
  const speechRequests = $derived(buildSpeechRequestEntries(app.logs, app.vehicles, app.events, app.assignments).filter((entry) => entry.event?.id === currentEventId));
  const speechLogIds = $derived(new Set(speechRequests.flatMap((entry) => entry.rows.map((row) => row.id))));

  interface TimelineEntry {
    id: string;
    at: string;
    kind: 'feedback' | 'radio' | 'speech';
    source: string;
    text: string;
  }

  const timeline = $derived.by(() => {
    const rows: TimelineEntry[] = feedbackRows.map((row) => ({
      id: `feedback-${row.id}`,
      at: row.created_at,
      kind: 'feedback',
      source: 'Leitstelle',
      text: row.content,
    }));
    for (const entry of speechRequests) {
      rows.push({
        id: `speech-${entry.key}`,
        at: entry.requestedAt,
        kind: 'speech',
        source: entry.vehicle ? vehicleDisplayName(entry.vehicle) : entry.row.entity_id || 'Fahrzeug',
        text: decodeEntities(entry.row.long_message || entry.row.message),
      });
    }
    for (const row of app.logs) {
      if (Number(row.event_id) !== currentEventId || speechLogIds.has(row.id)) continue;
      rows.push({
        id: `radio-${row.id}`,
        at: row.created_at || row.updated_at,
        kind: 'radio',
        source: vehicleDisplayNameForIdentifier(row.entity_id, app.vehicles, 'Funk'),
        text: decodeEntities(row.long_message || row.message),
      });
    }
    return rows.sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id));
  });

  $effect(() => {
    function closeOnOutsidePointer(event: PointerEvent): void {
      if (!showResults || !(event.target instanceof Node) || vehicleCombobox?.contains(event.target)) return;
      showResults = false;
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  });

  $effect(() => {
    const id = currentEventId;
    feedbackRows = [];
    feedbackText = '';
    vehicleSearch = '';
    showResults = false;
    errorMsg = '';
    if (!id) return;
    void loadFeedback(id);
    const timer = window.setInterval(() => void loadFeedback(id), 5000);
    return () => window.clearInterval(timer);
  });

  $effect(() => {
    const eventId = currentEventId;
    const transitionEventId = alarmTransitionEventId;
    const transitionVehicleIds = alarmTransitionVehicleIds;
    const vehicles = app.vehicles;
    if (!transitionVehicleIds.size) return;

    if (eventId !== transitionEventId) {
      alarmTransitionVehicleIds = new Set();
      alarmTransitionEventId = null;
      return;
    }

    const remaining = new Set([...transitionVehicleIds].filter((vehicleId) => {
      const vehicle = vehicles.find((item) => item.id === vehicleId);
      return vehicle && hasLeftCurrentEvent(vehicle);
    }));
    if (remaining.size !== transitionVehicleIds.size) {
      alarmTransitionVehicleIds = remaining;
      if (!remaining.size) alarmTransitionEventId = null;
    }
  });

  function displayName(vehicle: Vehicle): string {
    return vehicleDisplayName(vehicle);
  }

  function modesAssignedTo(vehicleId: number): string[] {
    return assignedModes.get(vehicleId) ?? [];
  }

  function leaderRoleFor(vehicleId: number): 'fire' | 'medical' | null {
    return app.assignments.find((item) => Number(item.event_id) === currentEventId && Number(item.vehicle_id) === vehicleId)?.leader_role ?? null;
  }

  function hospitalReservationFor(vehicle: Vehicle): HospitalReservation | undefined {
    if (!isHospitalTransportUnit(vehicle)) return undefined;
    return app.hospitalReservations.find(
      (reservation) => reservation.vehicle_id === vehicle.id && reservationAffectsCapacity(reservation, app.vehicles),
    );
  }

  function hospitalDestination(reservation: HospitalReservation): string {
    return `${reservation.hospital_name || 'Klinik'}${reservation.bed_type === 'icu' ? ' · Intensiv' : ''}`;
  }

  function hasLeftCurrentEvent(vehicle: Vehicle): boolean {
    return [1, 2].includes(Number(vehicle.status));
  }

  function canStageAgain(vehicle: Vehicle): boolean {
    return isHiddenUnit(vehicle) || hasLeftCurrentEvent(vehicle);
  }

  function canRepeatFromAssignedRow(vehicle: Vehicle): boolean {
    return !alarmTransitionVehicleIds.has(vehicle.id) && !isHiddenUnit(vehicle) && hasLeftCurrentEvent(vehicle);
  }

  function bridgeAlarmTransition(eventId: number, vehicleIds: number[]): void {
    alarmTransitionEventId = eventId;
    alarmTransitionVehicleIds = new Set([...alarmTransitionVehicleIds, ...vehicleIds]);
  }

  function distanceText(vehicle: Vehicle): string {
    if (!routeToEvent || !hasMapPosition(vehicle)) return '';
    return formatDistance(routeToEvent(vehicle, vehicle), false);
  }

  function eventTime(): string {
    if (!currentEvent?.created_at) return '';
    return currentEvent.created_at.slice(11, 19);
  }

  function stageVehicle(vehicle: Vehicle): void {
    if (!app.dispatchVehicleIds.includes(vehicle.id)) toggleDispatchVehicle(vehicle.id);
    if (vehicle.modes && !modes[vehicle.id]) modes = { ...modes, [vehicle.id]: vehicle.modes.split(',')[0] };
    vehicleSearch = '';
    showResults = false;
  }

  function onComboboxFocusout(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && vehicleCombobox?.contains(next)) return;
    showResults = false;
  }

  function unstageVehicle(vehicleId: number): void {
    if (app.dispatchVehicleIds.includes(vehicleId)) toggleDispatchVehicle(vehicleId);
  }

  function quickVehicle(gameVehicleId: string): Vehicle | undefined {
    return app.vehicles.find((vehicle) => vehicle.game_vehicle_id.toUpperCase() === gameVehicleId);
  }

  function toggleQuickVehicle(vehicle: Vehicle | undefined): void {
    if (!vehicle) return;
    if (app.dispatchVehicleIds.includes(vehicle.id)) unstageVehicle(vehicle.id);
    else stageVehicle(vehicle);
  }

  async function loadFeedback(eventId: number): Promise<void> {
    try {
      const response = await api<{ feedback: EventFeedback[] }>('events_get_feedback', { event_id: eventId });
      if (currentEventId === eventId) feedbackRows = response.feedback ?? [];
    } catch {
      // Der nächste Abgleich versucht es erneut.
    }
  }

  async function alarm(): Promise<void> {
    if (!currentEvent || !stagedVehicles.length || busy) return;
    if (!isAvailableInGame) {
      errorMsg = 'Der Einsatz wird noch an das Spiel übertragen.';
      return;
    }
    busy = true;
    errorMsg = '';
    try {
      const latest = await api<StateResponse>('state');
      const currentById = new Map((latest.vehicles ?? []).map((vehicle) => [Number(vehicle.id), vehicle]));
      const unavailable = stagedVehicles.filter((vehicle) => {
        const current = currentById.get(vehicle.id);
        return !current || (!isHiddenUnit(current) && ![1, 2].includes(Number(current.status)));
      });
      if (unavailable.length) {
        const unavailableIds = new Set(unavailable.map((vehicle) => vehicle.id));
        setDispatchVehicleIds(app.dispatchVehicleIds.filter((id) => !unavailableIds.has(id)));
        errorMsg = `${unavailable.map(displayName).join(', ')} ${unavailable.length === 1 ? 'ist' : 'sind'} nicht mehr verfügbar.`;
        return;
      }

      const chosenModes = Object.fromEntries(stagedVehicles
        .map((vehicle) => [vehicle.id, modes[vehicle.id] || vehicle.modes?.split(',')[0]])
        .filter((entry): entry is [number, string] => Boolean(entry[1])));
      await api('events_assign', {
        event_id: currentEvent.id,
        vehicle_ids: stagedVehicles.map((vehicle) => vehicle.id),
        player_id: null,
        modes: chosenModes,
      });
      const count = stagedVehicleCount;
      bridgeAlarmTransition(currentEvent.id, stagedVehicles.map((vehicle) => vehicle.id));
      setDispatchVehicleIds([]);
      await refreshState();
      showNotice(`${count} ${count === 1 ? 'Fahrzeug alarmiert' : 'Fahrzeuge alarmiert'}`);
    } catch (error) {
      errorMsg = (error as Error).message;
    } finally {
      busy = false;
    }
  }

  async function sendHome(vehicle: Vehicle): Promise<void> {
    if (returning.has(vehicle.id)) return;
    returning = new Set(returning).add(vehicle.id);
    try {
      await api('events_unassign', { vehicle_ids: [vehicle.id] });
      await refreshState();
    } catch (error) {
      errorMsg = (error as Error).message;
    } finally {
      const next = new Set(returning);
      next.delete(vehicle.id);
      returning = next;
    }
  }

  async function addFeedback(): Promise<void> {
    const content = feedbackText.trim();
    if (!currentEvent || !content || feedbackBusy) return;
    feedbackBusy = true;
    try {
      const response = await api<{ feedback: EventFeedback }>('events_add_feedback', { event_id: currentEvent.id, content });
      feedbackRows = [...feedbackRows, response.feedback];
      feedbackText = '';
    } catch (error) {
      errorMsg = (error as Error).message;
    } finally {
      feedbackBusy = false;
    }
  }

</script>

<section class="panel current-event">
  <div class="panel-header">
    <h2>Aktueller Einsatz</h2>
    <span class="spacer"></span>
  </div>

  {#if currentEvent}
    <div class="event-summary">
      <span class="event-number">{currentEvent.id}</span>
      <div class="event-title">
        <strong>{currentEvent.name || 'Einsatz'}</strong>
        <div class="event-meta">
          <span>Position {currentEvent.x.toFixed(1)}, {currentEvent.y.toFixed(1)}</span>
          {#if eventTime()}<span class="event-time"><FaIcon icon={Clock3} size={12} />{eventTime()}</span>{/if}
        </div>
      </div>
      <button class="primary alarm" disabled={!stagedVehicles.length || busy || !canWrite() || !isAvailableInGame} onclick={() => void alarm()}>
        <FaIcon icon={BellRing} size={14} />
        {busy ? 'Alarmiert …' : `Alarmieren${stagedVehicles.length ? ` (${stagedVehicleCount})` : ''}`}
      </button>
    </div>

    <div class="incident-command" aria-label="Einsatzleitung">
      <span class="incident-leader"><i class="leader-dot fire" aria-hidden="true"></i><span class="leader-label">Einsatzleiter FW</span><span class="leader-name">{fireLeaderVehicle ? displayName(fireLeaderVehicle) : 'nicht bestimmt'}</span></span>
      <span class="incident-leader"><i class="leader-dot rescue" aria-hidden="true"></i><span class="leader-label">Einsatzleiter RD</span><span class="leader-name">{medicalLeaderVehicle ? displayName(medicalLeaderVehicle) : 'nicht bestimmt'}</span></span>
    </div>

    <div class="dispatch-toolbar">
      <div bind:this={vehicleCombobox} class="vehicle-combobox" onfocusout={onComboboxFocusout}>
        <label>
          <FaIcon icon={Search} size={14} />
          <span class="sr-only">Fahrzeug suchen und vormerken</span>
          <input
            type="text"
            bind:value={vehicleSearch}
            placeholder="Fahrzeug suchen …"
            autocomplete="off"
            onfocus={() => (showResults = true)}
            onkeydown={(event) => {
              if (event.key === 'Escape') showResults = false;
              if (event.key === 'Enter' && matchingVehicles[0]) stageVehicle(matchingVehicles[0]);
            }}
          />
          <FaIcon icon={ChevronDown} size={14} />
        </label>
        {#if showResults}
          <div class="vehicle-results" aria-label="Verfügbare Fahrzeuge">
            {#each matchingVehicles as vehicle (vehicle.id)}
              {@const distance = distanceText(vehicle)}
              <button aria-label={displayName(vehicle)} onclick={() => stageVehicle(vehicle)}>
                {#if !isHiddenUnit(vehicle)}<StatusBadge value={vehicle.status} />{/if}
                <span class="result-identity"><strong>{displayName(vehicle)}</strong><small>{vehicle.type && vehicle.type.toLocaleLowerCase('de') !== 'none' ? vehicle.type : vehicle.game_vehicle_id}</small></span>
                {#if distance}<small class="distance">{distance}</small>{/if}
              </button>
            {:else}
              <EmptyState compact search title="Kein verfügbares Fahrzeug" description="Suchbegriff ändern oder den aktuellen Status prüfen." />
            {/each}
          </div>
        {/if}
      </div>
      <div class="quick-units" aria-label="Schnellwahl">
        {#each QUICK_UNITS as quick (quick.gameVehicleId)}
          {@const vehicle = quickVehicle(quick.gameVehicleId)}
          {@const selected = Boolean(vehicle && app.dispatchVehicleIds.includes(vehicle.id))}
          <button
            class="quick-unit"
            class:selected
            aria-pressed={selected}
            aria-label={vehicle ? `${quick.name} ${selected ? 'aus Vormerkung entfernen' : 'vormerken'}` : `${quick.name} nicht verfügbar`}
            data-tooltip={vehicle ? `${quick.name} ${selected ? 'aus Vormerkung entfernen' : 'vormerken'}` : `${quick.name} nicht verfügbar`}
            disabled={!vehicle}
            onclick={() => toggleQuickVehicle(vehicle)}
          >{quick.label}</button>
        {/each}
      </div>
    </div>

    {#if !isAvailableInGame}
      <div class="dispatch-state">Der Einsatz wird noch an das Spiel übertragen. Fahrzeuge können bereits vorgemerkt werden.</div>
    {/if}

    <div class="dispatch-content">
      <div class="vehicle-pane">
        <div class="table-head"><span>S</span><span>Fahrzeug</span><span></span></div>
        <div class="vehicle-rows">
          {#each assignedVehicles as vehicle (vehicle.id)}
            {@const previouslyAssigned = canRepeatFromAssignedRow(vehicle)}
            {@const hospitalReservation = hospitalReservationFor(vehicle)}
            {@const destination = hospitalReservation ? hospitalDestination(hospitalReservation) : ''}
            <div
              class="vehicle-row assigned"
              class:previous={previouslyAssigned}
              role="group"
              aria-label={`${displayName(vehicle)}${destination ? `, Ziel ${destination}` : ''}`}
              oncontextmenu={(event) => {
                if (previouslyAssigned) return;
                event.preventDefault();
                if (currentEvent) openVehicleMenu(vehicle.id, event.clientX, event.clientY, currentEvent.id);
              }}
            >
              {#if previouslyAssigned || isHiddenUnit(vehicle)}<span aria-hidden="true"></span>{:else}<StatusBadge value={vehicle.status} />{/if}
              {#if previouslyAssigned}
                <button
                  class="ghost vehicle-name assigned-vehicle-name previous-vehicle"
                  data-tooltip="Erneut vormerken"
                  aria-label={`${displayName(vehicle)} erneut vormerken`}
                  onclick={() => stageVehicle(vehicle)}
                >
                  <span class="vehicle-title">{displayName(vehicle)}{#each modesAssignedTo(vehicle.id) as mode}<span class="assigned-mode">{` (${mode})`}</span>{/each}</span>
                  {#if hospitalReservation}<span class="destination" class:intensive={hospitalReservation.bed_type === 'icu'}>→ {destination}</span>{/if}
                </button>
              {:else}
                <span class="vehicle-name assigned-vehicle-name">
                  <span class="vehicle-title">{displayName(vehicle)}{#each modesAssignedTo(vehicle.id) as mode}<span class="assigned-mode">{` (${mode})`}</span>{/each}</span>
                  {#if hospitalReservation}<span class="destination" class:intensive={hospitalReservation.bed_type === 'icu'}>→ {destination}</span>{/if}
                </span>
              {/if}
              <div class="row-actions">
                {#if Number(vehicle.status) === 3}
                  <button class="ghost row-action" data-tooltip="Einrücken lassen" aria-label={`${displayName(vehicle)} einrücken lassen`} disabled={returning.has(vehicle.id) || !canWrite()} onclick={() => void sendHome(vehicle)}><FaIcon icon={Undo2} size={14} /></button>
                {/if}
                {#if leaderRoleFor(vehicle.id)}
                  <span class="leader-badge"><i class:fire={leaderRoleFor(vehicle.id) === 'fire'} class:rescue={leaderRoleFor(vehicle.id) === 'medical'} class="leader-dot" aria-hidden="true"></i>{leaderRoleFor(vehicle.id) === 'fire' ? 'EL-FW' : 'EL-RD'}</span>
                {/if}
              </div>
            </div>
          {/each}
          {#each stagedVehicles as vehicle (vehicle.id)}
            <div class="vehicle-row staged">
              {#if !isHiddenUnit(vehicle)}<StatusBadge value={vehicle.status} />{:else}<span aria-hidden="true"></span>{/if}
              <div class="vehicle-name with-mode">
                <span>{displayName(vehicle)}</span>
                {#if vehicle.modes}
                  <select value={modes[vehicle.id] || vehicle.modes.split(',')[0]} aria-label={`Ausrückmodus für ${displayName(vehicle)}`} onchange={(event) => (modes = { ...modes, [vehicle.id]: event.currentTarget.value })}>
                    {#each vehicle.modes.split(',') as mode (mode)}<option value={mode}>{mode}</option>{/each}
                  </select>
                {/if}
              </div>
              <button class="ghost row-action" data-tooltip="Vormerkung entfernen" aria-label={`${displayName(vehicle)} entfernen`} onclick={() => unstageVehicle(vehicle.id)}><FaIcon icon={Trash2} size={14} /></button>
            </div>
          {/each}
          {#if !assignedVehicles.length && !stagedVehicles.length}
            <EmptyState compact title="Noch keine Fahrzeuge zugeordnet" description="Oben suchen oder in der Fahrzeugübersicht vormerken." />
          {/if}
        </div>
      </div>

      <aside class="feedback-pane">
        <div class="feedback-head"><span>Rückmeldungen</span><span>{timeline.length}</span></div>
        <div class="timeline" aria-live="polite">
          {#each timeline as entry (entry.id)}
            {@const TimelineIcon = entry.kind === 'speech' ? RadioTower : entry.kind === 'radio' ? Radio : MessageSquareText}
            <div class="timeline-row {entry.kind}">
              <span class="timeline-icon"><FaIcon icon={TimelineIcon} size={12} aria-hidden="true" /></span>
              <div class="timeline-content">
                <div><strong>{entry.source}</strong><time>{entry.at.slice(11, 16)}</time></div>
                <span>{entry.text}</span>
              </div>
            </div>
          {:else}
            <EmptyState compact title="Noch keine Rückmeldungen" description="Funkmeldungen und Leitstellennotizen erscheinen hier." />
          {/each}
        </div>
        <div class="feedback-form">
          <textarea bind:value={feedbackText} rows="2" placeholder="Rückmeldung hinzufügen …" onkeydown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void addFeedback();
            }
          }}></textarea>
          <button data-tooltip="Rückmeldung hinzufügen" aria-label="Rückmeldung hinzufügen" disabled={!feedbackText.trim() || feedbackBusy || !canWrite()} onclick={() => void addFeedback()}><FaIcon icon={MessageSquarePlus} size={14} /></button>
        </div>
      </aside>
    </div>

    {#if errorMsg}<div class="error" role="alert">{errorMsg}</div>{/if}
  {:else}
    <EmptyState title="Kein Einsatz geöffnet" description="Einsatz in der Übersicht auswählen, um Fahrzeuge zu disponieren." />
  {/if}
</section>

<style>
  .current-event { position: relative; }
  .event-summary { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid var(--border); }
  .event-number { display: grid; place-items: center; min-width: 30px; height: 30px; border: 1px solid var(--border-strong); background: var(--bg-raised); font-variant-numeric: tabular-nums; font-weight: 700; }
  .event-title { display: flex; flex-direction: column; min-width: 0; }
  .event-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .event-meta { display: flex; align-items: center; gap: 9px; min-width: 0; color: var(--text-dim); font-size: 11px; }
  .event-meta > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .event-time { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; }
  .incident-command { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 5px 8px; border-bottom: 1px solid var(--border); font-size: 11px; }
  .incident-leader { display: inline-flex; min-width: 0; align-items: center; gap: 5px; }
  .leader-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; }
  .leader-dot.fire { background: var(--danger); }
  .leader-dot.rescue { background: var(--warn); }
  .leader-label { color: var(--text-dim); }
  .leader-name { color: var(--text); font-weight: 600; }
  .alarm { min-height: 30px; }
  .dispatch-toolbar { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-bottom: 1px solid var(--border); }
  .vehicle-combobox { position: relative; flex: 1; min-width: 150px; }
  .vehicle-combobox label { display: flex; align-items: center; gap: 6px; padding: 0 7px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-dim); background: var(--bg-raised); }
  .vehicle-combobox input { width: 100%; min-width: 0; padding-left: 0; padding-right: 0; border: 0; background: transparent; box-shadow: none; }
  .vehicle-results { position: absolute; z-index: 8; top: calc(100% + 3px); left: 0; right: 0; max-height: 240px; overflow: auto; padding: 3px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--panel-header); box-shadow: var(--shadow); }
  .vehicle-results button { width: 100%; justify-content: flex-start; border: 0; background: transparent; text-align: left; }
  .vehicle-results button:hover { background: var(--accent-soft); }
  .result-identity { display: flex; flex: 1; min-width: 0; flex-direction: column; }
  .result-identity strong, .result-identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result-identity small { color: var(--text-dim); font-size: 10px; }
  .vehicle-results .distance { margin-left: auto; color: var(--text-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .quick-units { display: flex; flex: 0 0 auto; gap: 4px; }
  .quick-unit { min-width: 42px; height: 29px; justify-content: center; padding: 3px 7px; border-color: var(--border); background: transparent; color: var(--text-dim); font-size: 10px; font-weight: 700; letter-spacing: .04em; }
  .quick-unit.selected { border-color: var(--status-3-border); background: rgba(240, 160, 60, .1); color: var(--warn-text); }
  .dispatch-state { padding: 6px 8px; border-bottom: 1px solid var(--border); color: var(--warn-text); background: rgba(240, 160, 60, .08); font-size: 11px; }
  .dispatch-content { display: grid; grid-template-columns: minmax(220px, 1.1fr) minmax(180px, .9fr); flex: 1 1 auto; min-height: 0; }
  .vehicle-pane, .feedback-pane { min-width: 0; min-height: 0; }
  .vehicle-pane { display: flex; flex-direction: column; }
  .table-head, .vehicle-row { display: grid; grid-template-columns: 26px minmax(0, 1fr) minmax(28px, auto); align-items: center; gap: 6px; }
  .table-head { padding: 5px 8px; border-bottom: 1px solid var(--border); color: var(--text-dim); font-size: 10px; font-weight: 600; }
  .vehicle-rows { min-height: 0; overflow: auto; }
  .vehicle-row { min-height: 34px; padding: 4px 8px; border-bottom: 1px solid var(--border); }
  .vehicle-row.staged { border-left: 2px solid var(--warn); background: rgba(240, 160, 60, .045); }
  .vehicle-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .assigned-vehicle-name { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15; }
  .vehicle-title, .destination { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .destination { color: var(--accent); font-size: 10px; font-weight: 400; }
  .destination.intensive { color: var(--danger-text); }
  .assigned-mode { color: var(--text-dim); font-weight: 400; }
  .vehicle-row.previous .vehicle-name { color: var(--text-dim); font-style: italic; font-weight: 500; }
  button.previous-vehicle { justify-content: flex-start; align-items: flex-start; padding: 0; border: 0; border-radius: 0; background: transparent; text-align: left; }
  button.previous-vehicle:hover:not(:disabled) { border: 0; background: transparent; color: var(--text); }
  .vehicle-name.with-mode { display: flex; align-items: center; gap: 5px; }
  .vehicle-name.with-mode > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vehicle-name select { min-width: 0; max-width: 100px; padding: 2px 4px; font-size: 10px; }
  .row-action { justify-self: end; }
  .row-actions { display: flex; justify-content: flex-end; align-items: center; gap: 3px; }
  .leader-badge { display: inline-flex; align-items: center; gap: 4px; min-height: 20px; padding: 2px 5px; border: 1px solid var(--border-strong); border-radius: 3px; background: var(--bg-raised); color: var(--text); font-size: 9px; font-weight: 600; line-height: 1; white-space: nowrap; }
  .leader-badge .leader-dot { width: 5px; height: 5px; }
  .feedback-pane { display: flex; flex-direction: column; border-left: 1px solid var(--border); background: rgba(255, 255, 255, .012); }
  .feedback-head { display: flex; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid var(--border); color: var(--text-dim); font-size: 10px; font-weight: 600; }
  .timeline { flex: 1 1 auto; min-height: 70px; overflow: auto; }
  .timeline-row { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 6px; padding: 7px 8px; border-bottom: 1px solid var(--border); border-left: 2px solid transparent; font-size: 11px; }
  .timeline-row.feedback { border-left-color: var(--warn); }
  .timeline-row.speech { border-left-color: var(--danger); background: rgba(232, 82, 74, .05); }
  .timeline-icon { display: inline-flex; align-items: flex-start; justify-content: center; padding-top: 2px; color: var(--text-dim); }
  .timeline-row.feedback .timeline-icon { color: var(--warn-text); }
  .timeline-row.speech .timeline-icon { color: var(--danger-text); }
  .timeline-content { min-width: 0; }
  .timeline-content > div { display: flex; align-items: baseline; gap: 6px; }
  .timeline-content strong { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .timeline-content time { color: var(--text-dim); font-size: 10px; font-variant-numeric: tabular-nums; }
  .timeline-content > span { display: block; margin-top: 2px; color: var(--text-dim); overflow-wrap: anywhere; }
  .feedback-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; padding: 6px; border-top: 1px solid var(--border); }
  .feedback-form textarea { min-height: 44px; max-height: 88px; resize: vertical; font-size: 11px; }
  .feedback-form button { align-self: stretch; padding: 5px 8px; }
  .error { padding: 6px 8px; border-top: 1px solid var(--border); color: var(--danger-text); font-size: 11px; }

  @media (max-width: 760px) {
    .dispatch-content { grid-template-columns: minmax(0, 1fr); overflow: auto; }
    .vehicle-pane { min-height: 150px; }
    .feedback-pane { min-height: 150px; border-top: 1px solid var(--border); border-left: 0; }
    .dispatch-toolbar { gap: 6px; }
  }
</style>
