import { station, typeToken } from './classify';
import type { Vehicle } from './types';

export interface VehicleIconRule {
  game_vehicle_id?: string;
  type?: string;
  stations?: string[];
  file: string;
}

export interface VehicleIconManifest {
  modId: string;
  rules: Array<VehicleIconRule & { src: string }>;
}

interface RawVehicleIconManifest {
  version?: string | number;
  extends?: string | null;
  icons?: VehicleIconRule[];
}

const MAX_INHERITANCE_DEPTH = 8;
const SAFE_MOD_ID = /^[A-Za-z0-9_.-]{1,255}$/;
const SAFE_ASSET_SEGMENT = /^[A-Za-z0-9_. -]+$/;
const SUPPORTED_IMAGE = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

function upper(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().toUpperCase()
    : '';
}

function assetUrl(modId: string, file: string, version?: string | number): string | null {
  const segments = file.replace(/\\/g, '/').split('/');
  if (!segments.length || segments.some((segment) => !segment || segment === '..' || !SAFE_ASSET_SEGMENT.test(segment))) return null;
  if (!SUPPORTED_IMAGE.test(segments.at(-1) ?? '')) return null;
  const path = segments.map(encodeURIComponent).join('/');
  const revision = version === undefined ? '' : `?v=${encodeURIComponent(String(version))}`;
  return `./vehicles/${encodeURIComponent(modId)}/${path}${revision}`;
}

function parseRules(modId: string, manifest: RawVehicleIconManifest): VehicleIconManifest['rules'] {
  if (!Array.isArray(manifest.icons)) return [];
  const version = typeof manifest.version === 'string' || typeof manifest.version === 'number'
    ? manifest.version
    : undefined;
  return manifest.icons.flatMap((rule) => {
    if (!rule || typeof rule !== 'object' || typeof rule.file !== 'string') return [];
    const src = assetUrl(modId, rule.file, version);
    if (!src) return [];
    const gameVehicleId = upper(rule.game_vehicle_id);
    const type = upper(rule.type);
    const stations = Array.isArray(rule.stations) ? rule.stations.map(upper).filter(Boolean) : [];
    if (!gameVehicleId && !type && !stations.length) return [];
    return [{
      ...(gameVehicleId ? { game_vehicle_id: gameVehicleId } : {}),
      ...(type ? { type } : {}),
      ...(stations.length ? { stations } : {}),
      file: rule.file,
      src,
    }];
  });
}

async function loadManifest(
  modId: string,
  visited: Set<string>,
  depth: number,
): Promise<VehicleIconManifest['rules'] | null> {
  if (!SAFE_MOD_ID.test(modId) || visited.has(modId) || depth >= MAX_INHERITANCE_DEPTH) return null;
  visited.add(modId);

  let response: Response;
  try {
    response = await fetch(`./vehicles/${encodeURIComponent(modId)}/manifest.json`, { cache: 'no-store' });
  } catch {
    return null;
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    console.warn(`Fahrzeuggrafik-Manifest für ${modId} konnte nicht geladen werden (${response.status}).`);
    return null;
  }

  let raw: RawVehicleIconManifest;
  try {
    const parsed = await response.json() as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('invalid manifest');
    raw = parsed as RawVehicleIconManifest;
  } catch {
    console.warn(`Fahrzeuggrafik-Manifest für ${modId} enthält kein gültiges JSON.`);
    return null;
  }

  const ownRules = parseRules(modId, raw);
  const parentId = typeof raw.extends === 'string' ? raw.extends.trim() : '';
  if (!parentId) return ownRules;
  if (!SAFE_MOD_ID.test(parentId)) {
    console.warn(`Fahrzeuggrafik-Manifest für ${modId} hat eine ungültige extends-Angabe.`);
    return ownRules;
  }
  const parentRules = await loadManifest(parentId, visited, depth + 1);
  return [...ownRules, ...(parentRules ?? [])];
}

export async function loadVehicleIconManifest(modId: string | null | undefined): Promise<VehicleIconManifest | null> {
  const normalizedModId = modId?.trim() ?? '';
  if (!SAFE_MOD_ID.test(normalizedModId)) return null;
  const rules = await loadManifest(normalizedModId, new Set(), 0);
  return rules === null ? null : { modId: normalizedModId, rules };
}

export function vehicleIconPath(v: Vehicle, manifest: VehicleIconManifest | null): string | null {
  if (!manifest) return null;
  const id = upper(v.game_vehicle_id);
  const vehicleType = upper(typeToken(v));
  const vehicleStation = upper(station(v));
  const rule = manifest.rules.find((candidate) => {
    if (candidate.game_vehicle_id && candidate.game_vehicle_id !== id) return false;
    if (candidate.type && candidate.type !== vehicleType) return false;
    if (candidate.stations?.length && !candidate.stations.includes(vehicleStation)) return false;
    return true;
  });
  return rule?.src ?? null;
}
