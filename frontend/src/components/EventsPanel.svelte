<script lang="ts">
  import { Axe, Biohazard, CircleCheck, Cross, Flame, RadioTower, Search, TriangleAlert, Waves } from 'lucide-svelte';
  import { api } from '../lib/api';
  import { eventCategory, type EventCategory } from '../lib/classify';
  import { refreshState } from '../lib/polling';
  import { app, askConfirm, canWrite, openAssign, setHighlightedEvent, showNotice } from '../lib/state.svelte';
  import type { EventItem } from '../lib/types';

  let query = $state('');
  let now = $state(Date.now());
  let finishing = $state<Set<number>>(new Set());

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  const sorted = $derived(
    [...app.events]
      .filter((event) => `${event.name ?? ''} ${event.id}`.toLocaleLowerCase('de').includes(query.trim().toLocaleLowerCase('de')))
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id - a.id)
  );

  const statusLabel: Record<string, string> = {
    active: 'laufend',
    canceled: 'abgebrochen',
    completed: 'abgeschlossen',
  };

  const categoryIcon = { fire: Flame, hazard: Biohazard, water: Waves, thl: Axe, medical: Cross, other: TriangleAlert };
  const categoryTitle: Record<EventCategory, string> = {
    fire: 'Brandeinsatz',
    hazard: 'Gefahrguteinsatz',
    water: 'Wassereinsatz',
    thl: 'Hilfeleistung',
    medical: 'Medizinischer Einsatz',
    other: 'Einsatz',
  };

  async function finish(ev: EventItem, e: MouseEvent): Promise<void> {
    e.stopPropagation();
    if (finishing.has(ev.id)) return;
    if (!(await askConfirm(`Einsatz „${ev.name}“ wirklich abschließen?`))) return;
    finishing = new Set(finishing).add(ev.id);
    try {
      await api('events_finish', { event_id: ev.id });
      showNotice(`Einsatz "${ev.name || ev.id}" abgeschlossen`);
      await refreshState();
    } catch (err) {
      app.lastError = (err as Error).message;
    } finally {
      const next = new Set(finishing);
      next.delete(ev.id);
      finishing = next;
    }
  }

  function ageText(ev: EventItem): string {
    if (!ev.created_at) return `Nr. ${ev.id}`;
    const elapsed = Math.max(0, now - new Date(ev.created_at.replace(' ', 'T')).getTime());
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return 'gerade angelegt';
    if (minutes < 60) return `seit ${minutes} Min.`;
    return `seit ${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
  }

  function assignedCount(id: number): number {
    return app.assignments.filter((item) => Number(item.event_id) === id).length;
  }

  function lastActivity(id: number): string {
    const row = [...app.logs].reverse().find((item) => Number(item.event_id) === id);
    return row?.updated_at?.slice(11, 16) ?? '';
  }
</script>

<section class="panel">
  <div class="panel-header">
    <span class="icon"><TriangleAlert size={14} /></span>
    <h2>Einsätze</h2>
    <span class="spacer"></span>
    <label class="event-search">
      <Search size={13} />
      <span class="sr-only">Einsätze filtern</span>
      <input type="text" bind:value={query} placeholder="Filtern" />
    </label>
    <span class="count">{sorted.length}</span>
  </div>
  <div class="panel-body">
    {#each sorted as ev (ev.id)}
      {@const cat = eventCategory(ev.name)}
      {@const isControlRoomEvent = ev.created_by === 'frontend'}
      {@const Icon = isControlRoomEvent ? RadioTower : categoryIcon[cat]}
      {@const iconTitle = isControlRoomEvent ? 'Leitstellen-Einsatz' : categoryTitle[cat]}
      {@const isAvailableInGame = !isControlRoomEvent || (ev.game_event_id !== null && String(ev.game_event_id).trim() !== '')}
      <div class="row" role="group" class:highlighted={app.highlightedEventId === ev.id} onmouseenter={() => setHighlightedEvent(ev.id)} onmouseleave={() => setHighlightedEvent(null)}>
        <button class="event-open" onclick={() => openAssign(ev)}>
          <span class="cat {cat}" class:control-room={isControlRoomEvent} data-tooltip={iconTitle} aria-label={iconTitle}><Icon size={16} /></span>
          <span class="info">
            <span class="name">{ev.name || 'Einsatz'}</span>
            <span class="meta">
              {ageText(ev)} · {assignedCount(ev.id)} {assignedCount(ev.id) === 1 ? 'Fahrzeug' : 'Fahrzeuge'}
              {#if lastActivity(ev.id)} · Funk {lastActivity(ev.id)}{/if}
              {#if isControlRoomEvent} · {isAvailableInGame ? 'Leitstelle' : 'wird ans Spiel übertragen'}{/if}
            </span>
          </span>
        </button>
        {#if isControlRoomEvent}
          <button class="ghost finish" data-tooltip="Einsatz abschließen" aria-label="Einsatz abschließen" disabled={finishing.has(ev.id) || !canWrite()} onclick={(e) => void finish(ev, e)}>
            <CircleCheck size={15} />
          </button>
        {/if}
      </div>
    {/each}
    {#if !sorted.length}
      <div class="empty-hint">Keine laufenden Einsätze</div>
    {/if}
  </div>
</section>

<style>
  .count {
    font-size: 11px;
    color: var(--text-dim);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1px 7px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    margin-bottom: 4px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-raised);
  }

  .row:hover,
  .row.highlighted {
    border-color: var(--selection);
    background: var(--accent-soft);
  }

  .event-open { flex: 1; min-width: 0; justify-content: flex-start; padding: 0; border: 0; background: transparent; text-align: left; }
  .event-open:hover:not(:disabled) { background: transparent; border-color: transparent; }
  .finish { flex: 0 0 auto; }
  .event-search { display: flex; align-items: center; gap: 5px; color: var(--text-dim); }
  .event-search input { width: 110px; padding: 4px 7px; font-size: 12px; }

  .cat {
    display: inline-flex;
    flex: 0 0 auto;
    color: var(--text-dim);
  }

  .cat.fire {
    color: var(--danger);
  }

  .cat.hazard {
    color: var(--warn);
  }

  .cat.thl {
    color: var(--accent);
  }

  .cat.water {
    color: var(--water);
  }

  .cat.medical {
    color: var(--good);
  }

  .cat.control-room {
    color: var(--accent);
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }

  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-size: 12px;
    color: var(--text-dim);
  }

  @media (max-width: 560px) {
    .panel-header { flex-wrap: wrap; }
    .event-search { order: 3; width: calc(100% - 34px); }
    .event-search input { flex: 1; }
  }
</style>
