<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { CircleAlert, CircleCheck, X } from '../lib/fontawesome-icons';
  import { app, closeNotice, type Notice } from '../lib/state.svelte';

  function title(notice: Notice): string {
    if (notice.kind === 'error') return 'Aktion fehlgeschlagen';
    if (/Fahrzeug(?:e)? alarmiert/.test(notice.message)) return 'Alarmierung gesendet';
    return 'Erledigt';
  }
</script>

{#if app.notices.length}
  <div class="notices">
    {#each app.notices as notice (notice.id)}
      <div
        class="notice {notice.kind}"
        role={notice.kind === 'error' ? 'alert' : 'status'}
        aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}
      >
        <span class="icon"><FaIcon icon={notice.kind === 'error' ? CircleAlert : CircleCheck} size={18} /></span>
        <div><strong>{title(notice)}</strong><span>{notice.message}</span></div>
        <button class="ghost close" aria-label="Meldung schließen" onclick={() => closeNotice(notice.id)}
          ><FaIcon icon={X} size={13} /></button
        >
        <span class="timer" aria-hidden="true"></span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .notices {
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(390px, calc(100vw - 28px));
  }
  .notice {
    position: relative;
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) 26px;
    gap: 8px;
    align-items: start;
    overflow: hidden;
    padding: 11px 10px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--panel-header);
    box-shadow: var(--shadow);
  }
  .icon {
    display: inline-flex;
    padding-top: 1px;
    color: var(--good-text);
  }
  .notice.error .icon {
    color: var(--danger-text);
  }
  .notice > div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
  }
  strong {
    font-size: 12px;
  }
  div > span {
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .close {
    width: 26px;
    height: 26px;
    padding: 0;
    justify-content: center;
    border: 0;
  }
  .timer {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 2px;
    transform-origin: left;
    background: var(--good);
    animation: timeout 4.2s linear forwards;
  }
  .error .timer {
    background: var(--danger);
  }
  @keyframes timeout {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }
  @media (max-width: 620px) {
    .notice {
      right: 8px;
      bottom: 8px;
      width: calc(100vw - 16px);
    }
  }
</style>
