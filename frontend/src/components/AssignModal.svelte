<script lang="ts">
  import { ArrowUpDown, Play, Search, Send, Siren, Undo2, X } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import { alarmGroups, hasLoeschzug, hasMapPosition, isHiddenUnit, loeschzugFor, vehicleAlarmPriority, type StationGroup } from '../lib/classify';
  import { focusTrap } from '../lib/focus';
  import { refreshState } from '../lib/polling';
  import { createRouteCalculator, formatDistance, type RouteDistance } from '../lib/routing';
  import { app, canWrite, showNotice } from '../lib/state.svelte';
  import { decodeEntities } from '../lib/text';
  import type { AssignedVehicle, EventNote, LogRow, StateResponse, Vehicle } from '../lib/types';
  import StatusBadge from './StatusBadge.svelte';

  const initialEvent = app.assignEvent!;
  const eventId = initialEvent.id;
  // Die Liste bleibt während der Alarmierung stabil. Der 3-Sekunden-Abgleich
  // darf ein gerade geöffnetes natives Auswahlfeld nicht neu aufbauen.
  const vehicles = app.vehicles.map((vehicle) => ({ ...vehicle }));
  const players = app.players.map((player) => ({ ...player }));
  const ev = $derived(app.events.find((event) => event.id === eventId) ?? app.assignEvent ?? initialEvent);
  const isControlRoomEvent = $derived(ev.created_by === 'frontend');
  const isAvailableInGame = $derived(!isControlRoomEvent || (ev.game_event_id !== null && String(ev.game_event_id).trim() !== ''));
  const routeToEvent = $derived(createRouteCalculator(ev, app.routing));

  let search = $state('');
  let sortByDistance = $state(true);
  let selected = $state<number[]>([]);
  let playerId = $state('');
  let notes = $state('');
  let notesLoaded = $state(false);
  let initialNotes = $state('');
  let assigned = $state<AssignedVehicle[] | null>(null);
  let eventLogs = $state<LogRow[]>([]);
  let errorMsg = $state('');
  let busy = $state(false);
  let returning = $state<Set<number>>(new Set());
  let preflightUnavailable = $state<Set<number>>(new Set());

  const available = $derived(
    vehicles.filter((v) => {
      const s = Number(v.status);
      return (isHiddenUnit(v) || s === 1 || s === 2) && !preflightUnavailable.has(v.id);
    })
  );

  function matchesSearch(v: Vehicle): boolean {
    const q = search.trim();
    if (!q) return true;
    const label = `${v.name || ''} ${v.type || ''} ${v.game_vehicle_id || ''} ${v.id}`.trim();
    if (q.startsWith('/') && q.lastIndexOf('/') > 0) {
      const lastSlash = q.lastIndexOf('/');
      try {
        return new RegExp(q.slice(1, lastSlash), q.slice(lastSlash + 1)).test(label);
      } catch {
        // ungültige Regex, weiter mit Wortsuche
      }
    }
    const hay = label.toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every((token) => hay.includes(token));
  }

  function selectLoeschzug(group: StationGroup): void {
    const picks = loeschzugFor(group, (v) => {
      const s = Number(v.status);
      return s === 1 || s === 2;
    });
    const additions = picks.map((v) => v.id).filter((id) => !selected.includes(id));
    if (additions.length) {
      selected = [...selected, ...additions];
    }
  }

  const NEAR_DISTANCE_METERS = 100;

  function distanceFor(v: Vehicle): RouteDistance | null {
    if (!hasMapPosition(v)) return null;
    return routeToEvent(v, v);
  }

  function distanceMeters(v: Vehicle): number | null {
    return distanceFor(v)?.meters ?? null;
  }

  function unitSuffix(v: Vehicle): string {
    const parts = (v.game_vehicle_id || v.name || '').split(/[_-]/).filter(Boolean);
    return parts.at(-1) ?? '';
  }

  function compareAlarmPriority(a: Vehicle, b: Vehicle, useDistance: boolean): number {
    const priority = vehicleAlarmPriority(a) - vehicleAlarmPriority(b);
    if (priority) return priority;
    const suffix = unitSuffix(a).localeCompare(unitSuffix(b), 'de', { numeric: true, sensitivity: 'base' });
    if (suffix) return suffix;
    if (useDistance) {
      const distanceA = distanceMeters(a) ?? Number.POSITIVE_INFINITY;
      const distanceB = distanceMeters(b) ?? Number.POSITIVE_INFINITY;
      if (distanceA !== distanceB) return distanceA - distanceB;
    }
    const nameA = a.name || a.type || a.game_vehicle_id || String(a.id);
    const nameB = b.name || b.type || b.game_vehicle_id || String(b.id);
    return nameA.localeCompare(nameB, 'de', { numeric: true });
  }

  function sortAlarmVehicles(vehicles: Vehicle[]): Vehicle[] {
    if (!sortByDistance) return [...vehicles].sort((a, b) => compareAlarmPriority(a, b, false));

    const located = vehicles
      .map((vehicle) => ({ vehicle, distance: distanceMeters(vehicle) }))
      .filter((entry): entry is { vehicle: Vehicle; distance: number } => entry.distance !== null)
      .sort((a, b) => a.distance - b.distance);
    const result: Vehicle[] = [];

    for (let start = 0; start < located.length;) {
      let end = start + 1;
      while (end < located.length && located[end].distance - located[start].distance <= NEAR_DISTANCE_METERS) {
        end += 1;
      }
      result.push(...located.slice(start, end).map((entry) => entry.vehicle).sort((a, b) => compareAlarmPriority(a, b, true)));
      start = end;
    }

    const withoutPosition = vehicles.filter((vehicle) => distanceMeters(vehicle) === null).sort((a, b) => compareAlarmPriority(a, b, false));
    return [...result, ...withoutPosition];
  }

  function nearestGroupDistance(group: StationGroup): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (const vehicle of group.vehicles) {
      const distance = distanceMeters(vehicle);
      if (distance !== null && distance < nearest) nearest = distance;
    }
    return nearest;
  }

  const groups = $derived.by(() => {
    const grouped = alarmGroups(available.filter(matchesSearch)).map((group, standardOrder) => ({
      ...group,
      standardOrder,
      vehicles: sortAlarmVehicles(group.vehicles),
    }));
    if (sortByDistance) {
      grouped.sort((a, b) => nearestGroupDistance(a) - nearestGroupDistance(b) || a.standardOrder - b.standardOrder);
    }
    return grouped;
  });

  // Zuletzt alarmierter Modus pro Fahrzeug (z. B. WLF mit AB-Ruest,
  // GW-W mit Taucher) bleibt über Sitzungen hinweg vorausgewählt
  const LAST_MODES_KEY = 'lastModes';

  function loadLastModes(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(LAST_MODES_KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  const lastModes = loadLastModes();

  // Muss vor dem ersten Render stehen, sonst setzt bind:value am Select
  // die erste Option, bevor die gemerkten Modi greifen
  function initialModes(): Record<number, string> {
    const result: Record<number, string> = {};
    for (const v of vehicles) {
      if (!v.modes) continue;
      const options = v.modes.split(',');
      const remembered = lastModes[v.game_vehicle_id];
      result[v.id] = remembered && options.includes(remembered) ? remembered : options[0];
    }
    return result;
  }

  let modes = $state<Record<number, string>>(initialModes());

  function distanceText(v: Vehicle): string {
    return formatDistance(distanceFor(v));
  }


  onMount(() => {
    void load();
    const timer = setInterval(() => void loadLogs(), 5000);
    return () => clearInterval(timer);
  });

  async function load(): Promise<void> {
    try {
      const res = await api<{ vehicles: AssignedVehicle[] }>('events_get_vehicles', { event_id: eventId });
      assigned = res.vehicles;
      const noteRes = await api<{ notes: EventNote[] }>('events_get_note', { event_id: eventId });
      notes = noteRes.notes.map((n) => n.content).join('\n');
      initialNotes = notes;
      notesLoaded = true;
      await loadLogs();
    } catch (err) {
      errorMsg = (err as Error).message;
    }
  }

  async function loadLogs(): Promise<void> {
    try {
      const res = await api<{ logs: LogRow[] }>('events_get_logs', { event_id: eventId });
      eventLogs = res.logs ?? [];
    } catch {
      // Verlauf ist nicht kritisch
    }
  }

  function toggle(v: Vehicle): void {
    selected = selected.includes(v.id) ? selected.filter((id) => id !== v.id) : [...selected, v.id];
  }

  function nameOf(id: number): string {
    const v = vehicles.find((x) => x.id === id);
    return v ? v.name || v.type || v.game_vehicle_id : `#${id}`;
  }

  async function saveNotes(): Promise<void> {
    if (!notesLoaded || notes === initialNotes) return;
    await api('events_set_note', { event_id: eventId, content: notes });
    initialNotes = notes;
  }

  async function close(): Promise<void> {
    if (busy) return;
    try {
      await saveNotes();
      app.assignEvent = null;
    } catch (err) {
      errorMsg = `Notizen nicht gespeichert: ${(err as Error).message}`;
    }
  }

  async function submit(): Promise<void> {
    if (!selected.length || busy) return;
    if (!isAvailableInGame) {
      errorMsg = 'Der Einsatz wird noch ans Spiel übertragen. Bitte kurz warten.';
      return;
    }
    try {
      busy = true;
      errorMsg = '';
      const latest = await api<StateResponse>('state');
      const currentById = new Map((latest.vehicles ?? []).map((vehicle) => [Number(vehicle.id), vehicle]));
      const unavailableIds = selected.filter((id) => {
        const current = currentById.get(id);
        return !current || (!isHiddenUnit(current) && ![1, 2].includes(Number(current.status)));
      });
      if (unavailableIds.length) {
        preflightUnavailable = new Set([...preflightUnavailable, ...unavailableIds]);
        selected = selected.filter((id) => !preflightUnavailable.has(id));
        const names = unavailableIds.map(nameOf).join(', ');
        errorMsg = `${names} ${unavailableIds.length === 1 ? 'ist' : 'sind'} inzwischen alarmiert oder nicht mehr verfügbar und ${unavailableIds.length === 1 ? 'wurde' : 'wurden'} aus der Auswahl entfernt.`;
        return;
      }

      const chosenModes: Record<number, string> = {};
      for (const id of selected) {
        if (modes[id]) chosenModes[id] = modes[id];
      }
      await saveNotes();
      await api('events_assign', {
        event_id: eventId,
        vehicle_ids: selected,
        player_id: playerId ? parseInt(playerId, 10) : null,
        modes: chosenModes,
      });
      for (const id of selected) {
        if (!chosenModes[id]) continue;
        const v = vehicles.find((x) => x.id === id);
        if (v) lastModes[v.game_vehicle_id] = chosenModes[id];
      }
      localStorage.setItem(LAST_MODES_KEY, JSON.stringify(lastModes));
      app.assignEvent = null;
      showNotice(`${selected.length} ${selected.length === 1 ? 'Fahrzeug alarmiert' : 'Fahrzeuge alarmiert'}`);
      void refreshState();
    } catch (err) {
      errorMsg = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  async function sendHome(id: number): Promise<void> {
    if (returning.has(id)) return;
    returning = new Set(returning).add(id);
    try {
      await api('events_unassign', { vehicle_ids: [id] });
      assigned = assigned?.filter((a) => a.id !== id) ?? null;
      void refreshState();
    } catch (err) {
      errorMsg = (err as Error).message;
    } finally {
      const next = new Set(returning);
      next.delete(id);
      returning = next;
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      void close();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  }

  function onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) void close();
  }
</script>

<div class="backdrop" onclick={onBackdropClick} onkeydown={onKeydown} role="presentation" use:focusTrap={{ initial: '[data-autofocus]' }} tabindex="-1">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="assign-title">
    <header>
      <span class="icon"><Siren size={16} /></span>
      <div class="title">
        <h3 id="assign-title">Alarmierung – {ev.name || 'Einsatz'}</h3>
        <span class="meta">Nr. {ev.id} · Position {ev.x.toFixed(1)}, {ev.y.toFixed(1)}</span>
      </div>
      <button class="ghost" data-tooltip="Schließen" aria-label="Schließen" disabled={busy} onclick={() => void close()}><X size={18} /></button>
    </header>

    <div class="body">
      <aside class="notes">
        <span class="block-label">Notizen</span>
        <textarea bind:value={notes} placeholder="Einsatznotizen …" disabled={busy}></textarea>
        <span class="block-label">Verlauf</span>
        <div class="event-log">
          {#each [...eventLogs].reverse() as row (row.id)}
            <div class="log-row" class:log-done={row.state === 'inactive'}>
              <span class="log-time" data-tooltip={row.updated_at}>{row.updated_at?.slice(11, 16)}</span>
              <span class="log-text">
                {#if row.entity_id}<b>{row.entity_id}</b> · {/if}{decodeEntities(row.long_message)}
              </span>
            </div>
          {:else}
            <span class="log-empty">Noch keine Meldungen zu diesem Einsatz</span>
          {/each}
        </div>
      </aside>

      <div class="main">
        {#if assigned === null}
          <div class="block-label">Bereits alarmiert: lädt …</div>
        {:else if assigned.length}
          <div class="block">
            <span class="block-label">Bereits alarmiert</span>
            <div class="chips">
              {#each assigned as a (a.id)}
                <span class="chip">
                  <StatusBadge value={a.status} />
                  {a.name || a.game_vehicle_id}
                  {#if Number(a.status) === 3}
                    <button class="ghost" data-tooltip="Einrücken lassen" aria-label="Einrücken lassen" disabled={returning.has(a.id)} onclick={() => void sendHome(a.id)}>
                      <Undo2 size={12} />
                    </button>
                  {/if}
                </span>
              {/each}
            </div>
          </div>
        {/if}

        <div class="controls">
          <label class="player">
            <span>Spieler</span>
            <select bind:value={playerId} disabled={busy}>
              <option value="">– Kein Spieler –</option>
              {#each players as p (p.id)}
                <option value={String(p.id)}>{p.name || p.player_id || `Spieler #${p.id}`}</option>
              {/each}
            </select>
          </label>
          <label class="search">
            <Search size={14} />
            <input type="text" bind:value={search} placeholder="Fahrzeug suchen …" aria-label="Fahrzeug suchen" data-autofocus disabled={busy} />
          </label>
          <button
            class="sort-toggle"
            class:active={sortByDistance}
            aria-pressed={sortByDistance}
            data-tooltip={sortByDistance ? 'Deutliche Entfernungsunterschiede zuerst berücksichtigen' : 'Nur nach Fahrzeugfolge sortieren'}
            disabled={busy}
            onclick={() => (sortByDistance = !sortByDistance)}
          >
            <ArrowUpDown size={14} />
            {sortByDistance ? 'Entfernung' : 'Fahrzeugfolge'}
          </button>
        </div>

        {#if isControlRoomEvent && !isAvailableInGame}
          <div class="dispatch-state" role="status">
            Der Einsatz wird noch ans Spiel übertragen. Die Alarmierung ist möglich, sobald EM4 ihn bestätigt hat.
          </div>
        {/if}

        {#if selected.length}
          <div class="block">
            <span class="block-label">Ausgewählt ({selected.length})</span>
            <div class="chips">
              {#each selected as id (id)}
                <span class="chip selected">
                  {nameOf(id)}
                  <button
                    class="ghost"
                    data-tooltip="Entfernen"
                    aria-label="Auswahl entfernen"
                    disabled={busy}
                    onclick={() => (selected = selected.filter((x) => x !== id))}
                  >
                    <X size={12} />
                  </button>
                </span>
              {/each}
            </div>
          </div>
        {/if}

        <div class="groups">
          {#each groups as g (g.key)}
            <div class="station-head">
              <span class="station-label">{g.label}</span>
              {#if hasLoeschzug(g)}
                <button class="zug" data-tooltip="Löschzug dieser Wache auswählen" disabled={busy} onclick={() => selectLoeschzug(g)}>
                  <Play size={12} />
                  Löschzug
                </button>
              {/if}
            </div>
            <div class="grid">
              {#each g.vehicles as v (v.id)}
                <div class="veh" class:checked={selected.includes(v.id)}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(v.id)}
                      disabled={busy}
                      onchange={() => toggle(v)}
                    />
                    {#if g.key !== 'hidden'}
                      <StatusBadge value={v.status} />
                    {/if}
                    <span class="name" data-tooltip={`${v.name || v.game_vehicle_id}${v.type ? ` · Typ ${v.type}` : ''} · ${v.game_vehicle_id}`}>
                      {v.name || v.type || v.game_vehicle_id}
                    </span>
                    {#if distanceText(v)}
                      <span class="dist">{distanceText(v)}</span>
                    {/if}
                  </label>
                  {#if v.modes}
                    <select bind:value={modes[v.id]} data-tooltip="Ausrückmodus" aria-label={`Ausrückmodus für ${v.name || v.game_vehicle_id}`} disabled={busy}>
                      {#each v.modes.split(',') as m (m)}
                        <option value={m}>{m}</option>
                      {/each}
                    </select>
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
          {#if !available.length}
            <div class="empty-hint">Keine verfügbaren Fahrzeuge (Status 1 oder 2)</div>
          {/if}
        </div>
      </div>
    </div>

    <footer>
      {#if errorMsg}
        <span class="error">{errorMsg}</span>
      {/if}
      <span class="hint">Strg+Enter alarmiert · Esc schließt</span>
      <button class="primary" disabled={!selected.length || busy || !canWrite() || !isAvailableInGame} onclick={() => void submit()}>
        <Send size={14} />
        {busy ? 'Wird alarmiert …' : `Alarmieren${selected.length ? ` (${selected.length})` : ''}`}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 6, 10, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .modal {
    width: min(1080px, 92vw);
    max-height: 90vh;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--panel-header);
    border-bottom: 1px solid var(--border);
  }

  header .icon {
    color: var(--danger);
    display: inline-flex;
  }

  .title {
    flex: 1;
    min-width: 0;
  }

  .title h3 {
    margin: 0;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title .meta {
    font-size: 12px;
    color: var(--text-dim);
  }

  .body {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 14px;
    padding: 14px 16px;
    overflow: auto;
    flex: 1 1 auto;
    min-height: 0;
  }

  .dispatch-state {
    padding: 8px 10px;
    color: var(--text-dim);
    background: var(--accent-soft);
    border: 1px solid var(--selection);
    border-radius: var(--radius-sm);
    font-size: 12px;
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
  }

  .notes textarea {
    flex: 1 1 auto;
    min-height: 130px;
    resize: none;
  }

  .event-log {
    flex: 1 1 auto;
    min-height: 90px;
    max-height: 220px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }

  .log-row {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }

  .log-row.log-done {
    opacity: 0.5;
  }

  .log-time {
    color: var(--text-dim);
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }

  .log-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .log-empty {
    color: var(--text-dim);
  }

  .main {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .block-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-raised);
    font-size: 13px;
  }

  .chip.selected {
    border-color: var(--selection);
    background: var(--accent-soft);
  }

  .controls {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }

  .player {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-dim);
  }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 200px;
    color: var(--text-dim);
  }

  .search input {
    flex: 1;
  }

  .sort-toggle {
    flex: 0 0 auto;
    color: var(--text-dim);
  }

  .sort-toggle.active {
    color: var(--text);
    border-color: var(--selection);
    background: var(--accent-soft);
  }

  .groups {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 8px;
    overflow: auto;
    max-height: 44vh;
  }

  .station-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 2px 4px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 6px;
  }

  .station-head:not(:first-child) {
    margin-top: 10px;
  }

  .station-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text);
  }

  .zug {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    border-color: var(--status-4-border);
    background: rgba(230, 60, 60, 0.1);
    color: #ffb1ac;
  }

  .zug:hover:not(:disabled) {
    background: rgba(230, 60, 60, 0.22);
    border-color: var(--status-4-start);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 4px;
  }

  .veh {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
  }

  .veh:hover {
    background: var(--accent-soft);
  }

  .veh.checked {
    border-color: var(--selection);
    background: var(--accent-soft);
  }

  .veh label {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }

  .veh .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .veh .dist {
    margin-left: auto;
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .veh select {
    width: 100%;
    font-size: 12px;
    padding: 2px 6px;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 12px;
    justify-content: flex-end;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    background: var(--panel-header);
  }

  .error {
    color: var(--danger);
    font-size: 13px;
    margin-right: auto;
  }

  .hint {
    font-size: 12px;
    color: var(--text-dim);
  }

  @media (max-width: 820px) {
    .modal { width: 96vw; max-height: 94vh; }
    .body { grid-template-columns: 1fr; gap: 12px; }
    .notes { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 130px; column-gap: 10px; }
    .notes textarea, .event-log { min-height: 110px; max-height: 130px; }
    .groups { max-height: 42vh; }
  }

  @media (max-width: 560px) {
    .notes { display: flex; }
    .controls { align-items: stretch; }
    .player, .search { width: 100%; }
    .player select, .search input { flex: 1; }
    .sort-toggle { width: 100%; justify-content: center; }
    footer .hint { display: none; }
  }
</style>
