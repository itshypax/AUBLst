<script lang="ts">
  import { onMount } from 'svelte';
  import { worldToCanvas } from '../lib/mapview';
  import { app } from '../lib/state.svelte';
  import type { EventItem, ReplayPosition } from '../lib/types';

  let { event, positions }: { event: EventItem; positions: ReplayPosition[] } = $props();

  let host = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let mapImage = $state<HTMLImageElement>();
  let frame = $state(0);
  let playing = $state(false);
  let timer = 0;
  let observer: ResizeObserver | null = null;

  const times = $derived([...new Set(positions.map((position) => position.recorded_at))]);
  const currentTime = $derived(times[Math.min(frame, Math.max(0, times.length - 1))] ?? '');

  function timestamp(value: string): number {
    return new Date(value.replace(' ', 'T')).getTime();
  }

  function draw(): void {
    if (!host || !canvas) return;
    const bounds = host.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    const view = {
      width,
      height,
      natural: { w: mapImage?.naturalWidth || width, h: mapImage?.naturalHeight || height },
      contentRect: app.mapContentRect,
      zoom: 1,
      pan: { x: 0, y: 0 },
    };
    const visible = positions.filter(
      (position) => !currentTime || timestamp(position.recorded_at) <= timestamp(currentTime),
    );
    const byVehicle = new Map<number, ReplayPosition[]>();
    for (const position of visible) {
      const rows = byVehicle.get(position.vehicle_id) ?? [];
      rows.push(position);
      byVehicle.set(position.vehicle_id, rows);
    }

    context.lineWidth = 2;
    context.strokeStyle = 'rgba(255,255,255,.7)';
    for (const rows of byVehicle.values()) {
      if (rows.length < 2) continue;
      context.beginPath();
      rows.forEach((position, index) => {
        const point = worldToCanvas(position, app.mapBounds, view);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.stroke();
    }

    const incident = worldToCanvas(event, app.mapBounds, view);
    context.fillStyle = '#e8524a';
    context.beginPath();
    context.arc(incident.x, incident.y, 6, 0, Math.PI * 2);
    context.fill();

    context.font = '600 11px system-ui';
    for (const rows of byVehicle.values()) {
      const latest = rows.at(-1);
      if (!latest) continue;
      const point = worldToCanvas(latest, app.mapBounds, view);
      context.fillStyle = '#f2f3f5';
      context.fillRect(point.x - 4, point.y - 4, 8, 8);
      context.fillStyle = 'rgba(14,15,17,.9)';
      const label = latest.vehicle_name || latest.game_vehicle_id;
      const labelWidth = context.measureText(label).width + 8;
      context.fillRect(point.x + 7, point.y - 10, labelWidth, 18);
      context.fillStyle = '#f2f3f5';
      context.fillText(label, point.x + 11, point.y + 3);
    }
  }

  function toggle(): void {
    if (!times.length) return;
    if (frame >= times.length - 1) frame = 0;
    playing = !playing;
  }

  $effect(() => {
    void positions;
    void currentTime;
    void app.mapBounds;
    void app.mapContentRect;
    requestAnimationFrame(draw);
  });

  $effect(() => {
    clearInterval(timer);
    if (!playing) return;
    timer = window.setInterval(() => {
      if (frame >= times.length - 1) {
        playing = false;
        return;
      }
      frame += 1;
    }, 750);
    return () => clearInterval(timer);
  });

  onMount(() => {
    observer = new ResizeObserver(draw);
    if (host) observer.observe(host);
    return () => {
      observer?.disconnect();
      clearInterval(timer);
    };
  });
</script>

<div class="replay">
  <div class="map" bind:this={host}>
    {#if app.mapImageUrl}
      <img bind:this={mapImage} src={app.mapImageUrl} alt="" onload={draw} />
      <canvas bind:this={canvas}></canvas>
    {:else}
      <div class="empty">Kartenbild nicht verfügbar</div>
    {/if}
    {#if !positions.length}<div class="empty">Für diesen Einsatz sind noch keine Fahrspuren gespeichert.</div>{/if}
  </div>
  <div class="controls">
    <button type="button" disabled={!times.length} onclick={toggle}>{playing ? 'Pause' : 'Abspielen'}</button>
    <input
      type="range"
      min="0"
      max={Math.max(0, times.length - 1)}
      step="1"
      bind:value={frame}
      disabled={!times.length}
      aria-label="Zeitpunkt der Einsatzwiedergabe"
    />
    <time>{currentTime ? new Date(currentTime.replace(' ', 'T')).toLocaleString('de-DE') : 'Keine Aufzeichnung'}</time>
  </div>
</div>

<style>
  .replay {
    border: 1px solid var(--border);
    background: var(--bg-raised);
  }
  .map {
    position: relative;
    min-height: 360px;
    overflow: hidden;
    background: #0e0f11;
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0.82;
  }
  canvas {
    position: absolute;
    inset: 0;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-dim);
    font-size: 12px;
  }
  .controls {
    display: grid;
    grid-template-columns: auto minmax(120px, 1fr) 170px;
    align-items: center;
    gap: 10px;
    padding: 9px;
    border-top: 1px solid var(--border);
  }
  .controls input {
    width: 100%;
  }
  time {
    color: var(--text-dim);
    font-size: 11px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 680px) {
    .map {
      min-height: 250px;
    }
    .controls {
      grid-template-columns: auto 1fr;
    }
    time {
      grid-column: 1 / -1;
      text-align: left;
    }
  }
</style>
