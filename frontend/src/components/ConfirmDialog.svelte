<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { CircleAlert } from '../lib/fontawesome-icons';
  import { focusTrap } from '../lib/focus';
  import { answerConfirm, app } from '../lib/state.svelte';

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') answerConfirm(false);
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && answerConfirm(false)} onkeydown={onKeydown} use:focusTrap={{ initial: '[data-autofocus]' }} tabindex="-1">
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-message">
    <span class="icon"><FaIcon icon={CircleAlert} size={20} /></span>
    <p id="confirm-message">{app.confirmDialog?.message}</p>
    <div class="buttons">
      <button data-autofocus onclick={() => answerConfirm(false)}>Abbrechen</button>
      <button class="primary" onclick={() => answerConfirm(true)}>Bestätigen</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 6, 10, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 90;
  }

  .dialog {
    width: min(360px, 90vw);
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    text-align: center;
  }

  .icon {
    color: var(--warn);
    display: inline-flex;
  }

  p {
    margin: 0;
    line-height: 1.4;
  }

  .buttons {
    display: flex;
    gap: 8px;
  }
</style>
