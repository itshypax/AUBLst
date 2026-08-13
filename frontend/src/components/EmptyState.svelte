<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { Inbox, SearchX } from '../lib/fontawesome-icons';

  let {
    title,
    description = '',
    compact = false,
    search = false,
    actionLabel = '',
    onAction = () => {},
  }: {
    title: string;
    description?: string;
    compact?: boolean;
    search?: boolean;
    actionLabel?: string;
    onAction?: () => void;
  } = $props();
</script>

<div class="empty-state" class:compact role="status">
  {#if search}<FaIcon icon={SearchX} size={compact ? 18 : 22} aria-hidden="true" />{:else}<FaIcon icon={Inbox} size={compact ? 18 : 22} aria-hidden="true" />{/if}
  <strong>{title}</strong>
  {#if description}<span>{description}</span>{/if}
  {#if actionLabel}<button onclick={onAction}>{actionLabel}</button>{/if}
</div>

<style>
  .empty-state { min-height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 20px; color: var(--text-dim); text-align: center; }
  .empty-state.compact { min-height: 88px; padding: 14px 10px; }
  .empty-state :global(svg) { color: #71757d; }
  strong { color: var(--text); font-size: 13px; }
  span { max-width: 360px; font-size: 11px; line-height: 1.45; }
  button { margin-top: 3px; }
</style>
