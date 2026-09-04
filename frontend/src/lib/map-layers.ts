import { worldToCanvas, type MapView } from './mapview';
import type { EventItem, MapBounds, Vehicle } from './types';

// Zeichenebenen der Leitstellenkarte. Die Basisebene (Kartenbild, Editor)
// und die Markerebene (Einsätze, Fahrzeuge) liegen auf getrennten Canvas-
// Elementen, damit ein Zustandsupdate nicht das komplette Kartenbild neu
// zeichnet.

export type MapLayer = 'base' | 'markers';

const ALL_LAYERS: MapLayer[] = ['base', 'markers'];

export class MapLayerScheduler {
  private queued = new Set<MapLayer>();
  private frameRequested = false;
  private frameGeneration = 0;

  constructor(
    private readonly draw: (layers: ReadonlySet<MapLayer>) => void,
    private readonly requestFrame: (cb: () => void) => void = (cb) => requestAnimationFrame(cb),
  ) {}

  get pending(): ReadonlySet<MapLayer> {
    return this.queued;
  }

  // Ohne Argument gelten alle Ebenen als ungültig. Mehrere Aufrufe bis zum
  // nächsten Frame ergeben genau einen Zeichenvorgang.
  invalidate(...layers: MapLayer[]): void {
    for (const layer of layers.length ? layers : ALL_LAYERS) this.queued.add(layer);
    if (this.frameRequested) return;
    this.frameRequested = true;
    const generation = ++this.frameGeneration;
    this.requestFrame(() => {
      if (generation !== this.frameGeneration) return;
      this.frameRequested = false;
      this.flush();
    });
  }

  // Sofort zeichnen, etwa nach einer Größenänderung. Ein bereits
  // angeforderter Frame wird dadurch hinfällig.
  drawNow(...layers: MapLayer[]): void {
    for (const layer of layers.length ? layers : ALL_LAYERS) this.queued.add(layer);
    this.frameGeneration += 1;
    this.frameRequested = false;
    this.flush();
  }

  private flush(): void {
    if (!this.queued.size) return;
    const layers = new Set(this.queued);
    this.queued.clear();
    this.draw(layers);
  }
}

export const VEHICLE_ICON_SIZE = 54;
export const VEHICLE_ICON_HIGHLIGHT_SIZE = 66;

export type VehicleIconImage = CanvasImageSource & { naturalWidth: number; naturalHeight: number };

export interface MarkerLayerInput {
  events: EventItem[];
  vehicles: Vehicle[];
  bounds: MapBounds;
  view: MapView;
  highlightedEventId: number | null;
  highlightedVehicleId: number | null;
  eventMarkerKind: (event: EventItem) => string;
  eventColor: (kind: string) => string;
  eventIcon: (kind: string) => CanvasImageSource | null;
  vehicleIcon: (vehicle: Vehicle) => VehicleIconImage | null;
  statusColor: (status: number | string) => string;
  statusText: (status: number | string) => string;
  vehicleOutline: string;
}

// Erwartet einen Context, dessen Transformation bereits Pan und Zoom
// enthält. Zeichnet Einsätze und darüber die Fahrzeuge; das hervorgehobene
// Fahrzeug kommt zuletzt, damit es nicht verdeckt wird.
export function drawMarkerLayer(ctx: CanvasRenderingContext2D, input: MarkerLayerInput): void {
  const { view, bounds } = input;
  const zoom = view.zoom;

  for (const ev of input.events) {
    const p = worldToCanvas(ev, bounds, view);
    const markerKind = input.eventMarkerKind(ev);
    const markerColor = input.eventColor(markerKind);
    const isHighlighted = input.highlightedEventId === ev.id;
    const baseRadius = Math.min(12 / zoom, 12);
    const radius = isHighlighted ? baseRadius * 1.4 : baseRadius;

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = markerColor;
    ctx.fill();
    ctx.lineWidth = (isHighlighted ? 3 : 2) / zoom;
    ctx.strokeStyle = isHighlighted ? '#ffffff' : 'rgba(255, 255, 255, 0.8)';
    ctx.stroke();
    const eventIcon = input.eventIcon(markerKind);
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
  const vehiclesToRender = [...input.vehicles].sort(
    (a, b) => Number(a.id === input.highlightedVehicleId) - Number(b.id === input.highlightedVehicleId),
  );
  for (const veh of vehiclesToRender) {
    const p = worldToCanvas(veh, bounds, view);
    const icon = input.vehicleIcon(veh);
    const isHighlighted = input.highlightedVehicleId === veh.id;

    if (icon) {
      const base = isHighlighted ? VEHICLE_ICON_HIGHLIGHT_SIZE : VEHICLE_ICON_SIZE;
      const w = Math.min(base / zoom, base);
      const h = w * (icon.naturalHeight / icon.naturalWidth);
      ctx.drawImage(icon, p.x - w / 2, p.y - h / 2, w, h);

      const statusSize = isHighlighted ? 17 : 15;
      const sq = Math.min(statusSize / zoom, statusSize);
      const sx = p.x + w / 2 - sq / 2;
      const sy = p.y + h / 2 - sq / 2;
      ctx.fillStyle = input.statusColor(veh.status);
      ctx.fillRect(sx, sy, sq, sq);
      ctx.lineWidth = 1 / zoom;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.strokeRect(sx, sy, sq, sq);
      ctx.fillStyle = '#ffffff';
      const statusFontSize = isHighlighted ? 11 : 10;
      ctx.font = `700 ${Math.min(statusFontSize / zoom, statusFontSize)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(input.statusText(veh.status), sx + sq / 2, sy + sq / 2 + 0.5 / zoom);
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
    ctx.fillStyle = input.statusColor(veh.status);
    ctx.fill();
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeStyle = input.vehicleOutline;
    ctx.stroke();
  }
}
