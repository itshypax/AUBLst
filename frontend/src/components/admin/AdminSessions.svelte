<script lang="ts">
  import { deleteSession, fetchSessions, formatLogTime, sessionIsStale, type AdminSessions } from '../../lib/admin';
  import { askConfirm } from '../../lib/state.svelte';

  const { key }: { key: string } = $props();

  let data = $state<AdminSessions | null>(null);
  let error = $state('');
  let busy = $state(0);

  $effect(() => {
    void load(key);
  });

  async function load(current: string): Promise<void> {
    try {
      data = await fetchSessions(current);
      error = '';
    } catch (cause) {
      error = (cause as Error).message;
    }
  }

  async function end(id: number, token: string): Promise<void> {
    const ok = await askConfirm(
      `Sitzung ${token} beenden? Fahrzeuge, Einsätze und Meldungen dieser Runde werden gelöscht, der Adapter muss sich neu verbinden.`,
    );
    if (!ok) return;
    busy = id;
    try {
      await deleteSession(key, id);
      await load(key);
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      busy = 0;
    }
  }
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if data}
  <p class="hint">
    Der Server räumt Sitzungen ohne Lebenszeichen nach {Math.round(data.ttlSeconds / 60)} Minuten selbst weg. Still markierte
    Zeilen sind beim nächsten Durchlauf dran.
  </p>
  <section class="sheet">
    <table>
      <thead>
        <tr>
          <th>Code</th>
          <th>Mod</th>
          <th>Zuletzt aktiv</th>
          <th>Angelegt</th>
          <th>Spieler</th>
          <th>Fahrzeuge</th>
          <th>Offene Einsätze</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each data.sessions as session (session.id)}
          <tr class:stale={sessionIsStale(session, data.ttlSeconds)}>
            <td>
              <code>{session.token}</code>
              {#if session.has_pin}<span class="hint">mit PIN</span>{/if}
            </td>
            <td>{session.mod_id ?? '–'}</td>
            <td>{formatLogTime(session.last_activity_at)}</td>
            <td>{formatLogTime(session.created_at)}</td>
            <td class="number">{session.players}</td>
            <td class="number">{session.vehicles}</td>
            <td class="number">{session.open_events}</td>
            <td>
              <button class="ghost" disabled={busy === session.id} onclick={() => end(session.id, session.token)}>Beenden</button>
            </td>
          </tr>
        {/each}
        {#if !data.sessions.length}
          <tr><td colspan="8" class="hint">Gerade läuft keine Sitzung.</td></tr>
        {/if}
      </tbody>
    </table>
  </section>
  {#if data.limit && data.sessions.length >= data.limit}
    <p class="hint">Gezeigt werden nur die neuesten {data.limit} Sitzungen.</p>
  {/if}
{:else if !error}
  <p class="hint">Sitzungen werden geladen.</p>
{/if}

<style>
  .sheet {
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  th {
    font-weight: 600;
    color: var(--text-dim);
  }
  td .hint {
    display: block;
    font-size: 11px;
  }
  .number {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tr.stale td {
    color: var(--text-dim);
  }
  .error {
    margin: 0;
    color: var(--danger-text);
    font-size: 13px;
  }
  .hint {
    margin: 0;
    color: var(--text-dim);
    font-size: 13px;
  }
</style>
