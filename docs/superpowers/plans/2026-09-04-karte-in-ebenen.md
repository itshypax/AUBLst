# Karte in Ebenen (A4) – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ziel:** Ein Zustandsupdate aus dem Spiel (jede Sekunde) zeichnet in der
Leitstellenkarte nur noch Einsätze und Fahrzeuge neu, nicht mehr das
8192-Pixel-Kartenbild samt Straßeneditor.

**Architektur:** `MapPanel.svelte` bekommt zwei übereinanderliegende
Canvas-Elemente. Das untere (Basis) enthält Kartenbild, Editor-Raster,
Straßen und BMA-Zonen; das obere (Marker) enthält Einsätze und Fahrzeuge.
Ein kleiner Scheduler in `lib/map-layers.ts` sammelt Ungültig-Markierungen
je Ebene und zeichnet pro Animation-Frame nur die betroffenen Ebenen. Das
Zeichnen der Marker wird als reine Funktion in dieselbe Datei ausgelagert,
damit es mit einem aufzeichnenden Fake-Context testbar ist.

**Tech Stack:** Svelte 5, TypeScript, Vitest (jsdom, `getContext` ist im
Test-Setup ein Stub, der `null` liefert).

## Globale Randbedingungen

- Keine Commits ohne Freigabe von Josua (Projektregel).
- Die Monitor-Karte (`AlarmMonitorMap.svelte`) ist DOM-basiert und bleibt
  unverändert.
- Verhalten für Nutzer unverändert: gleiche Darstellung, gleiche Bedienung,
  Editor funktioniert wie bisher.
- Nach jedem Task: `npx vitest run`, `npm run check`, `npx eslint .`.

---

### Task 1: Scheduler für Ebenen

**Files:**
- Create: `frontend/src/lib/map-layers.ts`
- Test: `frontend/src/lib/map-layers.test.ts`

**Interfaces:**
- Produces: `type MapLayer = 'base' | 'markers'`;
  `class MapLayerScheduler { constructor(draw: (layers: ReadonlySet<MapLayer>) => void, requestFrame?: (cb: () => void) => void); invalidate(...layers: MapLayer[]): void; drawNow(...layers: MapLayer[]): void; readonly pending: ReadonlySet<MapLayer> }`.
  `invalidate()` ohne Argument bedeutet alle Ebenen. `drawNow()` zeichnet
  sofort die genannten Ebenen plus alles, was noch aussteht, und leert die
  Warteschlange.

- [x] **Schritt 1: Fehlschlagenden Test schreiben**

