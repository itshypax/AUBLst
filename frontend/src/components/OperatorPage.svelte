<script lang="ts">
  import { onMount } from 'svelte';
  import {
    fetchMetricsSummary,
    fetchSessionLog,
    formatDay,
    formatLogTime,
    formatMetric,
    groupSessionLog,
    loadOperatorKey,
    LOG_LEVEL_LABELS,
    metricSeries,
    OperatorKeyError,
    saveOperatorKey,
    type LogLevel,
    type MetricName,
    type MetricsSummary,
    type SessionLogEntry,
  } from '../lib/operator';

  let key = $state(loadOperatorKey());
  let input = $state('');
  let summary = $state<MetricsSummary | null>(null);
  let error = $state('');
  let loading = $state(false);
  let log = $state<{ entries: SessionLogEntry[]; limit: number } | null>(null);
  let logError = $state('');
  let level = $state<LogLevel | ''>('');
  const groups = $derived(log ? groupSessionLog(log.entries, level) : []);

  async function load(): Promise<void> {
    if (!key) return;
    loading = true;
    error = '';
    try {
      summary = await fetchMetricsSummary(key);
      saveOperatorKey(key);
      // Erst nach geprüftem Schlüssel, sonst zählt ein Tippfehler doppelt als Fehlversuch.
      try {
        log = await fetchSessionLog(key);
        logError = '';
      } catch (cause) {
        logError = (cause as Error).message;
      }
    } catch (cause) {
      error = (cause as Error).message;
      if (cause instanceof OperatorKeyError) {
        key = '';
        saveOperatorKey('');
        summary = null;
        log = null;
      }
    } finally {
      loading = false;
    }
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    key = input.trim();
    input = '';
    void load();
  }

  function forget(): void {
    key = '';
    saveOperatorKey('');
    summary = null;
    log = null;
  }

  onMount(() => {
    void load();
  });

  const charts = $derived(
    summary
      ? [
          { name: 'events_created' as MetricName, title: 'Angelegte Einsätze je Tag', series: metricSeries(summary.days, 'events_created', 'sum') },
          { name: 'active_events' as MetricName, title: 'Sichtbare Einsätze, Tageshöchstwert', series: metricSeries(summary.days, 'active_events', 'max') },
          { name: 'state_load_ms' as MetricName, title: 'Ladezeit des Zustands, Tagesmittel', series: metricSeries(summary.days, 'state_load_ms', 'average') },
        ]
      : [],
  );

  function barHeight(value: number, series: { value: number }[]): number {
    const peak = Math.max(0, ...series.map((point) => point.value));
    return peak > 0 ? Math.max(2, Math.round((value / peak) * 100)) : 0;
  }
</script>

<main class="operator">
  <header>
    <h1>Betreiberansicht</h1>
    {#if key}
      <button class="ghost" onclick={forget}>Schlüssel vergessen</button>
    {/if}
  </header>

  {#if !key}
    <form class="key-form" onsubmit={submit}>
      <label>
        <span>Betreiber-Schlüssel</span>
        <input type="password" bind:value={input} autocomplete="off" spellcheck="false" />
      </label>
      <button type="submit" class="primary" disabled={!input.trim()}>Anzeigen</button>
      <p>Der Schlüssel steht in der Backend-Konfiguration als OPERATOR_KEY. Er wird nur für diesen Tab gemerkt.</p>
    </form>
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if loading}<p class="hint">Messwerte werden geladen.</p>{/if}

  {#if summary}
    {#if !summary.enabled}
      <p class="hint">Die Sammlung ist abgeschaltet (ENABLE_ANONYMOUS_METRICS=false). Angezeigt werden nur ältere Tage.</p>
    {/if}
    {#if !summary.days.length}
      <p class="hint">Für die letzten {summary.daysBack} Tage liegen keine Messwerte vor.</p>
    {:else}
      <div class="charts">
        {#each charts as chart (chart.name)}
          <section>
            <h2>{chart.title}</h2>
            <div class="bars" role="img" aria-label={chart.title}>
              {#each chart.series as point (point.day)}
                <span
                  class="bar"
                  style={`height: ${barHeight(point.value, chart.series)}%`}
                  title={`${formatDay(point.day)} ${formatMetric(chart.name, point.value)}`}
                ></span>
              {/each}
            </div>
            <div class="axis"><span>{formatDay(chart.series[0].day)}</span><span>{formatDay(chart.series[chart.series.length - 1].day)}</span></div>
          </section>
        {/each}
      </div>

      <table>
        <thead>
          <tr>
            <th>Tag</th>
            <th>Angelegte Einsätze</th>
            <th>Sichtbare Einsätze, Mittel</th>
            <th>Sichtbare Einsätze, Maximum</th>
            <th>Ladezeit, Mittel</th>
            <th>Ladezeit, Maximum</th>
            <th>Zustandsabrufe</th>
          </tr>
        </thead>
        <tbody>
          {#each summary.days as entry (entry.day)}
            <tr>
              <td>{formatDay(entry.day)}</td>
              <td>{formatMetric('events_created', entry.metrics.events_created?.sum)}</td>
              <td>{formatMetric('active_events', entry.metrics.active_events?.average)}</td>
              <td>{formatMetric('active_events', entry.metrics.active_events?.max)}</td>
              <td>{formatMetric('state_load_ms', entry.metrics.state_load_ms?.average)}</td>
              <td>{formatMetric('state_load_ms', entry.metrics.state_load_ms?.max)}</td>
              <td>{entry.metrics.state_load_ms?.count ?? '–'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}

  {#if logError}<p class="error">Adapter-Log: {logError}</p>{/if}
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
  {/if}
</main>

<style>
  .operator {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h1 {
    margin: 0;
    font-size: 18px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .key-form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
    max-width: 480px;
  }
  .key-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 220px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .key-form p {
    flex-basis: 100%;
    margin: 0;
    font-size: 12px;
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
  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }
  section {
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 56px;
    border-bottom: 1px solid var(--border);
  }
  .bar {
    flex: 1 1 0;
    min-width: 2px;
    border-radius: 2px 2px 0 0;
    background: var(--border-strong);
  }
  .bar:hover {
    background: var(--text-dim);
  }
  .axis {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-dim);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    padding: 6px 10px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  th {
    font-weight: 600;
    color: var(--text-dim);
  }
  td:not(:first-child),
  th:not(:first-child) {
    text-align: right;
  }
  .log {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .log-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .log-head h2 {
    margin: 0;
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
  @media (max-width: 720px) {
    li {
      grid-template-columns: max-content 1fr;
    }
    li .text {
      grid-column: 1 / -1;
    }
    table {
      display: block;
      overflow-x: auto;
    }
  }
</style>
