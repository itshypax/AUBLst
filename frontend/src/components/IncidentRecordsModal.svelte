<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { ClipboardList, FileText, RadioTower, RefreshCw, Search, X } from '../lib/fontawesome-icons';
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import { focusTrap } from '../lib/focus';
  import { roadLocationLabel } from '../lib/routing';
  import { app } from '../lib/state.svelte';
  import { decodeEntities } from '../lib/text';
  import type { EventArchiveItem, EventRecordResponse } from '../lib/types';
  import EmptyState from './EmptyState.svelte';

  let { embedded = false, onClose = () => {} }: { embedded?: boolean; onClose?: () => void } = $props();

  let events = $state<EventArchiveItem[]>([]);
  let selectedId = $state<number | null>(null);
  let record = $state<EventRecordResponse | null>(null);
  let query = $state('');
  let status = $state<'all' | 'active' | 'completed' | 'canceled'>('all');
  let loading = $state(true);
  let detailLoading = $state(false);
  let error = $state('');

  const filtered = $derived(events.filter((event) => {
    const matchesText = `${event.name ?? ''} ${event.id}`.toLocaleLowerCase('de').includes(query.trim().toLocaleLowerCase('de'));
    return matchesText && (status === 'all' || event.status === status);
  }));

  const timeline = $derived.by(() => {
    if (!record) return [];
    const entries = [
      { id: 'created', at: record.event.created_at ?? '', kind: 'Einsatz', text: 'Einsatz aufgenommen' },
      ...record.alarms.map((alarm) => ({
        id: `alarm-${alarm.id}`,
        at: alarm.created_at,
        kind: 'Alarmierung',
        text: `${alarm.vehicle_name || alarm.game_vehicle_id}${alarm.mode ? ` · ${alarm.mode}` : ''}${alarm.player_name ? ` · ${alarm.player_name}` : ''}`,
      })),
      ...record.logs.map((log) => ({ id: `log-${log.id}`, at: log.updated_at, kind: 'Funk', text: decodeEntities(log.long_message || log.message) })),
      ...(record.feedback ?? []).map((feedback) => ({
        id: 'feedback-' + feedback.id,
        at: feedback.created_at,
        kind: 'R\u00fcckmeldung',
        text: feedback.content,
      })),
    ];
    if (record.event.status !== 'active') entries.push({ id: 'finished', at: record.event.updated_at ?? '', kind: 'Abschluss', text: record.event.status === 'completed' ? 'Einsatz abgeschlossen' : 'Einsatz abgebrochen' });
    return entries.sort((a, b) => new Date(a.at.replace(' ', 'T')).getTime() - new Date(b.at.replace(' ', 'T')).getTime());
  });

  function close(): void { onClose(); }
  function when(value?: string): string { return value ? new Date(value.replace(' ', 'T')).toLocaleString('de-DE') : '–'; }
  function statusLabel(value: EventArchiveItem['status']): string { return value === 'active' ? 'Laufend' : value === 'completed' ? 'Abgeschlossen' : 'Abgebrochen'; }
  function onRecordKeydown(event: KeyboardEvent, eventId: number): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void select(eventId);
  }

  async function loadArchive(): Promise<void> {
    loading = true;
    error = '';
    try {
      const response = await api<{ events: EventArchiveItem[] }>('events_archive');
      events = response.events ?? [];
      if (!selectedId && events.length) await select(events[0].id);
    } catch (loadError) { error = (loadError as Error).message; }
    finally { loading = false; }
  }

  async function select(eventId: number): Promise<void> {
    selectedId = eventId;
    detailLoading = true;
    error = '';
    try { record = await api<EventRecordResponse>('event_record', { event_id: eventId }); }
    catch (loadError) { error = (loadError as Error).message; record = null; }
    finally { detailLoading = false; }
  }

  onMount(() => void loadArchive());
</script>

