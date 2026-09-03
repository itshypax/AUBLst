import { eventCategory, type EventCategory } from './classify';
import type { MapBounds, SessionStatisticsResponse } from './types';

export interface StatisticValue {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface TimelineValue {
  label: string;
  value: number;
}

export interface VehicleUtilizationValue extends StatisticValue {
  unavailable: number;
}

export interface SessionStatisticsModel {
  token: string;
  createdAt: Date;
  generatedAt: Date;
  durationMs: number;
  eventCount: number;
  completedCount: number;
  dispatchCount: number;
  logCount: number;
  averageEventDurationMs: number | null;
  peakLabel: string;
  peakCount: number;
  categories: StatisticValue[];
  statuses: StatisticValue[];
  sources: StatisticValue[];
  timeline: TimelineValue[];
  vehicles: StatisticValue[];
  vehicleUtilization: VehicleUtilizationValue[];
  heatmapPoints: Array<{ x: number; y: number }>;
  mapBounds: MapBounds;
}

const CATEGORY_META: Record<EventCategory, { label: string; color: string }> = {
  fire: { label: 'Brand', color: '#e8524a' },
  hazard: { label: 'Gefahrgut', color: '#f0a03c' },
  water: { label: 'Wasser', color: '#2aa6b7' },
  thl: { label: 'Hilfeleistung', color: '#4c8dff' },
  medical: { label: 'Medizin', color: '#2ec98e' },
  other: { label: 'Sonstige', color: '#9a9da4' },
};

function parseDate(value: string): Date {
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function countValues<T extends string>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function timelineFor(data: SessionStatisticsResponse, start: Date, end: Date): TimelineValue[] {
  const duration = Math.max(1, end.getTime() - start.getTime());
  const minute = 60_000;
  const bucketSizes = [5, 15, 30, 60, 120, 240, 480, 720, 1440, 2880, 10_080, 43_200].map((minutes) => minutes * minute);
  const bucketMs = bucketSizes.find((size) => Math.ceil(duration / size) <= 12) ?? duration;
  const bucketCount = Math.min(12, Math.max(1, Math.ceil(duration / bucketMs)));
  const values = Array.from({ length: bucketCount }, () => 0);

  for (const event of data.events) {
    const time = parseDate(event.created_at).getTime();
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((time - start.getTime()) / bucketMs)));
    values[index] += 1;
  }

  const showDate = duration >= 86_400_000;
  return values.map((value, index) => {
    const date = new Date(start.getTime() + index * bucketMs);
    const label = showDate
      ? date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
      : date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return { label, value };
  });
}

