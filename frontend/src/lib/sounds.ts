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
  | 'incident-completed'
  | 'bma-alarm';

export interface SoundProfileOption {
  id: string;
  label: string;
}

export interface SoundAlertConfig {
  unassignedVehicleStatuses: number[];
  unassignedVehicleExceptions: string[];
  vehicleCTimeoutSeconds: number;
  vehicleCTimeoutOverrides: Record<string, number>;
  speechRequestTimeoutSeconds: number;
}

interface RawSoundProfile {
  id?: unknown;
  label?: unknown;
  extends?: unknown;
  cues?: unknown;
  browser_titles?: unknown;
}

interface RawSoundManifest {
  version?: unknown;
  default_profile?: unknown;
  profiles?: unknown;
  alerts?: unknown;
}

interface CompiledSoundProfile extends SoundProfileOption {
  sources: Partial<Record<SoundCue, string | null>>;
  repeats: Partial<Record<SoundCue, number>>;
  browserTitles: BrowserTitleVariant[];
}

interface BrowserTitleVariant {
  text: string;
  chance: number;
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
  { id: 'bma-alarm', label: 'Brandmeldeanlage ausgelöst' },
];

const cueIds = new Set<SoundCue>(SOUND_CUES.map((cue) => cue.id));
const SAFE_PROFILE_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const SAFE_ASSET_SEGMENT = /^[A-Za-z0-9_. -]+$/;
const SUPPORTED_AUDIO = /\.(?:aac|m4a|mp3|oga|ogg|wav)$/i;
const DEFAULT_BROWSER_TITLE = 'Hier Leitstelle Auenburg';

const FALLBACK_STANDARD: CompiledSoundProfile = {
  id: 'standard',
  label: 'Standard',
  sources: {
    'new-incident': './assets/phone.wav',
    'radio-message': './assets/Alarm.wav',
    'speech-request': './assets/sprechwunsch.mp3',
  },
  repeats: {},
  browserTitles: [],
};

const DEFAULT_ALERT_CONFIG: SoundAlertConfig = {
  unassignedVehicleStatuses: [3, 4],
  unassignedVehicleExceptions: [],
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
const playbackTokens = new Map<SoundCue, number>();
let enabled = true;
let volume = 0.7;
let activeProfile = FALLBACK_STANDARD.id;
let titleProfile: string | null = null;

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveSeconds(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function repeatCount(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 10 ? number : fallback;
}

function isSilentSource(value: unknown): boolean {
  return value === null || safeString(value).toLocaleLowerCase('en-US') === 'none';
}

function browserTitles(value: unknown, inherited: BrowserTitleVariant[]): BrowserTitleVariant[] {
  if (!Array.isArray(value)) return inherited.map((variant) => ({ ...variant }));
  const variants: BrowserTitleVariant[] = [];
  let remainingChance = 1;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || remainingChance <= 0) continue;
    const raw = entry as Record<string, unknown>;
    const text = safeString(raw.text);
    const chance = Number(raw.chance);
    if (!text || text.length > 120 || !Number.isFinite(chance) || chance <= 0) continue;
    const acceptedChance = Math.min(chance, remainingChance);
    variants.push({ text, chance: acceptedChance });
    remainingChance -= acceptedChance;
  }
  return variants;
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
    const repeats = { ...(parent?.repeats ?? {}) };
    const titleVariants = browserTitles(entry.browser_titles, parent?.browserTitles ?? []);
    if (entry.cues && typeof entry.cues === 'object' && !Array.isArray(entry.cues)) {
      for (const [cue, definition] of Object.entries(entry.cues)) {
        if (!cueIds.has(cue as SoundCue)) continue;
        const cueId = cue as SoundCue;
        if (isSilentSource(definition)) {
          sources[cueId] = null;
          repeats[cueId] = 1;
        } else if (typeof definition === 'object' && !Array.isArray(definition)) {
          const options = definition as Record<string, unknown>;
          if (Object.hasOwn(options, 'file')) {
            if (isSilentSource(options.file)) sources[cueId] = null;
            else {
              const source = sourceUrl(options.file, raw.version);
              if (source) sources[cueId] = source;
            }
          }
          repeats[cueId] = repeatCount(options.repeat, repeats[cueId] ?? 1);
        } else {
          const source = sourceUrl(definition, raw.version);
          if (source) sources[cue as SoundCue] = source;
        }
      }
    }
    const profile = {
      id,
      label: safeString(entry.label) || id,
      sources,
      repeats,
      browserTitles: titleVariants,
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
  const exceptions = Array.isArray(alerts.unassigned_vehicle_exceptions)
    ? alerts.unassigned_vehicle_exceptions
      .map(safeString)
      .filter(Boolean)
      .map((vehicleId) => vehicleId.toUpperCase())
    : DEFAULT_ALERT_CONFIG.unassignedVehicleExceptions;
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
    unassignedVehicleExceptions: [...new Set(exceptions)],
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
    unassignedVehicleExceptions: [...alertConfig.unassignedVehicleExceptions],
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

function repeatsFor(cue: SoundCue): number {
  const profile = profiles.get(activeProfile) ?? profiles.get(defaultProfile) ?? FALLBACK_STANDARD;
  return profile.repeats[cue] ?? 1;
}

function applyBrowserTitle(profileId: string): void {
  if (typeof document === 'undefined') return;
  const profile = profiles.get(profileId) ?? profiles.get(defaultProfile) ?? FALLBACK_STANDARD;
  const roll = Math.random();
  let chance = 0;
  for (const variant of profile.browserTitles) {
    chance += variant.chance;
    if (roll < chance) {
      document.title = variant.text;
      return;
    }
  }
  document.title = DEFAULT_BROWSER_TITLE;
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
    for (const [cue, audio] of audioByCue) {
      playbackTokens.set(cue, (playbackTokens.get(cue) ?? 0) + 1);
      audio.onended = null;
      audio.pause();
    }
    audioByCue.clear();
    activeProfile = resolvedProfile;
  }
  if (titleProfile !== resolvedProfile) {
    applyBrowserTitle(resolvedProfile);
    titleProfile = resolvedProfile;
  }
  for (const audio of audioByCue.values()) audio.volume = volume;
}

export async function playSoundCue(cue: SoundCue, force = false): Promise<boolean> {
  if (!enabled && !force) return false;
  const audio = audioFor(cue);
  if (!audio) return false;
  const playable = audio;
  const token = (playbackTokens.get(cue) ?? 0) + 1;
  playbackTokens.set(cue, token);

  function queueNext(remaining: number): void {
    if (remaining <= 0) {
      playable.onended = null;
      return;
    }
    playable.onended = () => {
      if (playbackTokens.get(cue) !== token) return;
      playable.currentTime = 0;
      playable.volume = volume;
      void playable.play()
        .then(() => queueNext(remaining - 1))
        .catch(() => {
          if (playbackTokens.get(cue) === token) playable.onended = null;
        });
    };
  }

  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    queueNext(repeatsFor(cue) - 1);
    await audio.play();
    return true;
  } catch {
    if (playbackTokens.get(cue) === token) audio.onended = null;
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