<div class="backdrop" class:embedded role="presentation" onclick={(event) => !embedded && event.target === event.currentTarget && close()} onkeydown={(event) => !embedded && event.key === 'Escape' && close()} use:focusTrap={{ initial: '[data-autofocus]', disabled: embedded }} tabindex="-1">
  <div class="modal" role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-labelledby={embedded ? undefined : 'records-title'} aria-label={embedded ? 'Einsatzakte' : undefined}>
    {#if !embedded}<header>
      <span class="header-icon"><FaIcon icon={ClipboardList} size={18} /></span>
      <div><h2 id="records-title">Einsatzakte</h2><span>Alle Einsätze und Alarmierungen dieser Sitzung</span></div>
      <button class="ghost" data-autofocus data-tooltip="Neu laden" aria-label="Neu laden" onclick={() => void loadArchive()}><FaIcon icon={RefreshCw} size={16} /></button>
      <button class="ghost" data-tooltip="Schließen" aria-label="Schließen" onclick={close}><FaIcon icon={X} size={18} /></button>
    </header>{/if}

    <div class="workspace">
      <aside>
        <div class="filters" class:embedded>
          <label><FaIcon icon={Search} size={13} /><span class="sr-only">Einsätze filtern</span><input type="text" bind:value={query} placeholder="Einsatz suchen" /></label>
          <select bind:value={status} aria-label="Bearbeitungsstand"><option value="all">Alle</option><option value="active">Laufend</option><option value="completed">Abgeschlossen</option><option value="canceled">Abgebrochen</option></select>
          {#if embedded}<button class="ghost" data-tooltip="Akten neu laden" aria-label="Akten neu laden" onclick={() => void loadArchive()}><FaIcon icon={RefreshCw} size={15} /></button>{/if}
        </div>
        <div class="record-list">
          {#if loading}<div class="empty">Akten werden geladen …</div>{/if}
          {#if !loading && filtered.length}
            <table>
              <thead><tr><th>Einsatz</th><th>Status</th><th aria-label="Alarmierungen"><FaIcon icon={RadioTower} size={11} /></th><th aria-label="Funkeinträge"><FaIcon icon={FileText} size={11} /></th></tr></thead>
              <tbody>
                {#each filtered as event (event.id)}
                  <tr
                    class:selected={selectedId === event.id}
                    aria-selected={selectedId === event.id}
                    tabindex="0"
                    onclick={() => void select(event.id)}
                    onkeydown={(keyEvent) => onRecordKeydown(keyEvent, event.id)}
                  >
                    <td><span class="record-title">{event.name || `Einsatz ${event.id}`}</span><small>{when(event.created_at)}</small></td>
                    <td><span class="record-meta"><i class={event.status}></i>{statusLabel(event.status)}</span></td>
                    <td class="number">{event.dispatch_count}</td>
                    <td class="number">{event.log_count}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          {#if !loading && !filtered.length}<EmptyState compact search={Boolean(query.trim())} title={query.trim() ? 'Keine passenden Einsätze' : 'Noch keine Einsatzakten'} description={query.trim() ? 'Suchbegriff oder Bearbeitungsstand ändern.' : 'Einsätze erscheinen hier, sobald sie aufgenommen wurden.'} />{/if}
        </div>
      </aside>

      <main>
        {#if error}<div class="error" role="alert">{error}</div>{/if}
        {#if detailLoading}<div class="detail-empty">Einsatzakte wird geladen …</div>
        {:else if record}
          <div class="record-head">
            <div><span class="eyebrow">Einsatz #{record.event.id}</span><h3>{record.event.name || 'Ohne Bezeichnung'}</h3></div>
            <span class="status {record.event.status}">{statusLabel(record.event.status)}</span>
          </div>
          <dl>
            <div><dt>Beginn</dt><dd>{when(record.event.created_at)}</dd></div>
            <div><dt>Letzte Änderung</dt><dd>{when(record.event.updated_at)}</dd></div>
            <div><dt>Quelle</dt><dd>{record.event.created_by === 'game' ? 'EM4' : 'Leitstelle'}</dd></div>
            <div><dt>Ort</dt><dd title={`Position ${Number(record.event.x).toFixed(0)}, ${Number(record.event.y).toFixed(0)}`}>{roadLocationLabel(record.event, app.routing) ?? `${Number(record.event.x).toFixed(0)}, ${Number(record.event.y).toFixed(0)}`}</dd></div>
          </dl>
          {#if record.note?.content && !record.feedback?.length}<section class="note"><h4>Notiz</h4><p>{record.note.content}</p></section>{/if}
          <section class="history"><h4>Verlauf</h4>
            {#if timeline.length}
              <ol>{#each timeline as item (item.id)}<li><time>{when(item.at)}</time><strong>{item.kind}</strong><span>{item.text}</span></li>{/each}</ol>
            {:else}<div class="empty">Noch keine Einträge</div>{/if}
          </section>
        {:else}<div class="detail-empty">Einsatz links auswählen</div>{/if}
      </main>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 20px; background: rgba(4, 6, 10, 0.72); }
  .modal { width: min(1180px, 97vw); height: min(820px, 94vh); display: flex; flex-direction: column; overflow: hidden; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow); }
  .backdrop.embedded { position: static; inset: auto; width: 100%; height: 100%; padding: 0; background: transparent; }
  .backdrop.embedded .modal { width: 100%; height: 100%; border: 0; border-radius: 0; box-shadow: none; }
  header { display: flex; align-items: center; gap: 10px; padding: 12px 15px; border-bottom: 1px solid var(--border); background: var(--panel-header); }
  .header-icon { display: inline-flex; color: var(--text-dim); } header div { flex: 1; } h2, h3, h4 { margin: 0; } h2 { font-size: 15px; } header div > span { color: var(--text-dim); font-size: 11px; }
  .workspace { min-height: 0; flex: 1; display: grid; grid-template-columns: 340px minmax(0, 1fr); }
  aside { min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg-raised); }
  .filters { display: grid; grid-template-columns: 1fr 118px; gap: 7px; padding: 10px; border-bottom: 1px solid var(--border); }
  .filters.embedded { grid-template-columns: 1fr 118px auto; }
  .filters label { display: flex; align-items: center; gap: 6px; color: var(--text-dim); } .filters input { min-width: 0; width: 100%; }
  .record-list { min-height: 0; overflow: auto; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { position: sticky; top: 0; z-index: 1; background: var(--panel-header); }
  th { height: 29px; padding: 5px 7px; border-bottom: 1px solid var(--border-strong); color: var(--text-dim); font-size: 9px; font-weight: 600; text-align: left; }
  th:nth-child(2) { width: 82px; } th:nth-child(3), th:nth-child(4) { width: 35px; text-align: center; }
  tbody tr { cursor: pointer; }
  tbody tr:hover, tbody tr.selected { background: var(--accent-soft); }
  tbody tr.selected { box-shadow: inset 3px 0 var(--accent); }
  td { padding: 7px; border-bottom: 1px solid var(--border); color: var(--text-dim); font-size: 10px; vertical-align: middle; }
  td:first-child { padding-left: 11px; }
  .record-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 11px; font-weight: 600; }
  td small { display: block; margin-top: 2px; overflow: hidden; color: var(--text-dim); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
  .record-meta { display: flex; align-items: center; gap: 5px; color: var(--text-dim); font-size: 9px; }
  .number { text-align: center; font-variant-numeric: tabular-nums; }
  i { width: 6px; height: 6px; background: var(--warn); } i.completed { background: var(--good); } i.canceled { background: var(--danger); }
  main { min-width: 0; overflow: auto; padding: 18px 20px; } .detail-empty, .empty { display: grid; min-height: 120px; place-items: center; color: var(--text-dim); font-size: 12px; }
  .error { margin-bottom: 12px; padding: 9px; border-left: 3px solid var(--danger); background: rgba(255, 82, 82, 0.08); color: var(--danger); }
  .record-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 14px; } .record-head > div { flex: 1; } .eyebrow { color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; } h3 { margin-top: 3px; font-size: 20px; }
  .status { padding: 4px 7px; border: 1px solid var(--status-3-border); color: var(--warn-text); font-size: 11px; } .status.completed { border-color: rgba(46, 201, 142, .5); color: var(--good-text); } .status.canceled { border-color: rgba(232, 82, 74, .5); color: var(--danger-text); }
  dl { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 0 0 16px; } dl div { padding: 8px 10px; border: 1px solid var(--border); background: var(--bg-raised); } dt { color: var(--text-dim); font-size: 10px; } dd { margin: 3px 0 0; font-size: 12px; }
  .note, .history { margin-top: 12px; padding: 13px; border: 1px solid var(--border); background: var(--bg-raised); } h4 { margin-bottom: 10px; font-size: 12px; } .note p { margin: 0; white-space: pre-wrap; font-size: 12px; }
  ol { margin: 0; padding: 0; list-style: none; } li { display: grid; grid-template-columns: 132px 78px minmax(0, 1fr); gap: 9px; padding: 7px 0; border-top: 1px solid var(--border); font-size: 11px; } li:first-child { border-top: 0; } time { color: var(--text-dim); } li strong { color: var(--accent); } li span { overflow-wrap: anywhere; }
  @media (max-width: 760px) { .backdrop { padding: 7px; } .workspace { grid-template-columns: 1fr; grid-template-rows: 260px 1fr; } aside { border-right: 0; border-bottom: 1px solid var(--border); } dl { grid-template-columns: 1fr 1fr; } li { grid-template-columns: 1fr; gap: 2px; } }
</style>
