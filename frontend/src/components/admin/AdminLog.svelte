<script lang="ts">
  import {
    fetchSessionLog,
    formatLogTime,
    groupSessionLog,
    LOG_LEVEL_LABELS,
    type LogLevel,
    type SessionLogEntry,
  } from '../../lib/admin';

  const { key }: { key: string } = $props();

  let log = $state<{ entries: SessionLogEntry[]; limit: number } | null>(null);
  let error = $state('');
  let level = $state<LogLevel | ''>('');
  const groups = $derived(log ? groupSessionLog(log.entries, level) : []);

  $effect(() => {
    void load(key);
  });

  async function load(current: string): Promise<void> {
    try {
      log = await fetchSessionLog(current);
      error = '';
    } catch (cause) {
      error = (cause as Error).message;
    }
  }
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if log}
  <section class="log">
    <div class="log-head">
      <h2>Adapter-Log der letzten 24 Stunden</h2>
      <label>
        <span>Level</span>
        <select bind:value={level}>
          <option value="">Alle</option>
          {#each Object.entries(LOG_LEVEL_LABELS) as [value, label] (value)}
            <option {value}>{label}</option>
          {/each}
        </select>
      </label>
    </div>
    {#if !groups.length}
      <p class="hint">{level ? 'Keine Einträge mit diesem Level.' : 'In den letzten 24 Stunden hat kein Adapter etwas gemeldet.'}</p>
    {/if}
    {#each groups as group (group.sessionId)}
      <details>
        <summary>
          <strong>Sitzung {group.sessionId}</strong>
          <span class="hint">
            {formatLogTime(group.entries[0].created_at)} bis {formatLogTime(group.entries[group.entries.length - 1].created_at)},
            {group.entries.length}
            {group.entries.length === 1 ? 'Eintrag' : 'Einträge'}{#if group.problems}, {group.problems} mit Warnung oder Fehler{/if}
          </span>
        </summary>
        <ol>
          {#each group.entries as entry (entry.id)}
            <li class={entry.level}>
              <time>{formatLogTime(entry.created_at)}</time>
              <span class="level">{LOG_LEVEL_LABELS[entry.level] ?? entry.level}</span>
              <span class="text">{entry.text}</span>
            </li>
          {/each}
        </ol>
      </details>
    {/each}
    {#if log.limit && log.entries.length >= log.limit}
      <p class="hint">Gezeigt werden nur die neuesten {log.limit} Einträge.</p>
    {/if}
  </section>
{:else if !error}
  <p class="hint">Das Log wird geladen.</p>
{/if}

<style>
  .log {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
  }
  .log-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .log-head label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-dim);
  }
  details {
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
  summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    cursor: pointer;
    font-size: 13px;
  }
  /* display: flex nimmt dem summary das Dreieck */
  summary::before {
    content: '▸';
    color: var(--text-dim);
  }
  details[open] > summary::before {
    content: '▾';
  }
  ol {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    font-size: 12px;
  }
  li {
    display: grid;
    grid-template-columns: max-content 64px 1fr;
    gap: 10px;
    padding: 3px 0;
  }
  li time {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  li .text {
    overflow-wrap: anywhere;
  }
  li.good .level {
    color: var(--good-text);
  }
  li.warn .level {
    color: var(--warn-text);
  }
  li.bad .level {
    color: var(--danger-text);
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
  @media (max-width: 720px) {
    li {
      grid-template-columns: max-content 1fr;
    }
    li .text {
      grid-column: 1 / -1;
    }
  }
</style>
