export type SoundCue =
  | 'new-incident'
  | 'radio-message'
  | 'speech-request'
  | 'unassigned-vehicle-status-3'
  | 'unassigned-vehicle-status-4'
  | 'vehicle-c-timeout'
  | 'speech-request-timeout'
  | 'alarm-level-increase'
  | 'resource-shortage'
  | 'ship-blocked'
  | 'ship-released'
  | 'tram-blocked'
  | 'tram-released'
  | 'train-blocked'
  | 'train-released'
  | 'incident-completed';

export interface SoundProfileOption {
  id: string;
  label: string;
}

export interface SoundAlertConfig {
  unassignedVehicleStatuses: number[];
  vehicleCTimeoutSeconds: number;
  vehicleCTimeoutOverrides: Record<string, number>;
  speechRequestTimeoutSeconds: number;
}

interface RawSoundProfile {
  id?: unknown;
  label?: unknown;
  extends?: unknown;
  cues?: unknown;
}

interface RawSoundManifest {
  version?: unknown;
  default_profile?: unknown;
  profiles?: unknown;
  alerts?: unknown;
}

interface CompiledSoundProfile extends SoundProfileOption {
  sources: Partial<Record<SoundCue, string | null>>;
}

export const SOUND_CUES: ReadonlyArray<{ id: SoundCue; label: string }> = [
  { id: 'new-incident', label: 'Neuer Einsatz' },
  { id: 'radio-message', label: 'Funkmeldung' },
  { id: 'speech-request', label: 'Sprechwunsch' },
  { id: 'unassigned-vehicle-status-3', label: 'Fahrzeug ohne Einsatz in Status 3' },
  { id: 'unassigned-vehicle-status-4', label: 'Fahrzeug ohne Einsatz in Status 4' },
  { id: 'vehicle-c-timeout', label: 'Fahrzeug zu lange in C' },
  { id: 'speech-request-timeout', label: 'Sprechwunsch überfällig' },
  { id: 'alarm-level-increase', label: 'Alarmstufenerhöhung' },
  { id: 'resource-shortage', label: 'Rettungsmittelknappheit' },
  { id: 'ship-blocked', label: 'Schiffsverkehr gesperrt' },
  { id: 'ship-released', label: 'Schiffsverkehr freigegeben' },
  { id: 'tram-blocked', label: 'Tramverkehr gesperrt' },
  { id: 'tram-released', label: 'Tramverkehr freigegeben' },
  { id: 'train-blocked', label: 'Zugverkehr gesperrt' },
  { id: 'train-released', label: 'Zugverkehr freigegeben' },
  { id: 'incident-completed', label: 'Einsatz abgeschlossen' },
];

const cueIds = new Set<SoundCue>(SOUND_CUES.map((cue) => cue.id));
const SAFE_PROFILE_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const SAFE_ASSET_SEGMENT = /^[A-Za-z0-9_. -]+$/;
const SUPPORTED_AUDIO = /\.(?:aac|m4a|mp3|oga|ogg|wav)$/i;

const FALLBACK_STANDARD: CompiledSoundProfile = {
  id: 'standard',
  label: 'Standard',
  sources: {
    'new-incident': './assets/phone.wav',
    'radio-message': './assets/Alarm.wav',
    'speech-request': './assets/sprechwunsch.mp3',
  },
};

const DEFAULT_ALERT_CONFIG: SoundAlertConfig = {
  unassignedVehicleStatuses: [3, 4],
  vehicleCTimeoutSeconds: 120,
  vehicleCTimeoutOverrides: {},
  speechRequestTimeoutSeconds: 120,
};

