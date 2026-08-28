<script lang="ts">
  import { statusCode, statusDisplay, statusLabel } from '../lib/status';

  let { value, status, title }: { value: number | string; status?: number | string; title?: string } = $props();

  const cls = $derived.by(() => {
    const code = statusCode(status ?? value);
    return code === null ? 'status-unknown' : `status-${code}`;
  });

  const display = $derived(statusDisplay(value));
  const accessibleTitle = $derived(title ?? statusLabel(status ?? value));
</script>

<span class="status-badge {cls}" data-tooltip={accessibleTitle} aria-label={accessibleTitle}>{display}</span>
