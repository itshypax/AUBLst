<script lang="ts">
  import { onMount } from 'svelte';
  import { vehicleDisplayName } from '../lib/classify';
  import { fitMapPoints, focusMapView, toScreen, worldToCanvas, type MapView, type Point } from '../lib/mapview';
  import { app } from '../lib/state.svelte';
  import type { EventItem, Vehicle } from '../lib/types';

  export interface AlarmMonitorIncident {
    event: EventItem;
    vehicles: Vehicle[];
  }

  let { incidents, focusEventId = null }: { incidents: AlarmMonitorIncident[]; focusEventId?: number | null } =
    $props();

  let frame: HTMLDivElement;
  let image = $state<HTMLImageElement>();
  let eventPoints = $state<Array<{ incident: AlarmMonitorIncident; point: Point }>>([]);
  let vehiclePoints = $state<Array<{ vehicle: Vehicle; point: Point; eventId: number }>>([]);
  let mapTransform = $state('none');

  function updatePositions(): void {
    if (!frame) return;
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    if (width <= 0 || height <= 0) return;
    const natural =
      image?.naturalWidth && image?.naturalHeight
        ? { w: image.naturalWidth, h: image.naturalHeight }
        : { w: width, h: height };
    const baseView: MapView = { width, height, natural, contentRect: app.mapContentRect, zoom: 1, pan: { x: 0, y: 0 } };
    const focusedIncident = incidents.find((incident) => incident.event.id === focusEventId);
    const view = focusedIncident
      ? focusMapView(focusedIncident.event, app.mapBounds, baseView)
      : fitMapPoints(
          incidents.map((incident) => incident.event),
          app.mapBounds,
          baseView,
        );
    mapTransform = `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})`;
    eventPoints = incidents.map((incident) => ({
      incident,
      point: toScreen(worldToCanvas(incident.event, app.mapBounds, view), view),
    }));
    vehiclePoints = incidents.flatMap((incident) =>
      incident.vehicles.map((vehicle) => ({
        vehicle,
        eventId: incident.event.id,
        point: toScreen(worldToCanvas(vehicle, app.mapBounds, view), view),
      })),
    );
  }

  $effect(() => {
    void incidents;
    void focusEventId;
    void app.mapBounds;
    void app.mapContentRect;
    void app.mapImageUrl;
    void app.positionRevision;
    requestAnimationFrame(updatePositions);
  });

  onMount(() => {
    const observer = new ResizeObserver(updatePositions);
    observer.observe(frame);
    updatePositions();
    return () => observer.disconnect();
  });
</script>

<div class="map" bind:this={frame} aria-label={`Karte für ${incidents.length} Einsatzstellen`}>
  {#if app.mapImageUrl}
    <img bind:this={image} src={app.mapImageUrl} alt="" onload={updatePositions} style={`transform:${mapTransform}`} />
  {:else}
    <div class="map-missing">
      <span>Kartenbild nicht verfügbar</span>
      <strong>{incidents.length} Einsatzstellen</strong>
    </div>
  {/if}

  {#each eventPoints as marker (marker.incident.event.id)}
    <span
      class="event-marker"
      class:focused={marker.incident.event.id === focusEventId}
      style={`left:${marker.point.x}px;top:${marker.point.y}px`}
    >
      <span aria-hidden="true"></span>
      <strong>{marker.incident.event.name || 'Einsatz'}</strong>
    </span>
  {/each}

  {#each vehiclePoints as marker (`${marker.eventId}:${marker.vehicle.id}`)}
    <span
      class="vehicle-marker status-{marker.vehicle.status}"
      style={`left:${marker.point.x}px;top:${marker.point.y}px`}
      title={vehicleDisplayName(marker.vehicle)}>{vehicleDisplayName(marker.vehicle)}</span
    >
  {/each}

  <div class="coordinates">{incidents.length === 1 ? '1 Einsatzstelle' : `${incidents.length} Einsatzstellen`}</div>
</div>

<style>
  .map {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 220px;
    overflow: hidden;
    background-color: #111315;
    background-image:
      linear-gradient(#24282c 1px, transparent 1px), linear-gradient(90deg, #24282c 1px, transparent 1px);
    background-size: 36px 36px;
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    transform-origin: 0 0;
    will-change: transform;
  }
  .map-missing {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    gap: 8px;
    text-align: center;
    color: #8f949b;
  }
  .map-missing strong {
    color: #f0f1f2;
    font:
      600 clamp(18px, 2vw, 28px) ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
  }
  .event-marker {
    position: absolute;
    z-index: 3;
    translate: -11px -50%;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .event-marker > span {
    width: 22px;
    height: 22px;
    flex: 0 0 auto;
    rotate: 45deg;
    border: 4px solid #fff;
    background: #737980;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
  }
  .event-marker strong {
    max-width: 220px;
    padding: 5px 7px;
    overflow: hidden;
    border: 1px solid #fff;
    background: rgba(10, 11, 12, 0.9);
    color: #fff;
    font-size: 12px;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .event-marker.focused strong {
    border-color: #e8524a;
  }
  .event-marker.focused > span {
    background: #e8524a;
  }
  .vehicle-marker {
    position: absolute;
    z-index: 2;
    display: flex;
    align-items: center;
    min-width: 58px;
    height: 24px;
    padding: 0 7px;
    translate: -50% -50%;
    border: 2px solid #f4f5f6;
    background: var(--status-6-start);
    color: #fff;
    font:
      750 11px ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
    white-space: nowrap;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.55);
  }
  .vehicle-marker.status-0 {
    background: var(--status-0-start);
  }
  .vehicle-marker.status-1 {
    background: var(--status-1-start);
  }
  .vehicle-marker.status-2 {
    background: var(--status-2-start);
  }
  .vehicle-marker.status-3 {
    background: var(--status-3-start);
  }
  .vehicle-marker.status-4 {
    background: var(--status-4-start);
  }
  .vehicle-marker.status-5 {
    background: var(--status-5-start);
  }
  .vehicle-marker.status-6 {
    background: var(--status-6-start);
  }
  .vehicle-marker.status-7 {
    background: var(--status-7-start);
  }
  .vehicle-marker.status-8 {
    background: var(--status-8-start);
  }
  .vehicle-marker.status-9 {
    background: var(--status-9-start);
  }
  .coordinates {
    position: absolute;
    right: 0;
    bottom: 0;
    padding: 6px 9px;
    background: rgba(10, 11, 12, 0.82);
    color: #d8dade;
    font:
      11px ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
  }
</style>