let profiles = new Map<string, CompiledSoundProfile>([[FALLBACK_STANDARD.id, FALLBACK_STANDARD]]);
let profileOptions: SoundProfileOption[] = [{ id: FALLBACK_STANDARD.id, label: FALLBACK_STANDARD.label }];
let defaultProfile = FALLBACK_STANDARD.id;
let alertConfig: SoundAlertConfig = DEFAULT_ALERT_CONFIG;
let manifestPromise: Promise<SoundProfileOption[]> | null = null;
const audioByCue = new Map<SoundCue, HTMLAudioElement>();
let enabled = true;
let volume = 0.7;
let activeProfile = FALLBACK_STANDARD.id;

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveSeconds(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function sourceUrl(file: unknown, version: unknown): string | null {
  if (file === null) return null;
  const value = safeString(file).replace(/\\/g, '/');
  if (!value) return null;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '..' || !SAFE_ASSET_SEGMENT.test(segment))) return null;
  if (!SUPPORTED_AUDIO.test(segments.at(-1) ?? '')) return null;
  const path = segments.map(encodeURIComponent).join('/');
  const revision = typeof version === 'string' || typeof version === 'number'
    ? `?v=${encodeURIComponent(String(version))}`
    : '';
  return `./${path}${revision}`;
}

function rawProfiles(raw: RawSoundManifest): RawSoundProfile[] {
  return Array.isArray(raw.profiles)
    ? raw.profiles.filter((profile): profile is RawSoundProfile => Boolean(profile && typeof profile === 'object'))
    : [];
}

function compileProfiles(raw: RawSoundManifest): Map<string, CompiledSoundProfile> {
  const entries = rawProfiles(raw);
  const byId = new Map(entries
    .map((entry) => [safeString(entry.id), entry] as const)
    .filter(([id]) => SAFE_PROFILE_ID.test(id)));
  const compiled = new Map<string, CompiledSoundProfile>();

  function compile(id: string, stack = new Set<string>()): CompiledSoundProfile | null {
    if (compiled.has(id)) return compiled.get(id)!;
    if (stack.has(id)) return null;
    const entry = byId.get(id);
    if (!entry) return id === FALLBACK_STANDARD.id ? FALLBACK_STANDARD : null;
    stack.add(id);
    const parentId = safeString(entry.extends);
    const parent = parentId ? compile(parentId, stack) : id === FALLBACK_STANDARD.id ? FALLBACK_STANDARD : null;
    const sources = { ...(parent?.sources ?? {}) };
    if (entry.cues && typeof entry.cues === 'object' && !Array.isArray(entry.cues)) {
      for (const [cue, file] of Object.entries(entry.cues)) {
        if (!cueIds.has(cue as SoundCue)) continue;
        if (file === null) sources[cue as SoundCue] = null;
        else {
          const source = sourceUrl(file, raw.version);
          if (source) sources[cue as SoundCue] = source;
        }
      }
    }
    const profile = {
      id,
      label: safeString(entry.label) || id,
      sources,
    };
    compiled.set(id, profile);
    stack.delete(id);
    return profile;
  }

  for (const id of byId.keys()) compile(id);
  if (!compiled.has(FALLBACK_STANDARD.id)) compiled.set(FALLBACK_STANDARD.id, FALLBACK_STANDARD);
  return compiled;
}

function parseAlertConfig(raw: RawSoundManifest): SoundAlertConfig {
  if (!raw.alerts || typeof raw.alerts !== 'object' || Array.isArray(raw.alerts)) return DEFAULT_ALERT_CONFIG;
  const alerts = raw.alerts as Record<string, unknown>;
  const statuses = Array.isArray(alerts.unassigned_vehicle_statuses)
    ? alerts.unassigned_vehicle_statuses.map(Number).filter((status) => Number.isInteger(status) && status >= 0 && status <= 9)
    : DEFAULT_ALERT_CONFIG.unassignedVehicleStatuses;
  const overrides: Record<string, number> = {};
  if (alerts.vehicle_c_timeout_overrides && typeof alerts.vehicle_c_timeout_overrides === 'object' && !Array.isArray(alerts.vehicle_c_timeout_overrides)) {
    for (const [vehicleId, seconds] of Object.entries(alerts.vehicle_c_timeout_overrides)) {
      const key = vehicleId.trim().toUpperCase();
      const value = Number(seconds);
      if (key && Number.isFinite(value) && value >= 0) overrides[key] = value;
    }
  }
  return {
    unassignedVehicleStatuses: statuses.length ? [...new Set(statuses)] : DEFAULT_ALERT_CONFIG.unassignedVehicleStatuses,
    vehicleCTimeoutSeconds: positiveSeconds(alerts.vehicle_c_timeout_seconds, DEFAULT_ALERT_CONFIG.vehicleCTimeoutSeconds),
    vehicleCTimeoutOverrides: overrides,
    speechRequestTimeoutSeconds: positiveSeconds(alerts.speech_request_timeout_seconds, DEFAULT_ALERT_CONFIG.speechRequestTimeoutSeconds),
  };
}

