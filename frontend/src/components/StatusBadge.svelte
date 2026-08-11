<script lang="ts">
  import { statusCode, statusDisplay } from '../lib/status';

  let { value, status, title }: { value: number | string; status?: number | string; title?: string } = $props();

  const cls = $derived.by(() => {
    const code = statusCode(status ?? value);
    return code === null ? 'status-unknown' : `status-${code}`;
  });

  const display = $derived(statusDisplay(value));
  const labels: Record<number, string> = {
    0: 'Alarmiert',
    1: 'Einsatzbereit über Funk',
    2: 'Einsatzbereit auf Wache',
    3: 'Einsatz übernommen',
    4: 'An der Einsatzstelle',
    5: 'Sprechwunsch',
    6: 'Nicht einsatzbereit',
    7: 'Patient aufgenommen',
    8: 'Am Transportziel',
    9: 'Sonderstatus',
  };
  const accessibleTitle = $derived(title ?? labels[statusCode(status ?? value) ?? -1] ?? `Status ${value}`);
</script>

<span class="status-badge {cls}" data-tooltip={accessibleTitle} aria-label={accessibleTitle}>{display}</span>
