<script lang="ts">
  // Laufband unter der Kopfzeile des Alarmmonitors. Der Text kommt fertig
  // aus tickerText(). Eine Einheit ("+++ A +++ B ") wird so oft wiederholt,
  // dass die Spur die Breite plus eine Einheit füllt; die Animation schiebt
  // genau eine Einheit nach links und springt dann zurück, ohne sichtbaren Sprung.
  let { text }: { text: string } = $props();

  const SPEED_PX_PER_SECOND = 110;

  // Ohne den Schluss-Trenner, den liefert die nächste Kopie.
  const unit = $derived(`${text.replace(/\s*\+\+\+\s*$/, '')} `);
  let containerWidth = $state(0);
  let unitWidth = $state(0);
  const copies = $derived(unitWidth > 0 && containerWidth > 0 ? Math.ceil(containerWidth / unitWidth) + 1 : 2);
  const duration = $derived(unitWidth > 0 ? Math.max(4, unitWidth / SPEED_PX_PER_SECOND) : 12);
</script>

<!-- Bleibt als Rasterzeile im Monitor; ohne Text mit Höhe 0, nicht display:none,
     sonst rutschen Inhalt und Fußzeile in die falschen Zeilen. -->
<div
  class="ticker"
  class:empty={!text}
  role="status"
  aria-live="polite"
  aria-label="Lagemeldungen"
  aria-hidden={!text}
  bind:clientWidth={containerWidth}
>
  {#if text}
    <div class="track" style={`--ticker-shift: ${-unitWidth}px; --ticker-duration: ${duration}s`}>
      {#each Array.from({ length: copies }, (_, index) => index) as index (index)}
        {#if index === 0}
          <span bind:clientWidth={unitWidth}>{unit}</span>
        {:else}
          <span aria-hidden="true">{unit}</span>
        {/if}
      {/each}
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
  .ticker.empty {
    height: 0;
    border-bottom: 0;
  }
  .track {
    display: flex;
    width: max-content;
    animation: ticker var(--ticker-duration) linear infinite;
    will-change: transform;
  }
  .track span {
    display: inline-block;
    flex: 0 0 auto;
    padding: 6px 0;
    white-space: pre;
  }
  @keyframes ticker {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(var(--ticker-shift));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .track {
      animation: none;
    }
    .track span:not(:first-child) {
      display: none;
    }
  }
</style>