export function getSoundProfileOptions(): SoundProfileOption[] {
  return profileOptions.map((profile) => ({ ...profile }));
}

export function getDefaultSoundProfile(): string {
  return defaultProfile;
}

export function getSoundAlertConfig(): SoundAlertConfig {
  return {
    ...alertConfig,
    unassignedVehicleStatuses: [...alertConfig.unassignedVehicleStatuses],
    vehicleCTimeoutOverrides: { ...alertConfig.vehicleCTimeoutOverrides },
  };
}

export async function loadSoundManifest(): Promise<SoundProfileOption[]> {
  if (manifestPromise) return manifestPromise;
  manifestPromise = (async () => {
    try {
      const response = await fetch('./sounds/manifest.json', { cache: 'no-store' });
      if (!response.ok) return getSoundProfileOptions();
      const parsed = await response.json() as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return getSoundProfileOptions();
      const raw = parsed as RawSoundManifest;
      profiles = compileProfiles(raw);
      profileOptions = [...profiles.values()].map(({ id, label }) => ({ id, label }));
      const requestedDefault = safeString(raw.default_profile);
      defaultProfile = profiles.has(requestedDefault) ? requestedDefault : FALLBACK_STANDARD.id;
      alertConfig = parseAlertConfig(raw);
      if (!profiles.has(activeProfile)) activeProfile = defaultProfile;
      audioByCue.clear();
    } catch {
      // Die eingebauten Standardtöne bleiben verfügbar.
    }
    return getSoundProfileOptions();
  })();
  return manifestPromise;
}

function sourceFor(cue: SoundCue): string | null {
  const profile = profiles.get(activeProfile) ?? profiles.get(defaultProfile) ?? FALLBACK_STANDARD;
  return profile.sources[cue] ?? null;
}

function audioFor(cue: SoundCue): HTMLAudioElement | null {
  const existing = audioByCue.get(cue);
  if (existing) return existing;
  const source = sourceFor(cue);
  if (!source) return null;
  const audio = new Audio(source);
  audio.volume = volume;
  audioByCue.set(cue, audio);
  return audio;
}

export function configureSounds(nextEnabled: boolean, nextVolume: number, nextProfile = defaultProfile): void {
  enabled = nextEnabled;
  volume = Math.min(1, Math.max(0, nextVolume));
  const resolvedProfile = profiles.has(nextProfile) ? nextProfile : defaultProfile;
  if (activeProfile !== resolvedProfile) {
    for (const audio of audioByCue.values()) audio.pause();
    audioByCue.clear();
    activeProfile = resolvedProfile;
  }
  for (const audio of audioByCue.values()) audio.volume = volume;
}

export async function playSoundCue(cue: SoundCue, force = false): Promise<boolean> {
  if (!enabled && !force) return false;
  const audio = audioFor(cue);
  if (!audio) return false;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

export async function playSoundCues(cues: SoundCue[]): Promise<void> {
  for (const cue of cues) await playSoundCue(cue);
}

export const playPhone = (): Promise<boolean> => playSoundCue('new-incident');
export const playAlarm = (): Promise<boolean> => playSoundCue('radio-message');
export const playSpeechRequest = (): Promise<boolean> => playSoundCue('speech-request');
export const testSound = (): Promise<boolean> => playSoundCue('radio-message', true);
