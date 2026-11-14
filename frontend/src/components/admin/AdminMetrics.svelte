<script lang="ts">
  import { fetchMetricsSummary, formatDay, formatMetric, metricSeries, type MetricName, type MetricsSummary } from '../../lib/admin';

  const { key }: { key: string } = $props();

  let summary = $state<MetricsSummary | null>(null);
  let error = $state('');

  $effect(() => {
    void load(key);
  });

  async function load(current: string): Promise<void> {
    try {
      summary = await fetchMetricsSummary(current);
      error = '';
    } catch (cause) {
      error = (cause as Error).message;
    }
  }

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

{#if error}<p class="error" role="alert">{error}</p>{/if}

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

    <section class="sheet">
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
    </section>
  {/if}
{:else if !error}
  <p class="hint">Messwerte werden geladen.</p>
{/if}

<style>
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
  .sheet {
    overflow-x: auto;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
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