```ts
import { describe, expect, it, vi } from 'vitest';
import { MapLayerScheduler } from './map-layers';

function fakeFrames() {
  const callbacks: Array<() => void> = [];
  return {
    request: (cb: () => void) => { callbacks.push(cb); },
    run: () => { const batch = callbacks.splice(0); batch.forEach((cb) => cb()); },
    count: () => callbacks.length,
  };
}

describe('Ebenen-Scheduler', () => {
  it('fasst mehrere Markierungen in einem Frame zusammen', () => {
    const frames = fakeFrames();
    const draw = vi.fn();
    const scheduler = new MapLayerScheduler(draw, frames.request);

    scheduler.invalidate('markers');
    scheduler.invalidate('markers');
    scheduler.invalidate('base');

    expect(frames.count()).toBe(1);
    frames.run();
    expect(draw).toHaveBeenCalledTimes(1);
    expect([...draw.mock.calls[0][0]].sort()).toEqual(['base', 'markers']);
  });

  it('zeichnet nur die Markerebene, wenn nur Marker ungültig sind', () => {
    const frames = fakeFrames();
    const draw = vi.fn();
    const scheduler = new MapLayerScheduler(draw, frames.request);

    scheduler.invalidate('markers');
    frames.run();

    expect([...draw.mock.calls[0][0]]).toEqual(['markers']);
  });

  it('ohne Argument sind alle Ebenen ungültig', () => {
    const frames = fakeFrames();
    const draw = vi.fn();
    const scheduler = new MapLayerScheduler(draw, frames.request);

    scheduler.invalidate();
    frames.run();

    expect([...draw.mock.calls[0][0]].sort()).toEqual(['base', 'markers']);
  });

  it('drawNow zeichnet sofort und verwirft den ausstehenden Frame', () => {
    const frames = fakeFrames();
    const draw = vi.fn();
    const scheduler = new MapLayerScheduler(draw, frames.request);

    scheduler.invalidate('markers');
    scheduler.drawNow('base');

    expect(draw).toHaveBeenCalledTimes(1);
    expect([...draw.mock.calls[0][0]].sort()).toEqual(['base', 'markers']);
    frames.run();
    expect(draw).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Schritt 2: Test laufen lassen, Fehler erwartet**

Run: `npx vitest run src/lib/map-layers.test.ts`
Erwartet: FAIL, Modul `./map-layers` nicht gefunden.

- [x] **Schritt 3: Minimale Umsetzung**

```ts
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
```

- [x] **Schritt 4: Test laufen lassen, grün erwartet**

Run: `npx vitest run src/lib/map-layers.test.ts`

---

### Task 2: Markerebene als reine Funktion

**Files:**
- Modify: `frontend/src/lib/map-layers.ts`
- Test: `frontend/src/lib/map-layers.test.ts`

**Interfaces:**
- Consumes: `worldToCanvas`, `MapView`, `Point` aus `lib/mapview`; `EventItem`, `Vehicle`, `MapBounds` aus `lib/types`.
- Produces:

```ts
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
  vehicleIcon: (vehicle: Vehicle) => (CanvasImageSource & { naturalWidth: number; naturalHeight: number }) | null;
  statusColor: (status: number | string) => string;
  statusText: (status: number | string) => string;
  vehicleOutline: string;
}
export function drawMarkerLayer(ctx: CanvasRenderingContext2D, input: MarkerLayerInput): void;
```

Die Funktion erwartet einen Context, dessen Transformation bereits auf
`pan`/`zoom` steht (wie heute in `render()`), und zeichnet exakt das, was
heute die Blöcke "for (const ev of visibleEvents)" und "for (const veh of
vehiclesToRender)" in `MapPanel.svelte` zeichnen.

- [x] **Schritt 1: Fehlschlagenden Test schreiben**

```ts
function recordingContext() {
  const calls: string[] = [];
  const handler: ProxyHandler<object> = {
    get: (_target, key) => {
      if (typeof key !== 'string') return undefined;
      return (...args: unknown[]) => { calls.push(`${key}(${args.map((a) => (typeof a === 'object' ? 'obj' : String(a))).join(',')})`); };
    },
    set: () => true,
  };
  return { ctx: new Proxy({}, handler) as unknown as CanvasRenderingContext2D, calls };
}

const bounds = { min_x: 0, min_y: 0, max_x: 1000, max_y: 500 };
const view: MapView = { width: 1000, height: 500, natural: { w: 1000, h: 500 }, zoom: 1, pan: { x: 0, y: 0 } };
const icon = { naturalWidth: 40, naturalHeight: 20 } as unknown as CanvasImageSource & { naturalWidth: number; naturalHeight: number };

function baseInput(overrides: Partial<MarkerLayerInput> = {}): MarkerLayerInput {
  return {
    events: [],
    vehicles: [],
    bounds,
    view,
    highlightedEventId: null,
    highlightedVehicleId: null,
    eventMarkerKind: () => 'fire',
    eventColor: () => '#f00',
    eventIcon: () => null,
    vehicleIcon: () => icon,
    statusColor: () => '#0f0',
    statusText: (status) => String(status),
    vehicleOutline: '#fff',
    ...overrides,
  };
}

