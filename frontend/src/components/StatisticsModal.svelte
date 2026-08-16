<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { ChartNoAxesCombined, Download, RefreshCw, X } from '../lib/fontawesome-icons';
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import { focusTrap } from '../lib/focus';
  import { buildSessionStatistics, exportSessionStatisticsPng, formatStatisticDuration, type SessionStatisticsModel, type StatisticValue } from '../lib/statistics';
  import type { SessionStatisticsResponse } from '../lib/types';
  import { app } from '../lib/state.svelte';
  import IncidentHeatmap from './IncidentHeatmap.svelte';

  let { embedded = false, onClose = () => {} }: { embedded?: boolean; onClose?: () => void } = $props();

  let model = $state<SessionStatisticsModel | null>(null);
  let loading = $state(true);
  let exporting = $state(false);
  let error = $state('');

  const timelineMax = $derived(Math.max(1, ...(model?.timeline.map((item) => item.value) ?? [1])));

  function close(): void {
    if (!exporting) onClose();
  }

  function percent(item: StatisticValue, items: StatisticValue[]): number {
    return item.value / Math.max(1, ...items.map((entry) => entry.value)) * 100;
  }

  async function load(): Promise<void> {
    loading = true;
    error = '';
    try {
      const response = await api<SessionStatisticsResponse>('session_statistics');
      model = buildSessionStatistics(response);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function exportPng(): Promise<void> {
    if (!model || exporting) return;
    exporting = true;
    error = '';
    try {
      await exportSessionStatisticsPng(model);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      exporting = false;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }

  onMount(() => void load());
</script>

<div class="backdrop" class:embedded role="presentation" onclick={(event) => !embedded && event.target === event.currentTarget && close()} onkeydown={(event) => !embedded && onKeydown(event)} use:focusTrap={{ initial: '[data-autofocus]', disabled: embedded }} tabindex="-1">
  <div class="modal" role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-labelledby={embedded ? undefined : 'statistics-title'} aria-label={embedded ? 'Statistik' : undefined}>
    {#if !embedded}<header>
      <span class="header-icon"><FaIcon icon={ChartNoAxesCombined} size={18} /></span>
      <div>
        <h2 id="statistics-title">Session-Statistik</h2>
        {#if model}
          <span>Sitzung {model.token} · {model.createdAt.toLocaleString('de-DE')} bis {model.generatedAt.toLocaleString('de-DE')}</span>
        {:else}
          <span>Auswertung der aktuellen Sitzung</span>
        {/if}
      </div>
      <button class="ghost close" data-autofocus data-tooltip="Schließen" aria-label="Schließen" disabled={exporting} onclick={close}><FaIcon icon={X} size={18} /></button>
    </header>{/if}

    <div class="content">
      {#if loading}
        <div class="state"><span class="loading-icon"><FaIcon icon={RefreshCw} size={20} /></span> Statistik wird geladen …</div>
      {:else if error && !model}
        <div class="state error" role="alert">{error}</div>
        <button class="retry" onclick={() => void load()}><FaIcon icon={RefreshCw} size={14} /> Erneut laden</button>
      {:else if model}
        <div class="metrics">
          <div><span>Einsätze</span><strong>{model.eventCount}</strong></div>
          <div><span>Abgeschlossen</span><strong>{model.completedCount}</strong></div>
          <div><span>Alarmierungen</span><strong>{model.dispatchCount}</strong></div>
          <div><span>Funkmeldungen</span><strong>{model.logCount}</strong></div>
          <div><span>Ø Einsatzdauer</span><strong>{formatStatisticDuration(model.averageEventDurationMs)}</strong></div>
          <div><span>Spitzenzeit</span><strong>{model.peakLabel}</strong><small>{model.peakCount} Einsätze</small></div>
        </div>

        <div class="charts">
          <section class="chart heatmap-chart">
            <h3>Einsatzschwerpunkte auf der Karte</h3>
            <IncidentHeatmap imageUrl={app.mapImageUrl} points={model.heatmapPoints} bounds={model.mapBounds} />
          </section>

          <section class="chart">
            <h3>Einsätze je Kategorie</h3>
            <div class="bar-list">
              {#each model.categories as item (item.key)}
                <div class="bar-row">
                  <span>{item.label}</span>
                  <span class="bar-track" data-tooltip={`${item.label}: ${item.value} · ${Math.round(item.value / Math.max(1, model.eventCount) * 100)} %`}><span style={`width: ${percent(item, model.categories)}%; background: ${item.color};`}></span></span>
                  <strong>{item.value}</strong>
                </div>
              {/each}
            </div>
          </section>

          <section class="chart timeline-chart">
            <h3>Einsätze im Verlauf</h3>
            <div class="timeline" aria-label="Einsätze im zeitlichen Verlauf">
              {#each model.timeline as item, index (`${index}-${item.label}`)}
                <div class="timeline-column" data-tooltip={`${item.label}: ${item.value} Einsätze`}>
                  <span class="timeline-value">{item.value || ''}</span>
                  <span class="timeline-track"><span style={`height: ${(item.value / timelineMax) * 100}%`}></span></span>
                  <span class="timeline-label">{item.label}</span>
                </div>
              {/each}
            </div>
          </section>

          <section class="chart">
            <h3>Häufig alarmierte Fahrzeuge</h3>
            {#if model.vehicles.length}
              <div class="bar-list compact">
                {#each model.vehicles as item (item.key)}
                  <div class="bar-row">
                    <span>{item.label}</span>
                    <span class="bar-track" data-tooltip={`${item.label}: ${item.value} Alarmierungen`}><span style={`width: ${percent(item, model.vehicles)}%; background: ${item.color};`}></span></span>
                    <strong>{item.value}</strong>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="empty">Noch keine Fahrzeuge alarmiert</div>
            {/if}
          </section>

          <section class="chart">
            <h3>Fahrzeugauslastung</h3>
            {#if model.vehicleUtilization.length}
              <div class="utilization-key" aria-label="Legende Fahrzeugauslastung">
                <span><i class="busy"></i> Im Einsatz</span>
                <span><i class="unavailable"></i> Nicht verfügbar</span>
              </div>
              <div class="bar-list compact">
                {#each model.vehicleUtilization as item (item.key)}
                  <div class="bar-row utilization-row">
                    <span>{item.label}</span>
                    <span class="bar-track utilization-track" data-tooltip={`${item.label}: ${item.value} % im Einsatz, ${item.unavailable} % nicht verfügbar`}>
                      <span style={`width: ${item.value}%; background: ${item.color};`}></span>
                      <span style={`width: ${item.unavailable}%; background: var(--status-6-border);`}></span>
                    </span>
                    <strong>{item.value}% <span>{item.unavailable}%</span></strong>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="empty">Noch keine Einsatzzeiten erfasst</div>
            {/if}
          </section>

          <section class="chart session-chart">
            <h3>Session</h3>
            <div class="session-times">
              <div><span>Dauer</span><strong>{formatStatisticDuration(model.durationMs)}</strong></div>
              <div><span>Spitzenzeit</span><strong>{model.peakLabel} · {model.peakCount}</strong></div>
            </div>
            <div class="split-bars">
              <div>
                <span class="subheading">Bearbeitung</span>
                {#each model.statuses as item (item.key)}
                  <div class="legend-row"><i style={`background: ${item.color}`}></i><span>{item.label}</span><strong>{item.value}</strong></div>
                {/each}
              </div>
              <div>
                <span class="subheading">Herkunft</span>
                {#each model.sources as item (item.key)}
                  <div class="legend-row"><i style={`background: ${item.color}`}></i><span>{item.label}</span><strong>{item.value}</strong></div>
                {/each}
              </div>
            </div>
          </section>
        </div>
      {/if}
    </div>

    <footer>
      {#if error && model}<span class="export-error" role="alert">{error}</span>{/if}
      <span class="export-note">Der PNG-Export enthält die vollständige Übersicht.</span>
      <button disabled={!model || loading || exporting} onclick={() => void exportPng()}><FaIcon icon={Download} size={15} /> {exporting ? 'PNG wird erstellt …' : 'Als PNG exportieren'}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(4, 6, 10, 0.72); }
  .modal { width: min(1120px, 96vw); max-height: min(900px, 94vh); display: flex; flex-direction: column; overflow: hidden; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow); }
  .backdrop.embedded { position: static; inset: auto; width: 100%; height: 100%; padding: 0; background: transparent; }
  .backdrop.embedded .modal { width: 100%; height: 100%; max-height: none; border: 0; border-radius: 0; box-shadow: none; }
  header { display: flex; align-items: center; gap: 10px; padding: 13px 16px; border-bottom: 1px solid var(--border); background: var(--panel-header); }
  .header-icon { display: inline-flex; color: var(--text-dim); }
  header div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
  h2, h3 { margin: 0; }
  h2 { font-size: 15px; }
  header div > span { color: var(--text-dim); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close { margin-left: auto; }
  .content { min-height: 0; padding: 16px; overflow: auto; }
  .state { min-height: 300px; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-dim); }
  .state.error, .export-error { color: var(--danger-text); }
  .loading-icon { display: inline-flex; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .retry { display: flex; margin: -120px auto 120px; }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
  .metrics > div { padding: 12px 14px; border: 1px solid var(--border); background: var(--bg-raised); }
  .metrics span, .session-times span { display: block; margin-bottom: 5px; color: var(--text-dim); font-size: 11px; }
  .metrics strong { font-size: 24px; font-variant-numeric: tabular-nums; }
  .metrics small { display: block; margin-top: 3px; color: var(--text-dim); font-size: 10px; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .chart { min-height: 230px; padding: 13px 14px; border: 1px solid var(--border); background: var(--bg-raised); }
  .chart h3 { margin-bottom: 15px; font-size: 13px; }
  .heatmap-chart { grid-column: 1 / -1; min-height: 0; }
  .bar-list { display: grid; gap: 12px; }
  .bar-list.compact { gap: 7px; }
  .bar-row { display: grid; grid-template-columns: minmax(110px, 145px) minmax(80px, 1fr) 38px; align-items: center; gap: 9px; font-size: 12px; }
  .bar-row > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-row strong { text-align: right; font-variant-numeric: tabular-nums; }
  .utilization-key { display: flex; gap: 14px; margin: -6px 0 11px; color: var(--text-dim); font-size: 10px; }
  .utilization-key span { display: inline-flex; align-items: center; gap: 5px; }
  .utilization-key i { width: 8px; height: 8px; background: #2aa6b7; }
  .utilization-key i.unavailable { background: var(--status-6-border); }
  .utilization-row { grid-template-columns: minmax(110px, 145px) minmax(80px, 1fr) 72px; }
  .utilization-row strong > span { color: var(--text-dim); font-weight: 500; }
  .bar-track { display: block; height: 12px; overflow: hidden; border: 1px solid var(--border); background: #202226; }
  .bar-track > span { display: block; min-width: 0; height: 100%; }
  .utilization-track { display: flex; }
  .timeline { height: 175px; display: flex; align-items: stretch; gap: 7px; }
  .timeline-column { display: grid; grid-template-rows: 18px minmax(0, 1fr) 22px; flex: 1; min-width: 0; text-align: center; }
  .timeline-value { color: var(--text-dim); font-size: 10px; font-variant-numeric: tabular-nums; }
  .timeline-track { display: flex; align-items: flex-end; min-height: 0; background: #202226; border-bottom: 1px solid var(--border-strong); }
  .timeline-track > span { display: block; width: 100%; background: var(--accent); }
  .timeline-label { padding-top: 6px; color: var(--text-dim); font-size: 9px; white-space: nowrap; overflow: hidden; }
  .empty { display: flex; min-height: 150px; align-items: center; justify-content: center; color: var(--text-dim); font-size: 12px; }
  .session-times { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
  .session-times strong { font-size: 15px; }
  .split-bars { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; padding-top: 13px; }
  .subheading { display: block; margin-bottom: 7px; color: var(--text-dim); font-size: 11px; }
  .legend-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 7px; padding: 4px 0; font-size: 12px; }
  .legend-row i { width: 8px; height: 8px; }
  .legend-row strong { font-variant-numeric: tabular-nums; }
  footer { min-height: 54px; display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--border); background: var(--panel-header); }
  .export-note { margin-left: auto; color: var(--text-dim); font-size: 11px; }
  .export-error { font-size: 12px; }
  @media (max-width: 780px) {
    .backdrop { padding: 8px; }
    .metrics { grid-template-columns: 1fr 1fr; }
    .charts { grid-template-columns: 1fr; }
    .export-note { display: none; }
    footer { justify-content: flex-end; }
  }
</style>
