<script lang="ts">
  import { onMount } from 'svelte';
  import { Crosshair, Minus, Plus } from '../lib/fontawesome-icons';
  import { visibleHeatmapPoints } from '../lib/heatmap';
  import type { MapBounds } from '../lib/types';
  import FaIcon from './FaIcon.svelte';

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;

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
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let panning = $state(false);
  let lastPointer = { x: 0, y: 0 };

  function size(): { width: number; height: number } {
    const rect = container?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }

  function clampedPan(next: { x: number; y: number }, atZoom = zoom): { x: number; y: number } {
    const { width, height } = size();
    return {
      x: Math.min(0, Math.max(width * (1 - atZoom), next.x)),
      y: Math.min(0, Math.max(height * (1 - atZoom), next.y)),
    };
  }

  function zoomAt(factor: number, anchor?: { x: number; y: number }): void {
    const { width, height } = size();
    const point = anchor ?? { x: width / 2, y: height / 2 };
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    const sceneX = (point.x - pan.x) / zoom;
    const sceneY = (point.y - pan.y) / zoom;
    pan = clampedPan({ x: point.x - sceneX * nextZoom, y: point.y - sceneY * nextZoom }, nextZoom);
    zoom = nextZoom;
  }

  function resetView(): void {
    zoom = 1;
    pan = { x: 0, y: 0 };
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    zoomAt(Math.pow(1.0015, -event.deltaY), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || zoom <= MIN_ZOOM) return;
    panning = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    container.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!panning) return;
    pan = clampedPan({
      x: pan.x + event.clientX - lastPointer.x,
      y: pan.y + event.clientY - lastPointer.y,
    });
    lastPointer = { x: event.clientX, y: event.clientY };
  }

  function stopPanning(event: PointerEvent): void {
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
    panning = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 80 : 30;
    if (event.key === '+' || event.key === '=') zoomAt(1.25);
    else if (event.key === '-') zoomAt(0.8);
    else if (event.key === '0') resetView();
    else if (event.key === 'ArrowLeft') pan = clampedPan({ x: pan.x + step, y: pan.y });
    else if (event.key === 'ArrowRight') pan = clampedPan({ x: pan.x - step, y: pan.y });
    else if (event.key === 'ArrowUp') pan = clampedPan({ x: pan.x, y: pan.y + step });
    else if (event.key === 'ArrowDown') pan = clampedPan({ x: pan.x, y: pan.y - step });
    else return;
    event.preventDefault();
  }

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
      zoom,
      pan,
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
    void zoom;
    void pan;
    if (canvas) requestAnimationFrame(draw);
  });

  onMount(() => {
    observer = new ResizeObserver(() => {
      pan = clampedPan(pan);
      draw();
    });
    observer.observe(container);
    draw();
    return () => observer?.disconnect();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="heatmap"
  class:panning
  bind:this={container}
  role="application"
  aria-label={`Zoombare Heatmap aus ${points.length} Einsätzen auf der Spielkarte`}
  tabindex="0"
  onwheel={onWheel}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={stopPanning}
  onpointercancel={stopPanning}
  onkeydown={onKeydown}
>
  {#if imageUrl}
    <img bind:this={image} src={imageUrl} alt="" onload={draw} style:transform={`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`} />
  {:else}
    <div class="map-missing">Kartenbild nicht verfügbar</div>
  {/if}
  <canvas bind:this={canvas}></canvas>
  {#if !points.length}<div class="empty">Noch keine Einsatzorte erfasst</div>{/if}
  <div class="zoom-controls">
    <button type="button" data-tooltip="Vergrößern" aria-label="Heatmap vergrößern" onpointerdown={(event) => event.stopPropagation()} onclick={() => zoomAt(1.25)}><FaIcon icon={Plus} size={14} /></button>
    <button type="button" data-tooltip="Verkleinern" aria-label="Heatmap verkleinern" disabled={zoom <= MIN_ZOOM} onpointerdown={(event) => event.stopPropagation()} onclick={() => zoomAt(0.8)}><FaIcon icon={Minus} size={14} /></button>
    <button type="button" data-tooltip="Einpassen" aria-label="Heatmap einpassen" disabled={zoom === 1 && pan.x === 0 && pan.y === 0} onpointerdown={(event) => event.stopPropagation()} onclick={resetView}><FaIcon icon={Crosshair} size={14} /></button>
  </div>
  <div class="scale" aria-hidden="true"><span>wenige</span><i></i><span>viele</span></div>
</div>

<style>
  .heatmap {
    position: relative;
    min-height: 310px;
    overflow: hidden;
    background: #0e0f11;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .heatmap.panning {
    cursor: grabbing;
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0.82;
    transform-origin: 0 0;
    pointer-events: none;
  }
  canvas {
    position: absolute;
    inset: 0;
    pointer-events: none;
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
  .zoom-controls {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    border: 1px solid var(--border);
    background: rgba(14, 15, 17, 0.9);
  }
  .zoom-controls button {
    display: grid;
    width: 30px;
    height: 28px;
    padding: 0;
    place-items: center;
    border: 0;
    border-right: 1px solid var(--border);
    background: transparent;
    color: var(--text);
  }
  .zoom-controls button:last-child {
    border-right: 0;
  }
  .zoom-controls button:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .zoom-controls button:disabled {
    color: var(--text-dim);
    opacity: 0.45;
  }
  @media (max-width: 620px) {
    .heatmap {
      min-height: 230px;
    }
  }
</style>
