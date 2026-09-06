<script lang="ts">
  // Laufband unter der Kopfzeile des Alarmmonitors. Der Text kommt fertig
  // aus tickerText(); hier wird er zweimal hintereinander gesetzt und um die
  // halbe Breite verschoben, damit die Schleife ohne Lücke läuft.
  let { text }: { text: string } = $props();

  // Ohne den Schluss-Trenner, den liefert die nächste Kopie.
  const unit = $derived(`${text.replace(/\s*\+\+\+\s*$/, '')} `);
  const duration = $derived(Math.max(14, Math.round(text.length * 0.18)));
</script>

<!-- Immer im DOM, damit die Rasterzeile des Monitors erhalten bleibt; ohne Text versteckt. -->
<div class="ticker" role="status" aria-live="polite" aria-label="Lagemeldungen" hidden={!text}>
  {#if text}
    <div class="track" style={`--ticker-duration: ${duration}s`}>
      <span>{unit}</span>
      <span aria-hidden="true">{unit}</span>
    </div>
  {/if}
</div>

<style>
  .ticker {
    overflow: hidden;
    border-bottom: 1px solid var(--monitor-border, #2a2c30);
    background: #241a1b;
    color: #ffd6d2;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .track {
    display: inline-flex;
    width: max-content;
    animation: ticker var(--ticker-duration) linear infinite;
  }
  .track span {
    display: inline-block;
    padding: 6px 0;
    white-space: pre;
  }
  @keyframes ticker {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-50%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .track {
      animation: none;
    }
    .track span:last-child {
      display: none;
    }
  }
</style>
