<script lang="ts">
  import { statusClass, statusDisplay, statusLabel } from '../lib/status';

  let {
    value,
    status,
    title,
    alarmFrom = null,
    called = false,
  }: { value: number | string; status?: number | string; title?: string; alarmFrom?: number | null; called?: boolean } = $props();

  const cls = $derived(statusClass(status ?? value, called));

  const display = $derived(statusDisplay(value, { alarmFrom, called }));
  const accessibleTitle = $derived(title ?? statusLabel(status ?? value, { called }));
</script>

<span class="status-badge {cls}" data-tooltip={accessibleTitle} aria-label={accessibleTitle}>{display}</span>
