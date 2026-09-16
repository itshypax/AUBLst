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

// Ein Fahrzeug gilt als angekommen, sobald es die Einsatzstelle gemeldet hat.
// 7 und 8 zählen mit: ein RTW, der seinen Patienten geladen hat, war vor Ort,
// und der Ring darf nicht zurücklaufen, wenn er weiterfährt.
const ARRIVED_STATUS = new Set([4, 7, 8]);

export interface EventUnitProgress {
  assigned: number;
  arrived: number;
}

export const NO_UNITS: EventUnitProgress = { assigned: 0, arrived: 0 };

// Zählt je Einsatz die zugeordneten und die bereits angekommenen Fahrzeuge.
export function eventUnitProgress(
  assignments: ReadonlyArray<{ event_id: number; vehicle_id: number }>,
  vehicles: ReadonlyArray<Pick<Vehicle, 'id' | 'status'>>,
): Map<number, EventUnitProgress> {
  const status = new Map(vehicles.map((vehicle) => [vehicle.id, Number(vehicle.status)]));
  const progress = new Map<number, EventUnitProgress>();
  for (const assignment of assignments) {
    const entry = progress.get(assignment.event_id) ?? { assigned: 0, arrived: 0 };
    entry.assigned += 1;
    const current = status.get(assignment.vehicle_id);
    if (current !== undefined && ARRIVED_STATUS.has(current)) entry.arrived += 1;
    progress.set(assignment.event_id, entry);
  }
  return progress;
}

// Ein Leitstellen-Einsatz ohne Spiel-ID ist im Spiel noch nicht angekommen.
function eventIsPending(event: EventItem): boolean {
  return event.created_by === 'frontend' && !String(event.game_event_id ?? '').trim();
}

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
  eventProgress: (event: EventItem) => EventUnitProgress;
  vehicleIcon: (vehicle: Vehicle) => VehicleIconImage | null;
  statusColor: (status: number | string) => string;
  statusText: (status: number | string) => string;
  vehicleOutline: string;
}

// Maße in Bildschirmpixeln. Der Marker bleibt damit knapp über dem alten
// gefüllten Punkt (Rand bei 15 statt 13 px) und deutlich unter dem
// Fahrzeugsymbol.
const EVENT_RING_RADIUS = 12.5;
const EVENT_RING_WIDTH = 3;
const EVENT_CORE_RADIUS = 8.5;
const EVENT_HIGHLIGHT_SCALE = 1.3;

// Erwartet einen Context, dessen Transformation bereits Pan und Zoom
// enthält. Zeichnet Einsätze und darüber die Fahrzeuge; das hervorgehobene
// Fahrzeug kommt zuletzt, damit es nicht verdeckt wird.
export function drawMarkerLayer(ctx: CanvasRenderingContext2D, input: MarkerLayerInput): void {
  const { view, bounds } = input;
  const zoom = view.zoom;

  // Einsatzmarker: die Ringfarbe trägt die Kategorie, die Füllung des Rings
  // den Anteil der Fahrzeuge, die schon vor Ort sind. Zahlen stehen bewusst
  // nicht daneben - dafür gibt es den Hover.
  for (const ev of input.events) {
    const p = worldToCanvas(ev, bounds, view);
    const markerKind = input.eventMarkerKind(ev);
    const markerColor = input.eventColor(markerKind);
    const isHighlighted = input.highlightedEventId === ev.id;
    const scale = isHighlighted ? EVENT_HIGHLIGHT_SCALE : 1;
    // Größe am Bildschirm halten, beim Herauszoomen aber mitschrumpfen
    const size = (value: number) => Math.min((value * scale) / zoom, value * scale);
    const ringRadius = size(EVENT_RING_RADIUS);
    const ringWidth = size(EVENT_RING_WIDTH);
    const coreRadius = size(EVENT_CORE_RADIUS);
    const { assigned, arrived } = input.eventProgress(ev);

    // Dunkler Absatz, damit der Ring auch über hellen Flächen stehen bleibt
    ctx.beginPath();
    ctx.arc(p.x, p.y, ringRadius, 0, Math.PI * 2);
    ctx.lineWidth = ringWidth + size(2);
    ctx.strokeStyle = 'rgba(12, 13, 15, 0.55)';
    ctx.stroke();

    if (eventIsPending(ev)) {
      ctx.save();
      ctx.setLineDash([size(3), size(4)]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringRadius, 0, Math.PI * 2);
      ctx.lineWidth = ringWidth;
      ctx.strokeStyle = markerColor;
      ctx.stroke();
      ctx.restore();
    } else {
      // Heller Ring heißt: es ist jemand unterwegs. Der farbige Bogen zeigt,
      // wie viele davon angekommen sind.
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringRadius, 0, Math.PI * 2);
      ctx.lineWidth = ringWidth;
      ctx.strokeStyle = assigned > 0 ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.12)';
      ctx.stroke();

      if (arrived > 0 && assigned > 0) {
        const share = Math.min(1, arrived / assigned);
        ctx.save();
        ctx.lineCap = share < 1 ? 'round' : 'butt';
        ctx.beginPath();
        ctx.arc(p.x, p.y, ringRadius, -Math.PI / 2, -Math.PI / 2 + share * Math.PI * 2);
        ctx.lineWidth = ringWidth;
        ctx.strokeStyle = markerColor;
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, coreRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(19, 20, 23, 0.92)';
    ctx.fill();
    // Dünner Rand in der Kategoriefarbe, damit die Art auch bei leerem Ring trägt
    ctx.lineWidth = size(1);
    ctx.strokeStyle = markerColor;
    ctx.stroke();

    const eventIcon = input.eventIcon(markerKind);
    if (eventIcon) {
      const iconSize = coreRadius * 1.5;
      ctx.drawImage(eventIcon, p.x - iconSize / 2, p.y - iconSize / 2, iconSize, iconSize);
    }

    if (isHighlighted) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringRadius + size(5), 0, Math.PI * 2);
      ctx.lineWidth = size(1);
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
