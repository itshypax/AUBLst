<script lang="ts">
  import { onMount } from 'svelte';
  import FaIcon from './FaIcon.svelte';
  import { CircleAlert, ClipboardList, Clock, KeyRound, Keyboard, LayoutGrid, Play, RefreshCw, Settings, Volume2, VolumeX, Wifi, WifiOff } from '../lib/fontawesome-icons';
  import { pollLogs, refreshState, switchSession } from '../lib/polling';
  import { dismissibleDetails } from '../lib/dismissible-details';
  import { configureSounds, getDefaultSoundProfile, getSoundProfileOptions, loadSoundManifest, testSound } from '../lib/sounds';
  import { app, persistSoundSettings, showNotice } from '../lib/state.svelte';
  import { decodeEntities } from '../lib/text';
  import { userFacingError } from '../lib/user-facing-error';
  import type { LogRow } from '../lib/types';
  import { desktopNotificationsAvailable, setDesktopNotifications } from '../lib/notifications';

  let { onResetLayout, onOpenWorkspaceEditor, onOpenShortcuts = () => (app.shortcutsOpen = true), workspaceName }: { onResetLayout: () => void; onOpenWorkspaceEditor: () => void; onOpenShortcuts?: () => void; workspaceName: string } = $props();

  let tokenInput = $state(app.sessionToken);
  let pinInput = $state(app.pin);
  let details: HTMLDetailsElement;
  let applying = $state(false);
  let soundMessage = $state('');
  let soundProfiles = $state(getSoundProfileOptions());
  const appCommit = import.meta.env.VITE_APP_COMMIT || 'dev';
  const appCommitDate = import.meta.env.VITE_APP_COMMIT_DATE;
  const versionTooltip = appCommitDate
    ? `Commit ${appCommit} vom ${new Date(appCommitDate).toLocaleString('de-DE')}`
    : `Commit ${appCommit}`;

  onMount(() => {
    void loadSoundManifest().then((profiles) => {
      soundProfiles = profiles;
      if (!profiles.some((profile) => profile.id === app.soundProfile)) {
        app.soundProfile = getDefaultSoundProfile();
        persistSoundSettings();
      }
      configureSounds(app.soundEnabled, app.soundVolume, app.soundProfile);
    });
  });

  $effect(() => {
    if (!details?.open && !app.sessionChanging) {
      tokenInput = app.sessionToken;
      pinInput = app.pin;
    }
  });

  async function apply(): Promise<void> {
    applying = true;
    try {
      await switchSession(app.apiBase, tokenInput, pinInput);
      details.open = false;
    } finally {
      applying = false;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') void apply();
  }

  async function updateSound(): Promise<void> {
    configureSounds(app.soundEnabled, app.soundVolume, app.soundProfile);
    persistSoundSettings();
  }

  async function runSoundTest(): Promise<void> {
    configureSounds(true, app.soundVolume, app.soundProfile);
    soundMessage = (await testSound()) ? 'Ton abgespielt' : 'Browser blockiert die Wiedergabe';
    window.setTimeout(() => (soundMessage = ''), 2500);
  }

  async function toggleDesktopNotifications(): Promise<void> {
    const message = await setDesktopNotifications(!app.desktopNotifications);
    const accepted = message.includes('eingeschaltet') || message.includes('ausgeschaltet');
    showNotice(message, accepted ? 'success' : 'error');
  }

  let clockBase = $state<{ minutes: number; realMs: number } | null>(null);
  let msPerGameMinute = $state(0);
  let nowMs = $state(Date.now());

  $effect(() => {
    configureSounds(app.soundEnabled, app.soundVolume, app.soundProfile);
    const timer = setInterval(() => (nowMs = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    const c = app.clock;
    if (!c) return;
    const minutes = Number(c.time_hours) * 60 + Number(c.time_minutes);
    if (clockBase && clockBase.minutes === minutes) return;
    if (clockBase && minutes > clockBase.minutes) {
      msPerGameMinute = (Date.now() - clockBase.realMs) / (minutes - clockBase.minutes);
    }
    clockBase = { minutes, realMs: Date.now() };
  });

  const clockText = $derived.by(() => {
    if (!clockBase) return '--:--';
    let minutes = clockBase.minutes;
    if (msPerGameMinute > 0) minutes += Math.floor((nowMs - clockBase.realMs) / msPerGameMinute);
    minutes = ((minutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  });

  const gameStates = $derived.by(() => {
    const seen = new Map<string, LogRow>();
    for (const row of app.logs) {
      if (row.type === 'global' && row.state === 'active') seen.set(row.message, row);
    }
    return [...seen.values()];
  });

  function gameStateKind(row: LogRow): 'shortage' | 'alarm-level' | 'doctor-alarm' | 'default' {
    const text = `${row.message} ${decodeEntities(row.long_message)}`.toLocaleLowerCase('de-DE');
    if (text.includes('notarztalarm')) return 'doctor-alarm';
    if (text.includes('rettungsmittelknappheit')) return 'shortage';
    if (text.includes('alarmstufe')) return 'alarm-level';
    return 'default';
  }

  const stateIssue = $derived(app.lastError ? userFacingError(app.lastError, 'state') : null);
  const logIssue = $derived(app.logError ? userFacingError(app.logError, 'logs') : null);

  const connection = $derived.by(() => {
    if (app.sessionChanging) return { kind: 'busy', text: 'Sitzung wird gewechselt', title: '' };
    if (!app.sessionToken) return { kind: 'off', text: 'Keine Sitzung', title: 'Sitzung einrichten' };
    if (!app.stateHealthy) {
      if (app.lastSuccessfulSync === null) return { kind: 'error', text: 'Nicht verbunden', title: stateIssue?.message ?? '' };
      const age = app.lastSuccessfulSync ? ` · Stand ${new Date(app.lastSuccessfulSync).toLocaleTimeString('de-DE')}` : '';
      return { kind: 'error', text: `Verbindung unterbrochen${age}`, title: stateIssue?.message ?? '' };
    }
    if (!app.logsHealthy) return { kind: 'warn', text: 'Verbunden · Funk gestört', title: logIssue?.message ?? '' };
    const age = app.lastSuccessfulSync ? Math.max(0, Math.floor((nowMs - app.lastSuccessfulSync) / 1000)) : 0;
    return { kind: age > 10 ? 'warn' : 'ok', text: age > 10 ? `Datenstand vor ${age} s` : 'Verbunden', title: '' };
  });
</script>

<header class="topbar">
  <div class="brand">
    <img class="brand-logo" src="./aublst.png" alt="" />
    <div class="brand-copy">
      <span class="brand-name">AUB<span class="brand-lst">LST</span></span>
      <span class="build-version" data-tooltip={versionTooltip}>{appCommit}</span>
    </div>
  </div>

  <div class="clock" data-tooltip="Spielzeit">
    <FaIcon icon={Clock} size={14} />
    <span>{clockText}</span>
  </div>

  <div class="game-states">
    {#each gameStates as row (row.message)}
      <span class="game-state {gameStateKind(row)}">{decodeEntities(row.long_message)}</span>
    {/each}
  </div>

  <div class="connection {connection.kind}" data-tooltip={connection.title} aria-live="polite">
    {#if connection.kind === 'ok'}<FaIcon icon={Wifi} size={14} />{:else}<FaIcon icon={WifiOff} size={14} />{/if}
    <span>{connection.text}</span>
  </div>

  <button class="ghost icon-button" data-tooltip={`Arbeitsansicht: ${workspaceName}`} aria-label={`Arbeitsansicht ${workspaceName} bearbeiten`} onclick={onOpenWorkspaceEditor}>
    <FaIcon icon={LayoutGrid} size={16} />
  </button>

  <button class="ghost icon-button" data-tooltip="Einsatzakte und Statistik" aria-label="Sitzungsübersicht öffnen" disabled={app.lastSuccessfulSync === null || applying} onclick={() => (app.sessionOverviewOpen = true)}>
    <FaIcon icon={ClipboardList} size={16} />
  </button>

  <button class="ghost icon-button" data-tooltip="Tastaturkürzel (F1)" aria-label="Tastaturkürzel öffnen" onclick={onOpenShortcuts}>
    <FaIcon icon={Keyboard} size={16} />
  </button>

  <details class="settings" bind:this={details} use:dismissibleDetails>
    <summary data-tooltip="Verbindung und Ton einstellen">
      <FaIcon icon={Settings} size={16} />
      <span>{app.sessionToken ? `Sitzung ${app.sessionToken}` : 'Sitzung einrichten'}</span>
    </summary>
      <div class="settings-popover">
      <div class="settings-title">Verbindung</div>
      <div class="field-row">
        <label>
          <span>Sitzung</span>
          <input type="text" bind:value={tokenInput} onkeydown={onKey} placeholder="a1b2" spellcheck="false" />
        </label>
        <label>
          <span><FaIcon icon={KeyRound} size={13} /> PIN</span>
          <input type="password" bind:value={pinInput} onkeydown={onKey} placeholder="optional" autocomplete="off" />
        </label>
      </div>
      <button class="apply" disabled={applying} onclick={() => void apply()}>{applying ? 'Wird verbunden …' : 'Verbinden'}</button>
      <button class="ghost reload-data" disabled={app.lastSuccessfulSync === null || applying} onclick={() => { void refreshState(); void pollLogs(); }}>
        <FaIcon icon={RefreshCw} size={15} /> Daten neu laden
      </button>

      <div class="settings-title sound-title">Ton</div>
      <label class="sound-profile">
        <span>Soundprofil</span>
        <select bind:value={app.soundProfile} onchange={() => void updateSound()}>
          {#each soundProfiles as profile (profile.id)}
            <option value={profile.id}>{profile.label}</option>
          {/each}
        </select>
      </label>
      <div class="sound-row">
        <button class="ghost sound-toggle" aria-pressed={app.soundEnabled} onclick={() => { app.soundEnabled = !app.soundEnabled; void updateSound(); }}>
          {#if app.soundEnabled}<FaIcon icon={Volume2} size={16} /> Ton an{:else}<FaIcon icon={VolumeX} size={16} /> Ton aus{/if}
        </button>
        <label class="volume">
          <span class="sr-only">Lautstärke</span>
          <input type="range" min="0" max="1" step="0.05" bind:value={app.soundVolume} oninput={() => void updateSound()} />
        </label>
        <button class="ghost icon-button" data-tooltip="Alarmton testen" aria-label="Alarmton testen" onclick={() => void runSoundTest()}><FaIcon icon={Play} size={15} /></button>
      </div>
      {#if desktopNotificationsAvailable()}
        <button class="ghost notification-toggle" aria-pressed={app.desktopNotifications} onclick={() => void toggleDesktopNotifications()}>
          Desktop-Meldungen {app.desktopNotifications ? 'an' : 'aus'}
        </button>
      {/if}
      {#if soundMessage}<div class="feedback" aria-live="polite">{soundMessage}</div>{/if}
      {#if stateIssue || logIssue}
        <div class="connection-issues" aria-live="polite">
          {#if stateIssue}
            <div class="connection-alert" role="alert">
              <FaIcon icon={CircleAlert} size={16} />
              <div>
                <strong>{stateIssue.title}</strong>
                <span>{stateIssue.message}</span>
              </div>
            </div>
          {/if}
          {#if logIssue}
            <div class="connection-alert warning" role="alert">
              <FaIcon icon={CircleAlert} size={16} />
              <div>
                <strong>{logIssue.title}</strong>
                <span>{logIssue.message}</span>
              </div>
            </div>
          {/if}
        </div>
      {/if}
      <button class="ghost reset-layout" onclick={() => { onResetLayout(); details.open = false; }}>Panelgrößen zurücksetzen</button>
    </div>
  </details>
</header>

<style>
  .topbar { display: flex; align-items: center; gap: 14px; min-height: 54px; padding: 8px 14px; background: var(--bg-raised); border-bottom: 1px solid var(--border); flex: 0 0 auto; position: relative; z-index: 30; }
  .brand { display: flex; align-items: center; gap: 8px; }
  .brand-logo { width: 26px; height: 26px; border-radius: 4px; }
  .brand-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
  .brand-name { font-size: 17px; font-weight: 700; letter-spacing: 0.03em; line-height: 1; }
  .brand-lst { font-weight: 300; color: var(--text-dim); }
  .build-version { color: var(--text-dim); font-size: 9px; line-height: 1; }
  .clock { display: flex; align-items: center; gap: 6px; padding: 4px 9px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--panel); font-variant-numeric: tabular-nums; font-weight: 600; }
  .clock :global(svg) { color: var(--text-dim); }
  .game-states { display: flex; flex: 1 1 320px; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
  .game-state { font-size: 12px; padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--status-3-border); background: rgba(240, 160, 60, 0.12); color: #ffd9a8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: min(360px, 100%); }
  .game-state.alarm-level { border-color: var(--status-4-border); background: rgba(232, 82, 74, 0.14); color: var(--danger-text); }
  .game-state.doctor-alarm { border-color: var(--status-8-border); background: rgba(103, 65, 165, 0.18); color: #d2bcff; }
  .connection { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim); white-space: nowrap; }
  .connection.ok { color: var(--good-text); }
  .connection.warn { color: var(--warn-text); }
  .connection.error { color: var(--danger-text); }
  .settings { position: relative; }
  summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); background: var(--panel); font-size: 12px; white-space: nowrap; }
  summary::-webkit-details-marker { display: none; }
  summary:hover, summary:focus-visible { border-color: var(--border-strong); background: #1e2023; }
  .settings-popover { position: absolute; top: calc(100% + 8px); right: 0; width: min(360px, calc(100vw - 24px)); padding: 14px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 10px; }
  .settings-title { font-size: 13px; font-weight: 700; }
  .sound-title { padding-top: 10px; border-top: 1px solid var(--border); }
  label { display: flex; flex-direction: column; gap: 4px; color: var(--text-dim); font-size: 12px; }
  label > span { display: inline-flex; align-items: center; gap: 4px; }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .apply { justify-content: center; }
  .reload-data { justify-content: flex-start; }
  .sound-row { display: flex; align-items: center; gap: 8px; }
  .sound-profile select { width: 100%; }
  .sound-toggle { min-width: 74px; }
  .notification-toggle { justify-content: flex-start; }
  .volume { flex: 1; }
  .volume input { width: 100%; }
  .feedback { color: var(--text-dim); font-size: 12px; }
  .connection-issues { display: flex; flex-direction: column; gap: 7px; }
  .connection-alert { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; padding: 9px; border: 1px solid rgba(232, 82, 74, 0.5); border-radius: var(--radius-sm); background: rgba(232, 82, 74, 0.08); color: var(--danger-text); }
  .connection-alert.warning { border-color: rgba(240, 160, 60, 0.5); background: rgba(240, 160, 60, 0.08); color: var(--warn-text); }
  .connection-alert :global(svg) { margin-top: 1px; }
  .connection-alert div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .connection-alert strong { color: var(--text); font-size: 12px; }
  .connection-alert span { color: inherit; font-size: 12px; line-height: 1.4; overflow-wrap: anywhere; }
  .reset-layout { justify-content: flex-start; border-top: 1px solid var(--border); border-radius: 0; padding-top: 10px; }
  .icon-button { width: 30px; height: 30px; padding: 0; justify-content: center; }
  @media (max-width: 1100px) {
    .connection span { display: none; }
    .topbar { flex-wrap: wrap; }
    .game-states { order: 10; flex-basis: 100%; }
    .game-state { max-width: min(280px, 100%); }
  }
  @media (max-width: 760px) {
    .brand-copy, summary span { display: none; }
    .topbar { gap: 8px; }
    .game-states { display: flex; }
    .connection span { display: inline; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
  }
</style>
