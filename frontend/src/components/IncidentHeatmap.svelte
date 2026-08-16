<script lang="ts">
  import { onMount } from 'svelte';
  import { visibleHeatmapPoints } from '../lib/heatmap';
  import type { MapBounds } from '../lib/types';

  let {
    imageUrl,
    points,
    bounds,
  }: {
    imageUrl: string;
    points: Array<{ x: number; y: number }>;
    bounds: MapBounds;
  } = $props();

  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let image = $state<HTMLImageElement>();
  let observer: ResizeObserver | null = null;

  function draw(): void {
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    const natural =
      image?.naturalWidth && image?.naturalHeight
        ? { w: image.naturalWidth, h: image.naturalHeight }
        : { w: width, h: height };
    const visible = visibleHeatmapPoints(points, bounds, {
      width,
      height,
      natural,
      zoom: 1,
      pan: { x: 0, y: 0 },
    });
    const radius = Math.max(16, Math.min(34, width / 18));
    context.globalCompositeOperation = 'lighter';
    for (const point of visible) {
      const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
      gradient.addColorStop(0, 'rgba(255, 245, 170, 0.78)');
      gradient.addColorStop(0.28, 'rgba(240, 160, 60, 0.56)');
      gradient.addColorStop(0.62, 'rgba(232, 82, 74, 0.32)');
      gradient.addColorStop(1, 'rgba(232, 82, 74, 0)');
      context.fillStyle = gradient;
      context.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
    }
    context.globalCompositeOperation = 'source-over';
  }

  $effect(() => {
    void points;
    void bounds;
    if (canvas) requestAnimationFrame(draw);
  });

  onMount(() => {
    observer = new ResizeObserver(draw);
    observer.observe(container);
    draw();
    return () => observer?.disconnect();
  });
</script>

<div
  class="heatmap"
  bind:this={container}
  role="img"
  aria-label={`Heatmap aus ${points.length} Einsätzen auf der Spielkarte`}
>
  {#if imageUrl}
    <img bind:this={image} src={imageUrl} alt="" onload={draw} />
  {:else}
    <div class="map-missing">Kartenbild nicht verfügbar</div>
  {/if}
  <canvas bind:this={canvas}></canvas>
  {#if !points.length}<div class="empty">Noch keine Einsatzorte erfasst</div>{/if}
  <div class="scale" aria-hidden="true"><span>wenige</span><i></i><span>viele</span></div>
</div>

<style>
  .heatmap {
    position: relative;
    min-height: 310px;
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
  .empty,
  .map-missing {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-dim);
    font-size: 12px;
  }
  .scale {
    position: absolute;
    right: 9px;
    bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    background: rgba(14, 15, 17, 0.82);
    color: var(--text-dim);
    font-size: 9px;
  }
  .scale i {
    width: 70px;
    height: 6px;
    background: linear-gradient(90deg, rgba(232, 82, 74, 0.18), #f0a03c, #fff5aa);
  }
  @media (max-width: 620px) {
    .heatmap {
      min-height: 230px;
    }
  }
</style>