describe('Markerebene', () => {
  it('zeichnet je Fahrzeug mit Grafik ein Bild und ein Statusquadrat', () => {
    const { ctx, calls } = recordingContext();
    drawMarkerLayer(ctx, baseInput({ vehicles: [vehicle(1, 100, -100), vehicle(2, 200, -200)] }));
    expect(calls.filter((c) => c.startsWith('drawImage(')).length).toBe(2);
    expect(calls.filter((c) => c.startsWith('fillRect(')).length).toBe(2);
    expect(calls.filter((c) => c.startsWith('fillText('))).toEqual(['fillText(4,...)', ...]);
  });

  it('zeichnet Fahrzeuge ohne Grafik als Raute', () => {
    const { ctx, calls } = recordingContext();
    drawMarkerLayer(ctx, baseInput({ vehicles: [vehicle(1, 100, -100)], vehicleIcon: () => null }));
    expect(calls.filter((c) => c.startsWith('drawImage(')).length).toBe(0);
    expect(calls.filter((c) => c.startsWith('lineTo(')).length).toBe(3);
  });

  it('zeichnet das hervorgehobene Fahrzeug zuletzt', () => { ... });

  it('zeichnet je Einsatz einen Kreis und bei Hervorhebung einen Ring', () => { ... });
});
```

(Die vollständigen Testkörper stehen in der Testdatei; oben ist die Form.)

- [x] **Schritt 2: Test laufen lassen, Fehler erwartet** (`drawMarkerLayer` nicht exportiert)
- [x] **Schritt 3: Marker-Code aus `render()` nach `drawMarkerLayer` verschieben**, Aufrufe der Komponente (`iconFor`, `eventIconFor`, `statusColor`, `eventColor`, `cssVar`) als Callbacks übergeben.
- [x] **Schritt 4: Tests grün**

---

### Task 3: Zwei Canvas-Elemente in `MapPanel.svelte`

**Files:**
- Modify: `frontend/src/components/MapPanel.svelte` (Zeilen 20-22, 199-250, 256-310, 1240-1613, 1645, CSS `canvas`)

**Interfaces:**
- Consumes: `MapLayerScheduler`, `drawMarkerLayer` aus Task 1 und 2.

- [x] **Schritt 1:** `canvas` durch `baseCanvas` und `markerCanvas` ersetzen. `view()` und alle `canvas.clientWidth`-Stellen nutzen `markerCanvas` (beide sind gleich groß).
- [x] **Schritt 2:** `resize()` setzt Größe beider Canvas und ruft `layers.drawNow()`.
- [x] **Schritt 3:** `render()` aufteilen in `renderBase()` (Kartenbild + Editor-Overlay) und `renderMarkers()` (`drawMarkerLayer`). `scheduleRender()` durch `layers.invalidate(...)` ersetzen:
  - Zustands-Effekt (`app.vehicles`, `app.events`, Hervorhebungen, Filter): `invalidate('markers')`
  - `app.mapBounds`, `app.mapContentRect`: `invalidate()` (beide Ebenen, weil sich die Projektion ändert)
  - Editor-Effekt: `invalidate('base')`
  - Kartenbild geladen / Manifest geladen: `invalidate('base')` bzw. `invalidate('markers')`
  - Pan, Zoom, Reset, Fokus, Tastatur, Wheel: `invalidate()`
  - Filter-Umschalter: `invalidate('markers')`
  - Icon-`onload`: `invalidate('markers')`, Event-Icon-`onload`: `invalidate('markers')`
- [x] **Schritt 4:** Template: zwei `<canvas>` hintereinander, CSS `canvas { position:absolute; inset:0 }` bleibt; das Marker-Canvas liegt durch die Reihenfolge oben. Pointer-Events laufen weiter über den Wrapper.
- [x] **Schritt 5:** `npx vitest run`, `npm run check`, `npx eslint .`, `npm run build`.
- [x] **Schritt 6:** Komponententest `MapPanel.test.ts`: rendert die Komponente mit Fake-`getContext` (aufzeichnender Context je Canvas), setzt `app.vehicles` neu und prüft, dass danach nur der Marker-Context gezeichnet hat und der Basis-Context kein `drawImage` bekommen hat.

---

### Task 4: Sichtprüfung

- [x] Sichtprüfung über den Dev-Endpunkt des Straßeneditors (`?routing_editor=1&mod_id=AUBMP`, ohne Backend): zwei Canvas gleicher Größe, Kartenbild mit Straßennetz und BMA-Zone, Pan und Zoom deckungsgleich, keine Konsolenfehler. Fahrzeuge und Einsätze sind ohne Backend nicht sichtbar; die Markerebene ist über `map-layers.test.ts` und `MapPanel.test.ts` abgedeckt.