export function buildSessionStatistics(data: SessionStatisticsResponse): SessionStatisticsModel {
  const createdAt = parseDate(data.session.created_at);
  const generatedAt = parseDate(data.session.generated_at);
  const categoryCounts = countValues(data.events.map((event) => eventCategory(event.name)));
  const statusCounts = countValues(data.events.map((event) => event.status));
  const sourceCounts = countValues(data.events.map((event) => event.created_by));
  const vehicleCounts = new Map<string, { label: string; value: number }>();

  for (const dispatch of data.dispatches) {
    const key = dispatch.game_vehicle_id || dispatch.vehicle_name;
    const current = vehicleCounts.get(key);
    vehicleCounts.set(key, {
      label: dispatch.vehicle_name || dispatch.game_vehicle_id || 'Unbekannt',
      value: (current?.value ?? 0) + 1,
    });
  }

  const completedDurations = data.events
    .filter((event) => event.status === 'completed')
    .map((event) => parseDate(event.updated_at).getTime() - parseDate(event.created_at).getTime())
    .filter((duration) => duration >= 0);
  const timeline = timelineFor(data, createdAt, generatedAt);
  const peak = timeline.reduce((best, item) => item.value > best.value ? item : best, timeline[0] ?? { label: '–', value: 0 });
  const sessionDuration = Math.max(1, generatedAt.getTime() - createdAt.getTime());
  const statusByVehicle = new Map<string, { label: string; entries: Array<{ status: number; time: number }> }>();
  for (const row of data.status_history ?? []) {
    const key = row.game_vehicle_id || row.vehicle_name || 'Unbekannt';
    const entry = statusByVehicle.get(key) ?? { label: row.vehicle_name || key, entries: [] };
    if (row.vehicle_name) entry.label = row.vehicle_name;
    entry.entries.push({ status: Number(row.status), time: parseDate(row.created_at).getTime() });
    statusByVehicle.set(key, entry);
  }

  const vehicleUtilization = [...statusByVehicle.entries()].flatMap(([key, entry]) => {
    let effectiveStatus: number | null = null;
    let intervalStart: number | null = null;
    let busyMs = 0;
    let unavailableMs = 0;

    const finishInterval = (end: number): void => {
      if (effectiveStatus === null || intervalStart === null || end <= intervalStart) return;
      const duration = end - intervalStart;
      if ([3, 4, 7, 8].includes(effectiveStatus)) busyMs += duration;
      else if (effectiveStatus === 6) unavailableMs += duration;
    };

    for (const statusEntry of entry.entries.sort((a, b) => a.time - b.time)) {
      if (![1, 2, 3, 4, 6, 7, 8].includes(statusEntry.status)) continue;
      if (statusEntry.time > generatedAt.getTime()) break;
      const time = Math.max(createdAt.getTime(), statusEntry.time);
      finishInterval(time);
      effectiveStatus = statusEntry.status;
      intervalStart = time;
    }
    finishInterval(generatedAt.getTime());

    if (busyMs === 0 && unavailableMs === 0) return [];
    const busyPercent = Math.min(100, Math.round(busyMs / sessionDuration * 100));
    const unavailablePercent = Math.min(100 - busyPercent, Math.round(unavailableMs / sessionDuration * 100));
    return [{
      key,
      label: entry.label,
      value: busyPercent,
      unavailable: unavailablePercent,
      color: '#2aa6b7',
    }];
  }).sort((a, b) => b.value - a.value || b.unavailable - a.unavailable || a.label.localeCompare(b.label, 'de', { numeric: true })).slice(0, 8);

  return {
    token: data.session.token,
    createdAt,
    generatedAt,
    durationMs: Math.max(0, generatedAt.getTime() - createdAt.getTime()),
    eventCount: data.events.length,
    completedCount: statusCounts.get('completed') ?? 0,
    dispatchCount: data.dispatches.length,
    logCount: Number(data.log_count) || 0,
    averageEventDurationMs: completedDurations.length
      ? completedDurations.reduce((sum, duration) => sum + duration, 0) / completedDurations.length
      : null,
    peakLabel: peak.label,
    peakCount: peak.value,
    categories: (Object.keys(CATEGORY_META) as EventCategory[]).map((key) => ({
      key,
      label: CATEGORY_META[key].label,
      value: categoryCounts.get(key) ?? 0,
      color: CATEGORY_META[key].color,
    })),
    statuses: [
      { key: 'completed', label: 'Abgeschlossen', value: statusCounts.get('completed') ?? 0, color: '#2ec98e' },
      { key: 'active', label: 'Laufend', value: statusCounts.get('active') ?? 0, color: '#f0a03c' },
      { key: 'canceled', label: 'Abgebrochen', value: statusCounts.get('canceled') ?? 0, color: '#e8524a' },
    ],
    sources: [
      { key: 'game', label: 'Aus EM4', value: sourceCounts.get('game') ?? 0, color: '#9a9da4' },
      { key: 'frontend', label: 'Leitstelle', value: sourceCounts.get('frontend') ?? 0, color: '#4c8dff' },
    ],
    timeline,
    vehicles: [...vehicleCounts.entries()]
      .map(([key, value]) => ({ key, ...value, color: '#4c8dff' }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'de', { numeric: true }))
      .slice(0, 8),
    vehicleUtilization,
    heatmapPoints: data.events
      .map((event) => ({ x: Number(event.x), y: Number(event.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    mapBounds: data.session.map_bounds ?? { min_x: 0, min_y: 0, max_x: 1000, max_y: 1000 },
  };
}

export function formatStatisticDuration(milliseconds: number | null): string {
  if (milliseconds === null) return '–';
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days} T ${hours} Std.`;
  if (hours) return `${hours} Std. ${minutes} Min.`;
  return `${minutes} Min.`;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius = 8): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
  ctx.stroke();
}

function drawSection(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, title: string): void {
  ctx.fillStyle = '#151619';
  ctx.strokeStyle = '#34373c';
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, width, height);
  ctx.fillStyle = '#e9eaec';
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.fillText(title, x + 24, y + 36);
}

function drawHorizontalBars(
  ctx: CanvasRenderingContext2D,
  values: StatisticValue[],
  x: number,
  y: number,
  width: number,
  rowHeight: number,
): void {
  const max = Math.max(1, ...values.map((item) => item.value));
  values.forEach((item, index) => {
    const rowY = y + index * rowHeight;
    ctx.fillStyle = '#b9bcc2';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(item.label, x, rowY + 17);
    ctx.fillStyle = '#27292d';
    ctx.fillRect(x + 190, rowY, width - 235, 20);
    ctx.fillStyle = item.color;
    ctx.fillRect(x + 190, rowY, (width - 235) * (item.value / max), 20);
    ctx.fillStyle = '#e9eaec';
    ctx.textAlign = 'right';
    ctx.fillText(String(item.value), x + width, rowY + 17);
    ctx.textAlign = 'left';
  });
}

function drawVehicleUtilizationBars(
  ctx: CanvasRenderingContext2D,
  values: VehicleUtilizationValue[],
  x: number,
  y: number,
  width: number,
  rowHeight: number,
): void {
  values.forEach((item, index) => {
    const rowY = y + index * rowHeight;
    const trackX = x + 190;
    const trackWidth = width - 275;
    ctx.fillStyle = '#b9bcc2';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(item.label, x, rowY + 17);
    ctx.fillStyle = '#27292d';
    ctx.fillRect(trackX, rowY, trackWidth, 20);
    ctx.fillStyle = item.color;
    ctx.fillRect(trackX, rowY, trackWidth * (item.value / 100), 20);
    ctx.fillStyle = '#697281';
    ctx.fillRect(trackX + trackWidth * (item.value / 100), rowY, trackWidth * (item.unavailable / 100), 20);
    ctx.fillStyle = '#e9eaec';
    ctx.textAlign = 'right';
    ctx.fillText(`${item.value}% / ${item.unavailable}%`, x + width, rowY + 17);
    ctx.textAlign = 'left';
  });
}

function drawTimeline(ctx: CanvasRenderingContext2D, values: TimelineValue[], x: number, y: number, width: number, height: number): void {
  const max = Math.max(1, ...values.map((item) => item.value));
  const gap = 10;
  const barWidth = Math.max(8, (width - gap * Math.max(0, values.length - 1)) / Math.max(1, values.length));
  values.forEach((item, index) => {
    const barHeight = (height - 38) * (item.value / max);
    const barX = x + index * (barWidth + gap);
    const barTop = y + height - 38 - barHeight;
    ctx.fillStyle = '#27292d';
    ctx.fillRect(barX, y, barWidth, height - 38);
    ctx.fillStyle = '#4c8dff';
    ctx.fillRect(barX, barTop, barWidth, barHeight);
    ctx.fillStyle = '#9a9da4';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(item.label, barX + barWidth / 2, y + height - 12);
    if (item.value) {
      ctx.fillStyle = '#e9eaec';
      ctx.fillText(String(item.value), barX + barWidth / 2, Math.max(y + 16, barTop - 10));
    }
  });
  ctx.textAlign = 'left';
}

export async function exportSessionStatisticsPng(model: SessionStatisticsModel): Promise<void> {
  const categoryRowHeight = model.categories.length > 1
    ? Math.max(24, Math.min(56, 235 / (model.categories.length - 1)))
    : 56;
  const frequentVehicleRows = Math.min(5, model.vehicles.length);
  const frequentVehicleHeight = Math.max(150, 88 + Math.max(0, frequentVehicleRows - 1) * 28);
  const frequentVehicleY = 1098;
  const footerY = frequentVehicleY + frequentVehicleHeight + 52;

  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = footerY + 40;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PNG konnte nicht erstellt werden');

  ctx.fillStyle = '#101113';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e9eaec';
  ctx.font = '700 42px system-ui, sans-serif';
  ctx.fillText('Session-Statistik', 64, 72);
  ctx.fillStyle = '#9a9da4';
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillText(`Sitzung ${model.token} · ${model.createdAt.toLocaleString('de-DE')} bis ${model.generatedAt.toLocaleString('de-DE')}`, 64, 108);

  const metrics = [
    ['Einsätze', model.eventCount],
    ['Abgeschlossen', model.completedCount],
    ['Alarmierungen', model.dispatchCount],
    ['Funkmeldungen', model.logCount],
    ['Ø Einsatzdauer', formatStatisticDuration(model.averageEventDurationMs)],
    ['Spitzenzeit', `${model.peakLabel} · ${model.peakCount}`],
  ] as const;
  metrics.forEach(([label, value], index) => {
    const x = 64 + (index % 3) * 498;
    const y = 142 + Math.floor(index / 3) * 116;
    ctx.fillStyle = '#17181b';
    ctx.strokeStyle = '#34373c';
    roundedRect(ctx, x, y, 470, 92);
    ctx.fillStyle = '#9a9da4';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(label, x + 22, y + 30);
    ctx.fillStyle = '#e9eaec';
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillText(String(value), x + 22, y + 70);
  });

  drawSection(ctx, 64, 390, 710, 318, 'Einsätze je Kategorie');
  drawHorizontalBars(ctx, model.categories, 88, 448, 660, categoryRowHeight);
  drawSection(ctx, 802, 390, 734, 318, 'Einsätze im Verlauf');
  drawTimeline(ctx, model.timeline, 830, 450, 678, 230);

  drawSection(ctx, 64, 738, 710, 330, 'Fahrzeugauslastung in Prozent');
  ctx.fillStyle = '#9a9da4';
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText('Im Einsatz / nicht verfügbar', 88, 785);
  drawVehicleUtilizationBars(ctx, model.vehicleUtilization.slice(0, 6), 88, 810, 660, 42);
  drawSection(ctx, 802, 738, 734, 330, 'Session');
  drawHorizontalBars(ctx, model.statuses, 830, 800, 650, 46);
  drawHorizontalBars(ctx, model.sources, 830, 950, 650, 46);
  ctx.fillStyle = '#9a9da4';
  ctx.font = '18px system-ui, sans-serif';
  ctx.fillText(`Dauer: ${formatStatisticDuration(model.durationMs)} · Spitzenzeit: ${model.peakLabel} (${model.peakCount})`, 830, 1045);

  drawSection(ctx, 64, frequentVehicleY, 1472, frequentVehicleHeight, 'Häufig alarmierte Fahrzeuge');
  drawHorizontalBars(ctx, model.vehicles.slice(0, 5), 88, 1154, 1400, 28);

  ctx.fillStyle = '#71747b';
  ctx.font = '16px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Erstellt mit game.aublst.de', 1536, footerY);
  ctx.textAlign = 'left';

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG konnte nicht erstellt werden')), 'image/png');
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `aublst-session-${model.token}-statistik.png`;
  link.click();
  URL.revokeObjectURL(url);
}
