<script lang="ts">
  import { onMount } from 'svelte';
  import AlarmMonitorMap from './AlarmMonitorMap.svelte';
  import FaIcon from './FaIcon.svelte';
  import {
    Axe,
    Biohazard,
    Cross,
    Flame,
    LoaderCircle,
    RadioTower,
    TriangleAlert,
    Waves,
    Wifi,
    WifiOff,
  } from '../lib/fontawesome-icons';
  import {
    MONITOR_STATIONS,
    assignmentModes,
    isMonitorStation,
    monitorEvents,
    monitorVehicles,
    vehiclesAssignedToEvent,
    type MonitorStation,
  } from '../lib/alarm-monitor';
  import { eventCategory, type EventCategory, vehicleDisplayName, vehicleTypeLabel } from '../lib/classify';
  import { switchSession } from '../lib/polling';
  import { app } from '../lib/state.svelte';
  import { statusDisplay, statusLabel } from '../lib/status';
  import { userFacingError } from '../lib/user-facing-error';

  const params = new URLSearchParams(location.search);
  const appCommit = import.meta.env.VITE_APP_COMMIT || 'dev';
  const storedStation = params.get('wache') ?? localStorage.getItem('alarmMonitorStation');
  const initialStation = isMonitorStation(storedStation) ? storedStation : null;

  let selectedStation = $state<MonitorStation | null>(initialStation);
  let draftStation = $state<MonitorStation>(initialStation ?? '1');
  let roomCode = $state(app.sessionToken);
  let apiBase = $state(app.apiBase);
  let setupOpen = $state(!initialStation);
  let connecting = $state(false);
  let localError = $state('');
  let now = $state(new Date());
  let focusEventId = $state<number | null>(null);
  let focusTimer: number | null = null;
  let knownEventIds = new Set<number>();
  let knownStation: MonitorStation | null = null;
  let eventTrackingInitialized = false;

  const stationVehicles = $derived(selectedStation ? monitorVehicles(app.vehicles, selectedStation) : []);
  const vehicleGridColumns = $derived.by(() => {
    const count = stationVehicles.length;
    if (count <= 1) return 1;
    if (count <= 4) return count;
    if (count <= 12) return 4;
    return 6;
  });
  const vehicleGridRows = $derived(Math.max(1, Math.ceil(stationVehicles.length / vehicleGridColumns)));
  const vehicleBoardHeight = $derived(Math.max(160, 40 + vehicleGridRows * 59));
  const stationEvents = $derived(
    selectedStation ? monitorEvents(app.events, app.assignments, app.vehicles, selectedStation) : [],
  );
  const primaryEvent = $derived(stationEvents[0] ?? null);
  const displayEvent = $derived(stationEvents.find((event) => event.id === focusEventId) ?? primaryEvent);
  const displayVehicles = $derived(
    displayEvent && selectedStation
      ? vehiclesAssignedToEvent(app.vehicles, app.assignments, displayEvent.id, selectedStation)
      : [],
  );
  const category = $derived<EventCategory>(displayEvent ? eventCategory(displayEvent.name) : 'other');
  const showIncidentWall = $derived(stationEvents.length > 1 && focusEventId === null);
  const mapIncidents = $derived.by(() => {
    const station = selectedStation;
    if (!station) return [];
    return stationEvents.map((event) => {
      return {
        event,
        vehicles: vehiclesAssignedToEvent(app.vehicles, app.assignments, event.id, station),
      };
    });
  });

  const categoryLabels: Record<EventCategory, string> = {
    fire: 'Brandeinsatz',
    hazard: 'Gefahrguteinsatz',
    water: 'Wassereinsatz',
    thl: 'Technische Hilfeleistung',
    medical: 'Rettungsdiensteinsatz',
    other: 'Einsatzalarm',
  };
  const categoryIcons = {
    fire: Flame,
    hazard: Biohazard,
    water: Waves,
    thl: Axe,
    medical: Cross,
    other: TriangleAlert,
  };
  const timeText = $derived(now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const dateText = $derived(
    now.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
  );
  const gameTime = $derived(
    app.clock
      ? `${String(app.clock.time_hours).padStart(2, '0')}:${String(app.clock.time_minutes).padStart(2, '0')}`
      : null,
  );

  $effect(() => {
    const station = selectedStation;
    const events = stationEvents;
    if (station !== knownStation) {
      knownStation = station;
      knownEventIds = new Set();
      eventTrackingInitialized = false;
      focusEventId = null;
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      focusTimer = null;
    }

    const newEvent = events.find((event) => !knownEventIds.has(event.id));
    const firstPass = !eventTrackingInitialized;
    eventTrackingInitialized = true;
    knownEventIds = new Set(events.map((event) => event.id));

    if (newEvent && (!firstPass || events.length > 1)) beginEventFocus(newEvent.id);
    else if (focusEventId !== null && !knownEventIds.has(focusEventId)) endEventFocus();
  });

  onMount(() => {
    const previousTitle = document.title;
    document.title = 'Alarmmonitor · EMDispatch';
    const timer = window.setInterval(() => (now = new Date()), 1000);
    return () => {
      clearInterval(timer);
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      document.title = previousTitle;
    };
  });

  function beginEventFocus(eventId: number): void {
    if (focusTimer !== null) window.clearTimeout(focusTimer);
    focusEventId = eventId;
    focusTimer = window.setTimeout(endEventFocus, 15_000);
  }

  function endEventFocus(): void {
    if (focusTimer !== null) window.clearTimeout(focusTimer);
    focusTimer = null;
    focusEventId = null;
  }

  function persistSelection(station: MonitorStation): void {
    selectedStation = station;
    localStorage.setItem('alarmMonitorStation', station);
    const next = new URLSearchParams(location.search);
    next.set('view', 'monitor');
    next.set('wache', station);
    next.delete('monitor');
    history.replaceState(null, '', `${location.pathname}?${next.toString()}${location.hash}`);
  }

  async function connect(): Promise<void> {
    const token = roomCode.trim();
    if (!token) {
      localError = 'Gib zuerst den Raumcode ein.';
      return;
    }
    localError = '';
    connecting = true;
    try {
      await switchSession(apiBase, token, '', { readOnly: true });
      if (!app.stateHealthy) {
        const issue = app.lastError ? userFacingError(app.lastError, 'state') : null;
        localError = issue?.message ?? 'Die Verbindung konnte nicht hergestellt werden.';
        return;
      }
      persistSelection(draftStation);
      setupOpen = false;
    } catch (error) {
      localError = (error as Error).message;
    } finally {
      connecting = false;
    }
  }

  function openSetup(): void {
    roomCode = app.sessionToken;
    apiBase = app.apiBase;
    draftStation = selectedStation ?? '1';
    localError = '';
    setupOpen = true;
  }

  function controlRoomUrl(): string {
    const next = new URLSearchParams(location.search);
    next.delete('view');
    next.delete('monitor');
    next.delete('wache');
    next.delete('session_token');
    next.delete('pin');
    const query = next.toString();
    return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  }

  async function toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  function formatAlarmTime(value?: string): string {
    if (!value) return 'Zeit unbekannt';
    const date = new Date(value.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function eventReference(event: { id: number; game_event_id?: string | null }): string {
    return event.game_event_id ? `#${event.game_event_id}` : `#${event.id}`;
  }
</script>

{#if setupOpen}
  <main class="monitor-entry">
    <section class="entry-dialog" aria-labelledby="monitor-entry-title">
      <div class="entry-heading">
        <img class="entry-logo" src="./aublst.png" alt="AUBLST" />
        <div>
          <h1 id="monitor-entry-title">Alarmmonitor öffnen</h1>
          <p>Raumcode eingeben und die eigene Wache auswählen.</p>
        </div>
      </div>

      <label class="room-field">
        <span>Raumcode</span>
        <input
          type="text"
          bind:value={roomCode}
          maxlength="10"
          spellcheck="false"
          autocomplete="off"
          onkeydown={(event) => event.key === 'Enter' && !connecting && void connect()}
        />
      </label>

      <fieldset>
        <legend>Wache</legend>
        <div class="station-options">
          {#each MONITOR_STATIONS as station}
            <button
              class:active={draftStation === station}
              aria-label={`Wache ${station}`}
              aria-pressed={draftStation === station}
              onclick={() => (draftStation = station)}
            >
              <span>{station}</span>
              Wache {station}
            </button>
          {/each}
        </div>
      </fieldset>

      <button class="entry-connect" disabled={connecting} onclick={() => void connect()}>
        {#if connecting}<span class="spinner"><FaIcon icon={LoaderCircle} size={16} /></span> Verbindung wird geprüft{:else}Alarmmonitor
          anzeigen{/if}
      </button>

      {#if localError}<div class="entry-error" role="alert">{localError}</div>{/if}

      <details>
        <summary>Serveradresse</summary>
        <label>
          <span>Adresse der Leitstellen-API</span>
          <input type="text" bind:value={apiBase} spellcheck="false" autocomplete="url" />
        </label>
      </details>

      <a class="control-room-link" href={controlRoomUrl()}>Zur Leitstellenansicht</a>
    </section>
  </main>
{:else if !app.stateHealthy || !selectedStation}
  <main class="monitor-loading">
    <span class="spinner"><FaIcon icon={LoaderCircle} size={22} /></span>
    <strong>{app.sessionChanging ? 'Raum wird verbunden' : 'Verbindung zum Raum unterbrochen'}</strong>
    <span>{app.lastError ? userFacingError(app.lastError, 'state').message : 'Live-Daten werden geladen.'}</span>
    <button onclick={openSetup}>Raumcode und Wache ändern</button>
  </main>
{:else}
  <main class="monitor-screen">
    <header class="monitor-header">
      <div class="monitor-brand">
        <img src="./aublst.png" alt="" />
        <div><strong>Alarmmonitor</strong><span>AUBLst | {appCommit}</span></div>
      </div>

      <button class="station-switch" onclick={openSetup} aria-label="Raumcode oder Wache ändern">
        <span>Wache {selectedStation}</span>
        <span>Raum {app.sessionToken.toUpperCase()}</span>
      </button>

      <div class="monitor-clock">
        <strong>{timeText}</strong>
        <span>{dateText}{gameTime ? ` · Spielzeit ${gameTime}` : ''}</span>
      </div>

      <div class="header-actions">
        <button onclick={() => void toggleFullscreen()}>Vollbild</button>
        <a href={controlRoomUrl()}>Leitstelle</a>
      </div>
    </header>

    <div
      class="monitor-body"
      class:alarm-focus={focusEventId !== null}
      style={`--vehicle-board-height:${vehicleBoardHeight}px`}
    >
      <section class="incident-panel {category}" class:wall-mode={showIncidentWall} aria-live="polite">
        {#if showIncidentWall}
          <div
            class="incident-wall"
            class:two={stationEvents.length === 2}
            class:three={stationEvents.length === 3}
            class:four={stationEvents.length === 4}
            class:many={stationEvents.length >= 5}
            class:dense={stationEvents.length >= 7}
          >
            {#each stationEvents as event, index (event.id)}
              {@const wallCategory = eventCategory(event.name)}
              {@const eventVehicles = vehiclesAssignedToEvent(app.vehicles, app.assignments, event.id, selectedStation)}
              <article class="wall-event {wallCategory}" class:latest={index === 0}>
                <header>
                  <FaIcon icon={categoryIcons[wallCategory]} size={17} />
                  <span>{categoryLabels[wallCategory]}</span>
                  <time>{event.created_at ? formatAlarmTime(event.created_at).split(', ').at(-1) : '--:--'}</time>
                </header>
                <div class="wall-copy">
                  <span>Einsatz {event.game_event_id || `#${event.id}`}</span>
                  <h1>{event.name || 'Einsatz ohne Stichwort'}</h1>
                  <p>Position {Number(event.x).toFixed(0)} / {Number(event.y).toFixed(0)}</p>
                </div>
                <div class="wall-units">
                  {#each eventVehicles as vehicle (vehicle.id)}
                    <span
                      ><b class="status-{vehicle.status}">{statusDisplay(vehicle.status)}</b>{vehicleDisplayName(
                        vehicle,
                      )}</span
                    >
                  {:else}
                    <span class="wall-empty">Keine Wachfahrzeuge zugeordnet</span>
                  {/each}
                </div>
              </article>
            {/each}
          </div>
        {:else if displayEvent}
          <div class="incident-type">
            <FaIcon icon={categoryIcons[category]} size={22} />
            <span>{categoryLabels[category]}</span>
            {#if focusEventId !== null}<strong class="focus-note">Neue Alarmierung</strong>{/if}
            <time>{formatAlarmTime(displayEvent.created_at)}</time>
          </div>
          <div class="incident-copy">
            <div class="incident-details">
              <span class="incident-number">Einsatz {displayEvent.game_event_id || `#${displayEvent.id}`}</span>
              <h1>{displayEvent.name || 'Einsatz ohne Stichwort'}</h1>
              <div class="incident-position">
                Position {Number(displayEvent.x).toFixed(0)} / {Number(displayEvent.y).toFixed(0)}
              </div>
            </div>
          </div>

          <div class="dispatch-list">
            <h2>Alarmierte Fahrzeuge · Wache {selectedStation}</h2>
            <div class="dispatch-grid">
              {#each displayVehicles as vehicle (vehicle.id)}
                {@const modes = assignmentModes(app.assignments, displayEvent.id, vehicle.id)}
                <div class="dispatch-unit">
                  <span class="unit-status status-{vehicle.status}">{statusDisplay(vehicle.status)}</span>
                  <span class="unit-name">{vehicleDisplayName(vehicle)}</span>
                  {#if modes.length}<span class="unit-mode">{modes.join(' · ')}</span>{/if}
                </div>
              {:else}
                <div class="dispatch-empty">Keine Wachfahrzeuge mehr zugeordnet</div>
              {/each}
            </div>
          </div>
        {:else}
          <div class="standby">
            <span class="standby-label">Wache {selectedStation}</span>
            <strong>{timeText.slice(0, 5)}</strong>
            <span>Keine laufende Alarmierung</span>
          </div>
        {/if}
      </section>

      <section class="map-panel">
        {#if primaryEvent}
          <AlarmMonitorMap incidents={mapIncidents} {focusEventId} />
        {:else}
          <div class="map-standby"><FaIcon icon={RadioTower} size={38} /><span>Bereit für Alarmierung</span></div>
        {/if}
      </section>

      <section class="vehicle-board">
        <div class="section-title">
          <h2>Fahrzeuge der Wache {selectedStation}</h2>
          <span>{stationVehicles.length}</span>
        </div>
        <div class="vehicle-list" style={`--vehicle-columns:${vehicleGridColumns}`}>
          {#each stationVehicles as vehicle (vehicle.id)}
            {@const typeLabel = vehicleTypeLabel(vehicle)}
            <div class="vehicle-row" title={`${vehicleDisplayName(vehicle)} · ${statusLabel(vehicle.status)}`}>
              <span class="status-block status-{vehicle.status}">{statusDisplay(vehicle.status)}</span>
              <span class="vehicle-main">
                <strong class="vehicle-name">{vehicleDisplayName(vehicle)}</strong>
                <span class="status-text">{statusLabel(vehicle.status)}</span>
              </span>
              {#if typeLabel}<span class="vehicle-type">{typeLabel}</span>{/if}
            </div>
          {:else}
            <div class="board-empty">Für Wache {selectedStation} wurden noch keine Fahrzeuge gemeldet.</div>
          {/each}
        </div>
      </section>

      <section class="alarm-queue">
        <div class="section-title">
          <h2>Alarmierungen</h2>
          <span>{stationEvents.length}</span>
        </div>
        <div class="queue-list">
          {#each stationEvents as event, index (event.id)}
            {@const eventVehicles = vehiclesAssignedToEvent(app.vehicles, app.assignments, event.id, selectedStation)}
            <div class="queue-row" class:current={index === 0}>
              <b class="queue-label">{eventReference(event)}</b>
              <time>{event.created_at ? formatAlarmTime(event.created_at).split(', ').at(-1) : '--:--'}</time>
              <span>{event.name || 'Einsatz'}</span>
              <strong>{eventVehicles.length}</strong>
            </div>
          {:else}
            <div class="board-empty">Keine laufenden Alarmierungen für diese Wache.</div>
          {/each}
        </div>
      </section>
    </div>

    <footer class="monitor-footer">
      <span class:offline={!app.stateHealthy}
        >{#if app.stateHealthy}<FaIcon icon={Wifi} size={13} /> Live verbunden{:else}<FaIcon icon={WifiOff} size={13} /> Verbindung
          unterbrochen{/if}</span
      >
      <span
        >Datenstand {app.lastSuccessfulSync
          ? new Date(app.lastSuccessfulSync).toLocaleTimeString('de-DE')
          : 'unbekannt'}</span
      >
    </footer>
  </main>
{/if}

<style>
  :global(body) {
    background: #0d0f10;
  }
  .monitor-entry,
  .monitor-loading {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background: #111315;
    color: #f1f2f3;
    overflow: auto;
  }
  .entry-dialog {
    width: min(520px, calc(100vw - 32px));
    border: 1px solid #3b3e44;
    background: #181a1d;
  }
  .entry-heading {
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid #303338;
  }
  .entry-logo {
    width: 42px;
    height: 42px;
    border-radius: 4px;
  }
  .entry-heading h1 {
    margin: 0;
    font-size: 21px;
  }
  .entry-heading p {
    margin: 4px 0 0;
    color: #9a9da4;
  }
  .entry-dialog > label,
  .entry-dialog > fieldset,
  .entry-dialog > button,
  .entry-dialog > details,
  .entry-dialog > .entry-error {
    margin-inline: 20px;
  }
  .room-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 20px;
    color: #c4c6ca;
    font-size: 13px;
  }
  .room-field input {
    height: 44px;
    font:
      700 20px ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
    letter-spacing: 0.14em;
    text-transform: lowercase;
  }
  fieldset {
    margin-top: 18px;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 7px;
    color: #c4c6ca;
    font-size: 13px;
  }
  .station-options {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .station-options button {
    min-height: 72px;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    background: #202226;
    border-color: #383b40;
    color: #f2f3f5;
  }
  .station-options button span {
    font-size: 25px;
    font-weight: 800;
  }
  .station-options button.active {
    border-color: #e8524a;
    background: #342022;
  }
  .entry-connect {
    width: calc(100% - 40px);
    min-height: 42px;
    justify-content: center;
    margin-top: 18px;
    border-color: #b4232d;
    background: #b4232d;
    color: #fff;
    font-weight: 700;
  }
  .entry-error {
    margin-top: 12px;
    padding: 10px 12px;
    border-left: 3px solid #e8524a;
    background: #2b1a1b;
    color: #ffaaa5;
  }
  details {
    margin-top: 16px;
    padding: 12px 0;
    border-top: 1px solid #303338;
    color: #9a9da4;
  }
  details summary {
    cursor: pointer;
    font-size: 12px;
  }
  details label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-top: 10px;
    font-size: 12px;
  }
  details input {
    height: 34px;
  }
  .control-room-link {
    display: block;
    padding: 14px 20px 18px;
    border-top: 1px solid #303338;
    color: #c4c6ca;
    text-align: center;
    text-decoration: none;
  }
  .control-room-link:hover {
    color: #fff;
  }
  .spinner {
    display: inline-flex;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .monitor-loading {
    align-content: center;
    gap: 10px;
    text-align: center;
  }
  .monitor-loading strong {
    font-size: 18px;
  }
  .monitor-loading > span:not(.spinner) {
    max-width: 460px;
    color: #9a9da4;
  }
  .monitor-loading button {
    margin-top: 8px;
  }

  .monitor-screen {
    --monitor-border: #34373b;
    height: 100dvh;
    display: grid;
    grid-template-rows: 72px minmax(0, 1fr) 32px;
    overflow: hidden;
    background: #0d0f10;
    color: #f1f2f3;
  }
  .monitor-header {
    display: grid;
    grid-template-columns: minmax(210px, auto) auto minmax(280px, 1fr) auto;
    align-items: center;
    gap: 20px;
    min-width: 0;
    padding: 0 18px;
    border-bottom: 1px solid var(--monitor-border);
    background: #191b1e;
  }
  .monitor-brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .monitor-brand img {
    width: 36px;
    height: 36px;
    border-radius: 4px;
  }
  .monitor-brand div {
    display: flex;
    flex-direction: column;
    line-height: 1.05;
  }
  .monitor-brand strong {
    font-size: 18px;
  }
  .monitor-brand span {
    color: #8f949b;
    font-size: 11px;
  }
  .station-switch {
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    min-width: 122px;
    padding: 7px 10px;
    background: #202226;
  }
  .station-switch span:first-child {
    color: #fff;
    font-weight: 750;
  }
  .station-switch span:last-child {
    color: #9a9da4;
    font:
      10px ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
  }
  .monitor-clock {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .monitor-clock strong {
    font-size: clamp(23px, 2.4vw, 34px);
  }
  .monitor-clock span {
    margin-top: 4px;
    color: #9a9da4;
    font-size: 11px;
    white-space: nowrap;
  }
  .header-actions {
    display: flex;
    gap: 6px;
  }
  .header-actions a {
    display: inline-flex;
    align-items: center;
    padding: 5px 10px;
    border: 1px solid #35383d;
    border-radius: 4px;
    background: #202226;
    color: #e9eaec;
    text-decoration: none;
  }

  .monitor-body {
    display: grid;
    grid-template-columns: minmax(0, 1.28fr) minmax(330px, 0.72fr);
    grid-template-rows: minmax(0, 1fr) var(--vehicle-board-height);
    min-height: 0;
  }
  .monitor-body.alarm-focus {
    grid-template-rows: minmax(0, 1fr);
  }
  .monitor-body.alarm-focus .vehicle-board,
  .monitor-body.alarm-focus .alarm-queue {
    display: none;
  }
  .incident-panel,
  .map-panel,
  .vehicle-board,
  .alarm-queue {
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--monitor-border);
    border-bottom: 1px solid var(--monitor-border);
    background: #151719;
  }
  .incident-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    border-top: 3px solid #666b71;
  }
  .monitor-body.alarm-focus .incident-panel {
    box-shadow: inset 0 0 0 2px #e8524a;
  }
  .incident-panel.wall-mode {
    display: block;
    border-top-color: #777b81;
  }
  .incident-wall {
    display: grid;
    width: 100%;
    height: 100%;
    gap: 1px;
    overflow: hidden;
    background: var(--monitor-border);
  }
  .incident-wall.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: minmax(0, 1fr);
  }
  .incident-wall.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: minmax(0, 1fr);
  }
  .incident-wall.four {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }
  .incident-wall.many {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-auto-rows: minmax(0, 1fr);
  }
  .incident-wall.dense {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    grid-auto-rows: minmax(0, 1fr);
  }
  .wall-event {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #151719;
  }
  .wall-event.latest {
    background: #191b1d;
  }
  .wall-event header {
    grid-column: 1;
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    min-height: 34px;
    padding: 0 10px;
    border-bottom: 1px solid #303338;
    color: #bfc2c6;
    font-size: 11px;
  }
  .wall-event header > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wall-event header time {
    margin-left: auto;
    color: #8f949b;
    font:
      10px ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
  }
  .queue-label {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    background: #303338;
    color: #d9dbde;
    font-weight: 900;
  }
  .wall-copy {
    grid-column: 1;
    align-self: center;
    min-width: 0;
    padding: clamp(8px, 1.4vh, 15px) clamp(14px, 1.8vw, 28px);
  }
  .wall-copy > span,
  .wall-copy p {
    margin: 0;
    color: #92969c;
    font:
      10px ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
  }
  .wall-copy h1 {
    margin: 5px 0 7px;
    overflow: hidden;
    font-size: clamp(19px, 2vw, 32px);
    line-height: 1.04;
    text-overflow: ellipsis;
  }
  .incident-wall.three .wall-copy h1,
  .incident-wall.many .wall-copy h1 {
    font-size: clamp(17px, 1.8vw, 28px);
  }
  .incident-wall.dense .wall-copy h1 {
    font-size: clamp(15px, 1.45vw, 23px);
  }
  .wall-units {
    grid-column: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 7px 9px;
    overflow: hidden;
    border-top: 1px solid #303338;
  }
  .wall-units > span {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    height: 25px;
    padding-right: 7px;
    overflow: hidden;
    border: 1px solid #41454a;
    background: #202326;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wall-units > span > b {
    align-self: stretch;
    display: grid;
    place-items: center;
    min-width: 24px;
    margin-right: 6px;
    background: #34383d;
    color: #fff;
  }
  .wall-units .wall-empty {
    padding-left: 7px;
    color: #8f949b;
  }
  .incident-type {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px 18px;
    border-bottom: 1px solid var(--monitor-border);
    color: #d6d8db;
  }
  .incident-type span {
    font-size: 15px;
    font-weight: 750;
  }
  .incident-type time {
    margin-left: auto;
    color: #9a9da4;
    font:
      12px ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
  }
  .focus-note {
    padding: 3px 7px;
    border: 1px solid #e8524a;
    color: #ff8e88;
    font-size: 10px;
    font-weight: 750;
  }
  .incident-copy {
    align-self: center;
    padding: clamp(22px, 4vh, 50px) clamp(22px, 4vw, 64px);
  }
  .incident-details {
    align-self: center;
    min-width: 0;
  }
  .incident-number {
    color: #9a9da4;
    font:
      600 clamp(13px, 1.2vw, 17px) ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
  }
  .incident-copy h1 {
    max-width: 1050px;
    margin: 12px 0 18px;
    font-size: clamp(38px, 5.2vw, 76px);
    line-height: 1.02;
    letter-spacing: -0.035em;
    text-wrap: balance;
  }
  .incident-position {
    color: #d0d2d5;
    font-size: clamp(17px, 1.8vw, 25px);
  }
  .dispatch-list {
    padding: 14px 18px 18px;
    border-top: 1px solid var(--monitor-border);
  }
  .dispatch-list h2,
  .section-title h2 {
    margin: 0;
    color: #aeb1b6;
    font-size: 12px;
    font-weight: 700;
  }
  .dispatch-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 7px;
    margin-top: 9px;
  }
  .dispatch-unit {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    align-items: center;
    min-height: 42px;
    border: 1px solid #484c51;
    background: #202326;
  }
  .unit-status {
    align-self: stretch;
    display: grid;
    place-items: center;
    background: var(--status-6-start);
    color: #fff;
    font-weight: 850;
  }
  .unit-status.status-0,
  .status-block.status-0,
  .wall-units > span > b.status-0 {
    background: var(--status-0-start);
  }
  .unit-status.status-1,
  .status-block.status-1,
  .wall-units > span > b.status-1 {
    background: var(--status-1-start);
  }
  .unit-status.status-2,
  .status-block.status-2,
  .wall-units > span > b.status-2 {
    background: var(--status-2-start);
  }
  .unit-status.status-3,
  .status-block.status-3,
  .wall-units > span > b.status-3 {
    background: var(--status-3-start);
  }
  .unit-status.status-4,
  .status-block.status-4,
  .wall-units > span > b.status-4 {
    background: var(--status-4-start);
  }
  .unit-status.status-5,
  .status-block.status-5,
  .wall-units > span > b.status-5 {
    background: var(--status-5-start);
  }
  .unit-status.status-6,
  .status-block.status-6,
  .wall-units > span > b.status-6 {
    background: var(--status-6-start);
  }
  .unit-status.status-7,
  .status-block.status-7,
  .wall-units > span > b.status-7 {
    background: var(--status-7-start);
  }
  .unit-status.status-8,
  .status-block.status-8,
  .wall-units > span > b.status-8 {
    background: var(--status-8-start);
  }
  .unit-status.status-9,
  .status-block.status-9,
  .wall-units > span > b.status-9 {
    background: var(--status-9-start);
  }
  .unit-name {
    padding: 0 9px;
    overflow: hidden;
    font-size: 15px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .unit-mode {
    grid-column: 2;
    padding: 0 9px 5px;
    color: #9a9da4;
    font-size: 10px;
  }
  .dispatch-empty {
    color: #9a9da4;
  }
  .standby {
    display: grid;
    place-content: center;
    justify-items: center;
    height: 100%;
    color: #9a9da4;
  }
  .standby-label {
    font-size: 20px;
  }
  .standby strong {
    color: #f2f3f4;
    font-size: clamp(74px, 12vw, 180px);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.06em;
  }
  .standby span:last-child {
    margin-top: 10px;
    font-size: 18px;
  }

  .map-panel {
    border-right: 0;
  }
  .map-standby {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
    height: 100%;
    color: #73777d;
  }
  .map-standby span {
    font-size: 16px;
  }
  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 0 12px;
    border-bottom: 1px solid var(--monitor-border);
    background: #1b1d20;
  }
  .section-title span {
    margin-left: auto;
    color: #9a9da4;
    font:
      11px ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
  }
  .vehicle-list,
  .queue-list {
    height: calc(100% - 38px);
  }
  .vehicle-list {
    display: grid;
    grid-template-columns: repeat(var(--vehicle-columns), minmax(0, 1fr));
    grid-auto-rows: 58px;
    gap: 1px;
    padding: 1px;
    overflow: hidden;
    align-content: start;
    background: #292c30;
  }
  .queue-list {
    overflow: auto;
  }
  .vehicle-row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: center;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #151719;
    color: #d9dbde;
  }
  .status-block {
    align-self: stretch;
    display: grid;
    place-items: center;
    background: var(--status-6-start);
    color: #fff;
    font-size: 16px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  .vehicle-main {
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
  }
  .vehicle-name {
    padding: 0 8px;
    overflow: hidden;
    font-size: clamp(11px, 0.82vw, 13px);
    font-weight: 750;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vehicle-type {
    max-width: 64px;
    margin-right: 8px;
    overflow: hidden;
    color: #8f949b;
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status-text {
    padding: 3px 8px 0;
    overflow: hidden;
    color: #9a9da4;
    font-size: 10px;
    line-height: 1.1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .alarm-queue {
    border-right: 0;
  }
  .queue-row {
    display: grid;
    grid-template-columns: 42px 50px minmax(0, 1fr) 28px;
    align-items: center;
    gap: 9px;
    min-height: 38px;
    padding: 0 10px;
    border-bottom: 1px solid #292c30;
  }
  .queue-label {
    width: 40px;
    height: 23px;
    overflow: hidden;
    font:
      850 10px ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .queue-row.current {
    background: #1d2023;
    box-shadow: inset 3px 0 #6e7379;
  }
  .queue-row time {
    color: #9a9da4;
    font:
      11px ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
  }
  .queue-row span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .queue-row strong {
    display: grid;
    place-items: center;
    width: 24px;
    height: 22px;
    background: #303338;
    font-size: 12px;
  }
  .board-empty {
    padding: 16px;
    color: #8f949b;
  }

  .monitor-footer {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 12px;
    background: #191b1e;
    color: #8f949b;
    font-size: 11px;
  }
  .monitor-footer span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .monitor-footer span:first-child {
    color: #62d9ad;
  }
  .monitor-footer span.offline {
    color: #ff8580;
  }
  .monitor-footer span:last-child {
    margin-left: auto;
  }

  @media (max-width: 900px) {
    .monitor-screen {
      display: block;
      height: 100dvh;
      overflow: auto;
    }
    .monitor-header {
      position: sticky;
      top: 0;
      z-index: 10;
      grid-template-columns: 1fr auto;
      min-height: 64px;
      padding: 8px 12px;
    }
    .monitor-brand {
      display: none;
    }
    .monitor-clock {
      grid-column: 1;
      grid-row: 1;
      align-items: flex-start;
    }
    .station-switch {
      grid-column: 2;
      grid-row: 1;
    }
    .header-actions {
      display: none;
    }
    .monitor-body {
      display: flex;
      flex-direction: column;
    }
    .incident-panel {
      min-height: 480px;
    }
    .incident-panel.wall-mode {
      min-height: 0;
    }
    .incident-wall,
    .incident-wall.two,
    .incident-wall.three,
    .incident-wall.four,
    .incident-wall.many {
      height: auto;
      grid-template-columns: 1fr;
      grid-template-rows: none;
      grid-auto-rows: minmax(220px, auto);
      overflow: visible;
    }
    .map-panel {
      min-height: 320px;
    }
    .vehicle-board,
    .alarm-queue {
      min-height: 240px;
    }
    .vehicle-list {
      height: auto;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      grid-auto-rows: 58px;
      overflow: visible;
    }
    .monitor-footer {
      min-height: 32px;
    }
  }

  @media (max-width: 540px) {
    .monitor-entry {
      padding: 16px;
    }
    .station-options {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .monitor-clock span {
      max-width: 210px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .incident-copy h1 {
      font-size: 40px;
    }
    .dispatch-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
