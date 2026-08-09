<script lang="ts">
  import { Crosshair, Map as MapIcon, MapPin, Minus, Move, Plus, SlidersHorizontal, X } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import { eventCategory, station, type EventCategory } from '../lib/classify';
  import { canvasToWorld, imageDrawRect, toScreen, worldToCanvas, type MapView, type Point } from '../lib/mapview';
  import { app, assignedEventForVehicle, openAssign, openVehicleMenu, setHighlightedEvent, setHighlightedVehicle } from '../lib/state.svelte';
  import { statusDisplay } from '../lib/status';
  import { vehicleIconName } from '../lib/vehicleIcons';
  import type { EventItem, Vehicle } from '../lib/types';
  import StatusBadge from './StatusBadge.svelte';

  let wrapper: HTMLDivElement;
  let canvas: HTMLCanvasElement;

  let img: HTMLImageElement | null = null;
  let natural = $state({ w: 0, h: 0 });
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let panning = $state(false);
  let dragged = false;
  let last = { x: 0, y: 0 };
  let hoverTarget = $state<'event' | 'vehicle' | null>(null);
  let hoverEventId = $state<number | null>(null);
  let hoverVehicleId = $state<number | null>(null);
  let hoverPos = $state({ x: 0, y: 0 });
  let placing = $state(false);
  let filtersOpen = $state(false);
  let showVehicles = $state(true);
  let showEvents = $state(true);
  let hiddenStatuses = $state<Set<number>>(new Set());
  let hiddenCategories = $state<Set<EventCategory>>(new Set());
  let hiddenStations = $state<Set<string>>(new Set());
  const stations = $derived([...new Set(app.vehicles.map(station))].sort((a, b) => a.localeCompare(b, 'de', { numeric: true })));
  const visibleEvents = $derived(showEvents ? app.events.filter((event) => !hiddenCategories.has(eventCategory(event.name))) : []);
  const visibleVehicles = $derived(showVehicles ? app.vehicles.filter((vehicle) => !hiddenStatuses.has(Number(vehicle.status)) && !hiddenStations.has(station(vehicle))) : []);
  const hoverEvent = $derived(visibleEvents.find((event) => event.id === hoverEventId) ?? null);
  const tooltipEvent = $derived(hoverEvent ?? visibleEvents.find((event) => event.id === app.highlightedEventId) ?? null);
  const hoverVehicle = $derived(visibleVehicles.find((v) => v.id === hoverVehicleId) ?? null);
  const tooltipVehicle = $derived(hoverVehicle ?? visibleVehicles.find((v) => v.id === app.highlightedVehicleId) ?? null);
  const eventTooltipPosition = $derived.by(() => {
    if (!tooltipEvent || !canvas || hoverEvent) return hoverPos;
    return toScreen(worldToCanvas(tooltipEvent, app.mapBounds, view()), view());
  });
  const vehicleTooltipPosition = $derived.by(() => {
    if (!tooltipVehicle || !canvas || hoverVehicle) return hoverPos;
    return toScreen(worldToCanvas(tooltipVehicle, app.mapBounds, view()), view());
  });
  const STATUS_LABELS = ['Alarmiert', 'Einsatzbereit Funk', 'Einsatzbereit Wache', 'Einsatz übernommen', 'An Einsatzstelle', 'Sprechwunsch', 'Nicht einsatzbereit', 'Patient aufgenommen', 'Am Transportziel'];
  const CATEGORY_LABELS: Record<EventCategory, string> = { fire: 'Brand', hazard: 'Gefahrgut', water: 'Wasser', thl: 'Hilfeleistung', medical: 'Rettungsdienst', other: 'Sonstige' };
  const CATEGORIES = Object.keys(CATEGORY_LABELS) as EventCategory[];
  type EventMarkerKind = EventCategory | 'control-room';

  const iconCache = new Map<string, HTMLImageElement>();
  function iconFor(v: Vehicle): HTMLImageElement | null {
    const name = vehicleIconName(v);
    if (!name) return null;
    let image = iconCache.get(name);
    if (!image) {
      image = new Image();
      image.onload = () => scheduleRender();
    image.src = `./vehicles/${name}.webp`;
      iconCache.set(name, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }

  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 4;
  const VEHICLE_ICON_SIZE = 54;
  const VEHICLE_ICON_HIGHLIGHT_SIZE = 66;
  const VEHICLE_HIT_RADIUS = 30;
  const VEHICLE_HIGHLIGHT_HIT_RADIUS = 38;

  const cssVars = new Map<string, string>();
  function cssVar(name: string, fallback: string): string {
    if (!cssVars.has(name)) {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      cssVars.set(name, value || fallback);
    }
    return cssVars.get(name)!;
  }

  function statusColor(status: number | string): string {
    return cssVar(`--status-${status}-start`, cssVar('--good', '#2ec98e'));
  }

  function eventColor(category: EventMarkerKind): string {
    if (category === 'fire') return cssVar('--danger', '#e85b62');
    if (category === 'hazard') return cssVar('--warn', '#f0a03c');
    if (category === 'water') return cssVar('--water', '#2aa6b7');
    if (category === 'thl') return cssVar('--accent', '#4c8dff');
    if (category === 'medical') return cssVar('--good', '#2ec98e');
    if (category === 'control-room') return cssVar('--accent', '#4c8dff');
    return cssVar('--text-dim', '#9aa3b2');
  }

  const eventIconNodes: Record<EventMarkerKind, string> = {
    fire: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    hazard: '<circle cx="12" cy="11.9" r="2"/><path d="M6.7 3.4c-.9 2.5 0 5.2 2.2 6.7C6.5 9 3.7 9.6 2 11.6"/><path d="m8.9 10.1 1.4.8"/><path d="M17.3 3.4c.9 2.5 0 5.2-2.2 6.7 2.4-1.2 5.2-.6 6.9 1.5"/><path d="m15.1 10.1-1.4.8"/><path d="M16.7 20.8c-2.6-.4-4.6-2.6-4.7-5.3-.2 2.6-2.1 4.8-4.7 5.2"/><path d="M12 13.9v1.6"/><path d="M13.5 5.4c-1-.2-2-.2-3 0"/><path d="M17 16.4c.7-.7 1.2-1.6 1.5-2.5"/><path d="M5.5 13.9c.3.9.8 1.8 1.5 2.5"/>',
    water: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
    thl: '<path d="m14 12-8.5 8.5a2.12 2.12 0 1 1-3-3L11 9"/><path d="M15 13 9 7l4-4 6 6h3a8 8 0 0 1-7 7z"/>',
    medical: '<path d="M4 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h4a1 1 0 0 1 1 1v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a1 1 0 0 1 1-1h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-4a1 1 0 0 1-1-1V4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4a1 1 0 0 1-1 1z"/>',
    other: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'control-room': '<path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/>',
  };
  const eventIconCache = new Map<EventMarkerKind, HTMLImageElement>();

  function eventIconFor(kind: EventMarkerKind): HTMLImageElement | null {
    let image = eventIconCache.get(kind);
    if (!image) {
      image = new Image();
      image.onload = () => scheduleRender();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${eventIconNodes[kind]}</svg>`;
      image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      eventIconCache.set(kind, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }

  function view(): MapView {
    return { zoom, pan, natural, width: canvas.clientWidth, height: canvas.clientHeight };
  }

  let renderQueued = false;
  function scheduleRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  let resizeQueued = false;
  function scheduleResize(): void {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      resize();
    });
  }

  function resize(): void {
    if (!canvas || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    render();
  }

  $effect(() => {
    const observer = new ResizeObserver(() => scheduleResize());
    observer.observe(wrapper);
    resize();
    return () => observer.disconnect();
  });

  $effect(() => {
    const url = app.mapImageUrl;
    img = null;
    natural = { w: 0, h: 0 };
    resetView();
    if (url) {
      const image = new Image();
      image.onload = () => {
        img = image;
        natural = { w: image.naturalWidth, h: image.naturalHeight };
        scheduleRender();
      };
      image.onerror = () => console.warn('Kartenbild konnte nicht geladen werden');
      image.src = url;
    }
    scheduleRender();
  });

  $effect(() => {
    void app.vehicles;
    void app.events;
    void app.mapBounds;
    void app.highlightedEventId;
    void app.highlightedVehicleId;
    void visibleEvents;
    void visibleVehicles;
    scheduleRender();
  });

  // Fokus einmalig anwenden und verbrauchen; untrack verhindert, dass der
  // Effekt am 3-Sekunden-Polling (neues mapBounds-Objekt) hängen bleibt und
  // die Karte immer wieder zurückzentriert
  $effect(() => {
    const fp = app.focusPoint;
    if (!fp || !canvas) return;
    untrack(() => {
      zoom = Math.max(zoom, 1.6);
      const p = worldToCanvas({ x: fp.x, y: fp.y }, app.mapBounds, view());
      pan = {
        x: canvas.clientWidth / 2 - p.x * zoom,
        y: canvas.clientHeight / 2 - p.y * zoom,
      };
      scheduleRender();
    });
    app.focusPoint = null;
  });

  function clientToCanvas(clientX: number, clientY: number): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function eventNear(pos: Point, hitRadius = 18): EventItem | null {
    const v = view();
    for (const ev of visibleEvents) {
      const screen = toScreen(worldToCanvas(ev, app.mapBounds, v), v);
      if (Math.hypot(screen.x - pos.x, screen.y - pos.y) <= hitRadius) {
        return ev;
      }
    }
    return null;
  }

  function vehicleNear(pos: Point): Vehicle | null {
    const v = view();
    for (const veh of visibleVehicles) {
      const screen = toScreen(worldToCanvas(veh, app.mapBounds, v), v);
      const hitRadius = app.highlightedVehicleId === veh.id ? VEHICLE_HIGHLIGHT_HIT_RADIUS : VEHICLE_HIT_RADIUS;
      if (Math.hypot(screen.x - pos.x, screen.y - pos.y) <= hitRadius) {
        return veh;
      }
    }
    return null;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (placing) {
      dragged = false;
      return;
    }
    panning = true;
    dragged = false;
    last = { x: e.clientX, y: e.clientY };
    wrapper.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (panning) {
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        pan = { x: pan.x + dx, y: pan.y + dy };
        last = { x: e.clientX, y: e.clientY };
        if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
        scheduleRender();
      }
      return;
    }
    const pos = clientToCanvas(e.clientX, e.clientY);
    const ev = eventNear(pos);
    const veh = ev ? null : vehicleNear(pos);
    setHighlightedEvent(ev ? ev.id : null);
    setHighlightedVehicle(veh ? veh.id : null);
    hoverTarget = ev ? 'event' : veh ? 'vehicle' : null;
    hoverEventId = ev ? ev.id : null;
    hoverVehicleId = veh ? veh.id : null;
    hoverPos = pos;
  }

  function onPointerUp(e: PointerEvent): void {
    if (placing && e.button === 0) {
      const pos = clientToCanvas(e.clientX, e.clientY);
      const ev = eventNear(pos);
      if (ev) openAssign(ev);
      else app.createEventPos = canvasToWorld(pos, app.mapBounds, view());
      placing = false;
      return;
    }
    if (!panning) return;
    panning = false;
    wrapper.releasePointerCapture(e.pointerId);
    if (dragged || e.button !== 0) return;
    const pos = clientToCanvas(e.clientX, e.clientY);
    const ev = eventNear(pos);
    if (ev) {
      openAssign(ev);
      return;
    }
    const veh = vehicleNear(pos);
    const assignedEvent = veh ? assignedEventForVehicle(veh.id) : undefined;
    if (assignedEvent) openAssign(assignedEvent);
  }

  function onPointerLeave(): void {
    if (panning) return;
    setHighlightedEvent(null);
    setHighlightedVehicle(null);
    hoverTarget = null;
    hoverEventId = null;
    hoverVehicleId = null;
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const mouse = clientToCanvas(e.clientX, e.clientY);
    const preX = (mouse.x - pan.x) / zoom;
    const preY = (mouse.y - pan.y) / zoom;
    const factor = Math.pow(1.0015, -e.deltaY);
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    pan = { x: mouse.x - preX * zoom, y: mouse.y - preY * zoom };
    scheduleRender();
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const pos = clientToCanvas(e.clientX, e.clientY);
    const veh = vehicleNear(pos);
    if (veh) {
      openVehicleMenu(veh.id, e.clientX, e.clientY);
      return;
    }
    app.createEventPos = canvasToWorld(pos, app.mapBounds, view());
  }

  function zoomAtCenter(factor: number): void {
    if (!canvas) return;
    const center = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const preX = (center.x - pan.x) / zoom;
    const preY = (center.y - pan.y) / zoom;
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    pan = { x: center.x - preX * zoom, y: center.y - preY * zoom };
    scheduleRender();
  }

  function resetView(): void {
    zoom = 1;
    pan = { x: 0, y: 0 };
    scheduleRender();
  }

  function toggleSet<T>(values: Set<T>, value: T): Set<T> {
    const next = new Set(values);
    if (next.has(value)) next.delete(value); else next.add(value);
    scheduleRender();
    return next;
  }

  function resetFilters(): void {
    showVehicles = true;
    showEvents = true;
    hiddenStatuses = new Set();
    hiddenCategories = new Set();
    hiddenStations = new Set();
    scheduleRender();
  }

  function onMapKeydown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 80 : 30;
    if (e.key === '+' || e.key === '=') zoomAtCenter(1.25);
    else if (e.key === '-') zoomAtCenter(0.8);
    else if (e.key === '0') resetView();
    else if (e.key === 'ArrowLeft') pan = { x: pan.x + step, y: pan.y };
    else if (e.key === 'ArrowRight') pan = { x: pan.x - step, y: pan.y };
    else if (e.key === 'ArrowUp') pan = { x: pan.x, y: pan.y + step };
    else if (e.key === 'ArrowDown') pan = { x: pan.x, y: pan.y - step };
    else return;
    e.preventDefault();
    scheduleRender();
  }

  function render(): void {
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(ratio, ratio);
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    const v = view();
    const d = imageDrawRect(v);
    if (img && natural.w && natural.h) {
      ctx.drawImage(img, d.x, d.y, d.w, d.h);
    }

    const vehicleOutline = cssVar('--vehicle-outline', '#dfe7ff');

    for (const ev of visibleEvents) {
      const p = worldToCanvas(ev, app.mapBounds, v);
      const markerKind: EventMarkerKind = ev.created_by === 'frontend' ? 'control-room' : eventCategory(ev.name);
      const markerColor = eventColor(markerKind);
      const isHighlighted = app.highlightedEventId === ev.id;
      const baseRadius = Math.min(12 / zoom, 12);
      const radius = isHighlighted ? baseRadius * 1.4 : baseRadius;

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = markerColor;
      ctx.fill();
      ctx.lineWidth = (isHighlighted ? 3 : 2) / zoom;
      ctx.strokeStyle = isHighlighted ? '#ffffff' : 'rgba(255, 255, 255, 0.8)';
      ctx.stroke();
      const eventIcon = eventIconFor(markerKind);
      if (eventIcon) {
        const iconSize = radius * 1.5;
        ctx.drawImage(eventIcon, p.x - iconSize / 2, p.y - iconSize / 2, iconSize, iconSize);
      }
      if (isHighlighted) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 6 / zoom, 0, Math.PI * 2);
        ctx.lineWidth = 1 / zoom;
        ctx.strokeStyle = markerColor;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Fahrzeuge als Grafiken; Name und Status kommen per Hover-Tooltip
    const vehiclesToRender = [...visibleVehicles].sort(
      (a, b) => Number(a.id === app.highlightedVehicleId) - Number(b.id === app.highlightedVehicleId)
    );
    for (const veh of vehiclesToRender) {
      const p = worldToCanvas(veh, app.mapBounds, v);
      const icon = iconFor(veh);
      const isHighlighted = app.highlightedVehicleId === veh.id;

      if (icon) {
        const base = isHighlighted ? VEHICLE_ICON_HIGHLIGHT_SIZE : VEHICLE_ICON_SIZE;
        const w = Math.min(base / zoom, base);
        const h = w * (icon.naturalHeight / icon.naturalWidth);
        ctx.drawImage(icon, p.x - w / 2, p.y - h / 2, w, h);

        const statusSize = isHighlighted ? 17 : 15;
        const sq = Math.min(statusSize / zoom, statusSize);
        const sx = p.x + w / 2 - sq / 2;
        const sy = p.y + h / 2 - sq / 2;
        ctx.fillStyle = statusColor(veh.status);
        ctx.fillRect(sx, sy, sq, sq);
        ctx.lineWidth = 1 / zoom;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.strokeRect(sx, sy, sq, sq);
        ctx.fillStyle = '#ffffff';
        const statusFontSize = isHighlighted ? 11 : 10;
        ctx.font = `700 ${Math.min(statusFontSize / zoom, statusFontSize)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(statusDisplay(veh.status), sx + sq / 2, sy + sq / 2 + 0.5 / zoom);
        continue;
      }

      const markerSize = isHighlighted ? 15 : 13;
      const offset = Math.min(markerSize / zoom, markerSize);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - offset);
      ctx.lineTo(p.x + offset, p.y);
      ctx.lineTo(p.x, p.y + offset);
      ctx.lineTo(p.x - offset, p.y);
      ctx.closePath();
      ctx.fillStyle = statusColor(veh.status);
      ctx.fill();
      ctx.lineWidth = 1.5 / zoom;
      ctx.strokeStyle = vehicleOutline;
      ctx.stroke();
    }

    ctx.restore();
  }
</script>

<section class="panel map-panel">
  <div class="panel-header">
    <span class="icon"><MapIcon size={14} /></span>
    <h2>Karte</h2>
    <span class="spacer"></span>
    <span class="hint">Scrollen: Zoom · Verschieben-Schalter: Pfeiltasten</span>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="map-wrapper"
    class:pointer={hoverTarget !== null}
    class:panning
    bind:this={wrapper}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointerleave={onPointerLeave}
    onwheel={onWheel}
    oncontextmenu={onContextMenu}
    role="application"
    aria-label="Einsatzkarte"
    class:placing
  >
    <canvas bind:this={canvas}></canvas>
    <div class="map-controls" role="toolbar" aria-label="Kartensteuerung">
      <button data-tooltip="Vergrößern" aria-label="Karte vergrößern" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={() => zoomAtCenter(1.25)}><Plus size={15} /></button>
      <button data-tooltip="Verkleinern" aria-label="Karte verkleinern" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={() => zoomAtCenter(0.8)}><Minus size={15} /></button>
      <button data-tooltip="Karte einpassen" aria-label="Karte einpassen" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={resetView}><Crosshair size={15} /></button>
      <button data-tooltip="Karte mit Pfeiltasten verschieben" aria-label="Karte mit Pfeiltasten verschieben" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onkeydown={onMapKeydown}><Move size={15} /></button>
      <button class="create-event" class:active={placing} aria-pressed={placing} data-tooltip="Einsatz auf der Karte anlegen" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={() => (placing = !placing)}><MapPin size={15} /> Einsatz anlegen</button>
      <button class:active={filtersOpen} aria-pressed={filtersOpen} data-tooltip="Kartenfilter" aria-label="Kartenfilter öffnen" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={() => (filtersOpen = !filtersOpen)}><SlidersHorizontal size={15} /></button>
    </div>
    {#if filtersOpen}
      <div class="map-filters" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} oncontextmenu={(e) => e.stopPropagation()} role="dialog" aria-label="Kartenfilter" tabindex="-1">
        <div class="filter-head"><strong>Kartenfilter</strong><button class="ghost" data-tooltip="Schließen" aria-label="Kartenfilter schließen" onclick={() => (filtersOpen = false)}><X size={14} /></button></div>
        <div class="filter-section two">
          <label><input type="checkbox" bind:checked={showVehicles} onchange={scheduleRender} /> Fahrzeuge</label>
          <label><input type="checkbox" bind:checked={showEvents} onchange={scheduleRender} /> Einsätze</label>
        </div>
        <div class="filter-section"><span>Status</span><div class="options statuses">
          {#each STATUS_LABELS as label, status (status)}
            <label data-tooltip={label}><input type="checkbox" checked={!hiddenStatuses.has(status)} onchange={() => (hiddenStatuses = toggleSet(hiddenStatuses, status))} /><StatusBadge value={status} /></label>
          {/each}
        </div></div>
        <div class="filter-section"><span>Einsatzarten</span><div class="options categories">
          {#each CATEGORIES as category (category)}
            <label><input type="checkbox" checked={!hiddenCategories.has(category)} onchange={() => (hiddenCategories = toggleSet(hiddenCategories, category))} /><i style={`background: ${eventColor(category)}`}></i>{CATEGORY_LABELS[category]}</label>
          {/each}
        </div></div>
        <div class="filter-section"><span>Wachen</span><div class="options stations">
          {#each stations as stationName (stationName)}
            <label><input type="checkbox" checked={!hiddenStations.has(stationName)} onchange={() => (hiddenStations = toggleSet(hiddenStations, stationName))} />{stationName}</label>
          {/each}
        </div></div>
        <button class="reset-filter" onclick={resetFilters}>Alle anzeigen</button>
      </div>
    {/if}
    {#if tooltipEvent}
      <div class="map-tooltip" style="left: {eventTooltipPosition.x + 14}px; top: {eventTooltipPosition.y + 14}px;">
        <span class="tt-name">{tooltipEvent.name || 'Einsatz'}</span>
      </div>
    {:else if tooltipVehicle}
      <div class="map-tooltip" style="left: {vehicleTooltipPosition.x + 14}px; top: {vehicleTooltipPosition.y + 14}px;">
        <span class="tt-name">{tooltipVehicle.name || tooltipVehicle.type || tooltipVehicle.game_vehicle_id}</span>
        <StatusBadge value={tooltipVehicle.status} />
      </div>
    {/if}
    {#if !app.mapImageUrl}
      <div class="map-placeholder">
        {#if app.sessionToken}
          Kein Kartenbild für diese Sitzung
        {:else}
          Sitzungs-Token oben rechts eintragen
        {/if}
      </div>
    {/if}
  </div>
  <div class="legend">
    <span class="chip"><span class="dot event"></span> Einsatz</span>
    <span class="chip"><span class="dot vehicle"></span> Fahrzeug</span>
    <details class="status-help">
      <summary>Statuslegende</summary>
      <div class="status-popover">
        {#each STATUS_LABELS as label, status (label)}
          <span><StatusBadge value={status} /> {label}</span>
        {/each}
      </div>
    </details>
  </div>
</section>

<style>
  .map-panel {
    height: 100%;
  }

  .hint {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: none;
    letter-spacing: normal;
  }

  .map-wrapper {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    background: #0e0f11;
    cursor: grab;
    touch-action: none;
  }

  .map-wrapper.pointer {
    cursor: pointer;
  }

  .map-wrapper.panning {
    cursor: grabbing;
  }

  .map-wrapper.placing { cursor: crosshair; }

  .map-controls { position: absolute; top: 10px; right: 10px; display: flex; gap: 4px; z-index: 6; }
  .map-controls button { min-width: 30px; height: 30px; padding: 0 7px; justify-content: center; background: rgba(21, 22, 25, 0.94); }
  .map-controls button.active { border-color: var(--accent-outline); background: #25282d; }
  .map-filters { position: absolute; top: 48px; right: 10px; z-index: 7; width: min(330px, calc(100% - 20px)); max-height: calc(100% - 62px); overflow: auto; padding: 10px; border: 1px solid var(--border-strong); background: rgba(21, 22, 25, 0.98); box-shadow: var(--shadow); cursor: default; }
  .filter-head { display: flex; align-items: center; padding-bottom: 7px; border-bottom: 1px solid var(--border); } .filter-head strong { flex: 1; font-size: 12px; }
  .filter-section { padding: 9px 0; border-bottom: 1px solid var(--border); } .filter-section > span { display: block; margin-bottom: 7px; color: var(--text-dim); font-size: 10px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; }
  .filter-section.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .filter-section label { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11px; }
  .options { display: grid; gap: 6px; } .options.statuses { grid-template-columns: repeat(5, 1fr); } .options.categories { grid-template-columns: 1fr 1fr; } .options.stations { grid-template-columns: 1fr 1fr; }
  .options.statuses label { justify-content: center; } .options i { width: 8px; height: 8px; flex: 0 0 auto; }
  .reset-filter { width: 100%; margin-top: 9px; justify-content: center; font-size: 11px; }

  canvas {
    position: absolute;
    inset: 0;
  }

  .map-tooltip {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 9px;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
    z-index: 5;
  }

  .map-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    font-size: 13px;
    pointer-events: none;
  }

  .legend {
    display: flex;
    gap: 12px;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-dim);
    flex: 0 0 auto;
  }

  .status-help { margin-left: auto; position: relative; }
  .status-help summary { cursor: pointer; color: var(--text-dim); }
  .status-help summary:hover, .status-help summary:focus-visible { color: var(--text); }
  .status-popover { position: absolute; right: 0; bottom: calc(100% + 8px); width: 210px; padding: 8px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow); display: grid; gap: 5px; z-index: 8; }
  .status-popover > span { display: flex; align-items: center; gap: 8px; color: var(--text); }

  @media (max-width: 620px) {
    .hint { display: none; }
    .map-controls .create-event { font-size: 0; width: 30px; }
    .map-controls .create-event :global(svg) { margin: 0; }
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
  }

  .dot.event {
    background: var(--accent);
    border: 1px solid var(--accent-outline);
  }

  .dot.vehicle {
    background: var(--good);
    border: 1px solid var(--vehicle-outline);
    border-radius: 2px;
    transform: rotate(45deg);
  }
</style>
