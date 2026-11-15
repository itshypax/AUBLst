<script lang="ts">
  import { onMount } from 'svelte';
  import { vehicleDisplayName } from '../lib/classify';
  import {
    fitMapPoints,
    focusMapView,
    groupNearby,
    spreadLabels,
    toScreen,
    worldToCanvas,
    type MapView,
    type Point,
  } from '../lib/mapview';
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
  // Wie bei rescuetrack: eine Fahne je Ort und Status, mehrere Fahrzeuge
  // am selben Ort stehen untereinander in derselben Fahne.
  let vehicleFlags = $state<
    Array<{ key: string; status: number; names: string[]; point: Point; labelOffset: number }>
  >([]);
  // Größe der Fahne, ohne sie zu messen: 12 px Schrift, 15 px je Zeile.
  const LABEL_CHARACTER_WIDTH = 7;
  const LABEL_PADDING = 36;
  const LABEL_LINE = 15;
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
    const points = incidents.flatMap((incident) =>
      incident.vehicles.map((vehicle) => {
        const point = toScreen(worldToCanvas(vehicle, app.mapBounds, view), view);
        return { ...point, vehicle, key: `${incident.event.id}:${vehicle.id}`, name: vehicleDisplayName(vehicle) };
      }),
    );
    const flags = groupNearby(points, (item) => item.vehicle.status).map((group) => ({
      key: group.map((item) => item.key).join(','),
      status: group[0].vehicle.status,
      names: group.map((item) => item.name),
      point: { x: group[0].x, y: group[0].y },
    }));
    const offsets = spreadLabels(
      flags.map((flag) => ({
        x: flag.point.x,
        y: flag.point.y,
        width: Math.max(...flag.names.map((name) => name.length)) * LABEL_CHARACTER_WIDTH + LABEL_PADDING,
        height: flag.names.length * LABEL_LINE + 6,
      })),
    );
    vehicleFlags = flags.map((flag, index) => ({ ...flag, labelOffset: offsets[index] }));
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

  {#each vehicleFlags as flag (flag.key)}
    <span
      class="vehicle-marker"
      class:grouped={flag.names.length > 1}
      style={`left:${flag.point.x}px;top:${flag.point.y}px;--vehicle-color:var(--status-${flag.status}-start)`}
      title={`Status ${flag.status}: ${flag.names.join(', ')}`}
    >
      <span class="vehicle-flag" style={`translate:0 ${flag.labelOffset}px`}>
        <b>{flag.status}</b>
        <span class="vehicle-names">
          {#each flag.names as name, index (index)}<span class="vehicle-name">{name}</span>{/each}
        </span>
      </span>
    </span>
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
  /* Einsatzmittel liegen über den Einsatzstellen: sie bewegen sich, die Stelle nicht. */
  .vehicle-marker {
    position: absolute;
    z-index: 4;
    width: 0;
    height: 0;
    --vehicle-color: var(--status-6-start);
  }
  /* Einzelnes Fahrzeug: die obere linke Ecke der Fahne ist die Position.
     Der Haken hängt an der Fahne, damit er beim Ausweichen mitgeht. */
  .vehicle-flag::before,
  .vehicle-marker.grouped::before {
    content: '';
    position: absolute;
    left: 0;
    top: -6px;
    width: 9px;
    height: 6px;
    border-top: 3px solid var(--vehicle-color);
    border-left: 3px solid var(--vehicle-color);
  }
  /* Mehrere Fahrzeuge am selben Ort: Ring auf der Position, Fahne daneben. */
  .grouped .vehicle-flag::before {
    content: none;
  }
  .vehicle-marker.grouped::before {
    left: -8px;
    top: -8px;
    width: 16px;
    height: 16px;
    border: 3px solid var(--vehicle-color);
    border-radius: 50%;
    box-sizing: border-box;
  }
  .vehicle-flag {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    align-items: flex-start;
    padding: 3px 8px 3px 0;
    background: var(--vehicle-color);
    color: #fff;
    font:
      600 12px/15px system-ui,
      'Segoe UI',
      sans-serif;
    white-space: nowrap;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5);
  }
  .grouped .vehicle-flag {
    left: 8px;
    top: 4px;
  }
  .vehicle-flag b {
    min-width: 22px;
    font-size: 15px;
    font-weight: 800;
    text-align: center;
  }
  .vehicle-names {
    display: grid;
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
