<script lang="ts">
  import { ChartNoAxesCombined, ClipboardList, X } from 'lucide-svelte';
  import { focusTrap } from '../lib/focus';
  import { app } from '../lib/state.svelte';
  import IncidentRecordsModal from './IncidentRecordsModal.svelte';
  import StatisticsModal from './StatisticsModal.svelte';

  type OverviewTab = 'records' | 'statistics';
  let activeTab = $state<OverviewTab>('records');
  let recordsTab: HTMLButtonElement;
  let statisticsTab: HTMLButtonElement;

  function close(): void {
    app.sessionOverviewOpen = false;
  }

  function selectTab(tab: OverviewTab): void {
    activeTab = tab;
    (tab === 'records' ? recordsTab : statisticsTab)?.focus();
  }

  function onTabKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    selectTab(activeTab === 'records' ? 'statistics' : 'records');
  }
</script>

<div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && close()} onkeydown={(event) => event.key === 'Escape' && close()} use:focusTrap={{ initial: '[data-autofocus]' }} tabindex="-1">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="overview-title">
    <header>
      <ClipboardList size={18} />
      <h2 id="overview-title">Sitzungsübersicht</h2>
      <button class="ghost close" data-autofocus data-tooltip="Schließen" aria-label="Schließen" onclick={close}><X size={18} /></button>
    </header>

    <div class="tabs" role="tablist" aria-label="Sitzungsübersicht">
      <button bind:this={recordsTab} class="tab" class:active={activeTab === 'records'} role="tab" aria-selected={activeTab === 'records'} aria-controls="overview-records" tabindex={activeTab === 'records' ? 0 : -1} onkeydown={onTabKeydown} onclick={() => selectTab('records')}>
        <ClipboardList size={15} /> Einsatzakte
      </button>
      <button bind:this={statisticsTab} class="tab" class:active={activeTab === 'statistics'} role="tab" aria-selected={activeTab === 'statistics'} aria-controls="overview-statistics" tabindex={activeTab === 'statistics' ? 0 : -1} onkeydown={onTabKeydown} onclick={() => selectTab('statistics')}>
        <ChartNoAxesCombined size={15} /> Statistik
      </button>
    </div>

    <div id="overview-records" class="tab-panel" role="tabpanel" aria-label="Einsatzakte" hidden={activeTab !== 'records'}>
      <IncidentRecordsModal embedded onClose={close} />
    </div>
    <div id="overview-statistics" class="tab-panel" role="tabpanel" aria-label="Statistik" hidden={activeTab !== 'statistics'}>
      <StatisticsModal embedded onClose={close} />
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 20px; background: rgba(4, 6, 10, 0.72); }
  .modal { width: min(1180px, 97vw); height: min(860px, 94vh); display: flex; flex-direction: column; overflow: hidden; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow); }
  header { display: flex; align-items: center; gap: 10px; padding: 11px 15px; background: var(--panel-header); }
  header > :global(svg) { color: var(--text-dim); }
  h2 { margin: 0; flex: 1; font-size: 15px; }
  .tabs { display: flex; gap: 22px; padding: 0 15px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--panel-header); }
  .tab { position: relative; min-width: 118px; justify-content: center; padding: 10px 2px 9px; border: 0; border-radius: 0; background: transparent; color: var(--text-dim); }
  .tab:hover:not(:disabled) { border-color: transparent; background: transparent; color: var(--text); }
  .tab.active { color: var(--text); }
  .tab.active::after { content: ''; position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; background: var(--accent-outline); }
  .tab-panel { min-height: 0; flex: 1; }
  .tab-panel[hidden] { display: none; }
  @media (max-width: 760px) { .backdrop { padding: 7px; } }
</style>
