<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { CornerDownLeft, Keyboard, Search, X } from '../lib/fontawesome-icons';
  import { focusTrap } from '../lib/focus';
  import { SHORTCUTS, type ShortcutAction, type ShortcutDefinition } from '../lib/keyboard-shortcuts';
  import { app } from '../lib/state.svelte';
  import EmptyState from './EmptyState.svelte';

  let { onAction }: { onAction: (action: ShortcutAction) => void } = $props();

  const groups = ['Navigation', 'Leitstelle'] as const;
  let query = $state('');
  let activeIndex = $state(0);
  const filtered = $derived(SHORTCUTS.filter((shortcut) => {
    const term = query.trim().toLocaleLowerCase('de');
    return !term || `${shortcut.label} ${shortcut.group} ${shortcut.keys.join(' ')}`.toLocaleLowerCase('de').includes(term);
  }));

  $effect(() => {
    void query;
    activeIndex = 0;
  });

  function close(): void {
    app.shortcutsOpen = false;
  }

  function run(shortcut: ShortcutDefinition): void {
    onAction(shortcut.action);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'F1') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = filtered.length ? (activeIndex + direction + filtered.length) % filtered.length : 0;
      requestAnimationFrame(() => document.getElementById(`shortcut-command-${activeIndex}`)?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    if (event.key === 'Enter' && filtered[activeIndex]) {
      event.preventDefault();
      run(filtered[activeIndex]);
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && close()} onkeydown={onKeydown} use:focusTrap={{ initial: '[data-autofocus]' }} tabindex="-1">
  <div class="command-panel" role="dialog" aria-modal="true" aria-labelledby="shortcut-title">
    <header>
      <FaIcon icon={Keyboard} size={17} aria-hidden="true" />
      <h2 id="shortcut-title">Befehl oder Tastaturkürzel</h2>
      <button class="ghost" aria-label="Übersicht schließen" data-tooltip="Schließen" onclick={close}><FaIcon icon={X} size={17} /></button>
    </header>

    <label class="command-search">
      <FaIcon icon={Search} size={17} aria-hidden="true" />
      <span class="sr-only">Befehl suchen</span>
      <input
        data-autofocus
        type="text"
        bind:value={query}
        placeholder="Arbeitsansicht, Karte oder Aktion suchen …"
        autocomplete="off"
        aria-controls="shortcut-results"
        aria-activedescendant={filtered[activeIndex] ? `shortcut-command-${activeIndex}` : undefined}
      />
      {#if query}<button class="ghost clear" aria-label="Suche leeren" onclick={() => (query = '')}><FaIcon icon={X} size={14} /></button>{/if}
    </label>

    <div id="shortcut-results" class="command-results" aria-live="polite">
      {#each groups as group}
        {@const matches = filtered.filter((shortcut) => shortcut.group === group)}
        {#if matches.length}
          <section aria-labelledby={`shortcut-group-${group}`}>
            <h3 id={`shortcut-group-${group}`}>{group}</h3>
            {#each matches as shortcut (shortcut.action)}
              {@const index = filtered.indexOf(shortcut)}
              <button
                id={`shortcut-command-${index}`}
                class="command-row"
                class:active={index === activeIndex}
                onclick={() => run(shortcut)}
                onmouseover={() => (activeIndex = index)}
                onfocus={() => (activeIndex = index)}
              >
                <span>{shortcut.label}</span>
                <span class="keys" aria-label={shortcut.keys.join(' oder ')}>
                  {#each shortcut.keys as key (key)}<kbd>{key}</kbd>{/each}
                </span>
              </button>
            {/each}
          </section>
        {/if}
      {/each}
      {#if !filtered.length}
        <EmptyState compact search title="Kein passender Befehl" description="Versuche es mit Karte, Fahrzeug, Einsatz oder Arbeitsansicht." />
      {/if}
    </div>

    <footer>
      <span><kbd>↑</kbd><kbd>↓</kbd> auswählen</span>
      <span><FaIcon icon={CornerDownLeft} size={12} /> ausführen</span>
      <span><kbd>Esc</kbd> schließen</span>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: start center; padding: min(16vh, 120px) 20px 20px; background: rgba(4, 6, 10, .68); }
  .command-panel { width: min(640px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 60px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--panel); box-shadow: var(--shadow); }
  header { display: grid; grid-template-columns: 20px minmax(0, 1fr) 30px; align-items: center; gap: 9px; min-height: 46px; padding: 8px 10px 8px 15px; border-bottom: 1px solid var(--border); background: var(--panel-header); }
  header > :global(svg) { color: var(--text-dim); }
  h2 { margin: 0; font-size: 14px; }
  h3 { margin: 0; padding: 8px 12px 5px; color: var(--text-dim); font-size: 10px; font-weight: 650; text-transform: uppercase; letter-spacing: .07em; }
  .command-search { display: flex; align-items: center; gap: 8px; padding: 7px 10px 7px 14px; border-bottom: 1px solid var(--border); color: var(--text-dim); }
  .command-search input { min-width: 0; width: 100%; padding: 8px 0; border: 0; background: transparent; box-shadow: none; font-size: 14px; }
  .clear { flex: 0 0 auto; }
  .command-results { min-height: 120px; overflow: auto; padding: 5px; }
  section + section { margin-top: 4px; border-top: 1px solid var(--border); }
  .command-row { width: 100%; min-height: 39px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 16px; padding: 6px 9px; border-color: transparent; background: transparent; text-align: left; }
  .command-row:hover, .command-row.active { border-color: var(--border); background: var(--accent-soft); }
  .keys { display: flex; justify-content: flex-end; gap: 4px; }
  kbd { min-width: 25px; padding: 2px 6px; border: 1px solid var(--border-strong); border-bottom-color: #555960; border-radius: var(--radius-sm); background: var(--bg-raised); color: var(--text); font: 11px ui-monospace, 'Cascadia Mono', Consolas, monospace; text-align: center; }
  footer { display: flex; align-items: center; gap: 16px; padding: 8px 11px; border-top: 1px solid var(--border); color: var(--text-dim); font-size: 10px; }
  footer span { display: inline-flex; align-items: center; gap: 4px; }
  footer span:last-child { margin-left: auto; }
  footer kbd { min-width: 20px; padding: 1px 4px; font-size: 9px; }
  @media (max-width: 520px) { .backdrop { padding: 10px; place-items: center; } .command-panel { width: 100%; max-height: calc(100vh - 20px); } footer span:nth-child(2) { display: none; } }
</style>
