export type MonitorGongId = 'soundxpro-fire-station';

export interface MonitorSoundSettings {
  gongEnabled: boolean;
  ttsEnabled: boolean;
  gong: MonitorGongId;
  volume: number;
}

export interface MonitorAnnouncementVehicle {
  gameVehicleId: string;
  displayName: string;
}

export const MONITOR_GONGS: ReadonlyArray<{ id: MonitorGongId; label: string; source: string }> = [
  {
    id: 'soundxpro-fire-station',
    label: 'Feuerwehr-Gong',
    source: './sounds/monitor/feuerwehr-gong-soundxpro.mp3',
  },
];

export const DEFAULT_MONITOR_SOUND_SETTINGS: MonitorSoundSettings = {
  gongEnabled: true,
  ttsEnabled: false,
  gong: 'soundxpro-fire-station',
  volume: 0.7,
};

const SETTINGS_KEY = 'alarmMonitorSound';
const TTS_ROOT = './sounds/monitor/tts-conrad';
const AUENBURG_MONITOR_CALLSIGNS = new Set([
  '1_DLK_1', '1_ELW_1', '1_GWAS_1', '1_HLF_1', '1_HLF_2', '1_KDOW_1', '1_KLAF_1', '1_RTW_A',
  '11_HLF_1', '11_TLF_1',
  '2_ELW_1', '2_HLF_1', '2_ITW_R', '2_KRAN_1', '2_NEF_A', '2_RTW_A', '2_RTW_Z', '2_RW_1',
  '2_TMF_1', '2_WLF_1',
  '3_DLK_1', '3_ELW_1', '3_GWW_1', '3_HLF_1', '3_RTW_A', '3_RTW_B', '3_TLF_1', '3_WLF_1',
  '31_GWL_1', '31_HLF_1',
  '4_ELW_1', '4_GWRH_1', '4_GWSAN_1', '4_HLF_1', '4_ITW_A', '4_KMB_1', '4_NEF_A', '4_NEF_K',
  '4_RTW_A', '4_RTW_B', '4_RTW_R', '4_WLF_1',
  '72_NEF_A', '72_RTW_A', '72_RTW_B', '74_NEF_A', '74_RTW_A', '74_RTW_B',
  'CHRISTOPH_82', 'CHRISTOPH_84', '0_KLB_1', '0_FLB_1',
]);

let activeAudio: HTMLAudioElement | null = null;
let finishActiveAudio: ((played: boolean) => void) | null = null;
let playbackToken = 0;

function clampVolume(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : DEFAULT_MONITOR_SOUND_SETTINGS.volume;
}

function isGong(value: unknown): value is MonitorGongId {
  return MONITOR_GONGS.some((gong) => gong.id === value);
}

export function loadMonitorSoundSettings(storage: Pick<Storage, 'getItem'> = localStorage): MonitorSoundSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_MONITOR_SOUND_SETTINGS };
    const saved = JSON.parse(raw) as Partial<MonitorSoundSettings>;
    return {
      gongEnabled: saved.gongEnabled !== false,
      ttsEnabled: saved.ttsEnabled === true,
      gong: isGong(saved.gong) ? saved.gong : DEFAULT_MONITOR_SOUND_SETTINGS.gong,
      volume: clampVolume(saved.volume),
    };
  } catch {
    return { ...DEFAULT_MONITOR_SOUND_SETTINGS };
  }
}

export function saveMonitorSoundSettings(
  settings: MonitorSoundSettings,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, volume: clampVolume(settings.volume) }));
}

export function monitorVehicleSpeechSources(gameVehicleId: string): string[] {
  const identifier = gameVehicleId.trim().toLocaleUpperCase('de').replaceAll('-', '_');
  if (!AUENBURG_MONITOR_CALLSIGNS.has(identifier)) return [];
  return [`${TTS_ROOT}/callsigns/${identifier.toLocaleLowerCase('de')}.mp3`];
}

export function monitorAnnouncementSources(vehicles: MonitorAnnouncementVehicle[]): string[] {
  const vehicleSources = vehicles
    .map((vehicle) => monitorVehicleSpeechSources(vehicle.gameVehicleId))
    .filter((sources) => sources.length > 0);
  if (!vehicleSources.length) return [];

  const result = [`${TTS_ROOT}/intro.mp3`];
  vehicleSources.forEach((sources) => result.push(...sources));
  return result;
}

function playSource(source: string, volume: number, token: number): Promise<boolean> {
  if (token !== playbackToken || typeof Audio === 'undefined') return Promise.resolve(false);

  return new Promise((resolve) => {
    const audio = new Audio(source);
    let finished = false;
    const finish = (played: boolean) => {
      if (finished) return;
      finished = true;
      audio.removeEventListener('ended', ended);
      audio.removeEventListener('error', failed);
      if (activeAudio === audio) activeAudio = null;
      if (finishActiveAudio === finish) finishActiveAudio = null;
      resolve(played);
    };
    const ended = () => finish(true);
    const failed = () => finish(false);

    audio.preload = 'auto';
    audio.volume = clampVolume(volume);
    audio.addEventListener('ended', ended, { once: true });
    audio.addEventListener('error', failed, { once: true });
    activeAudio = audio;
    finishActiveAudio = finish;
    void audio.play().catch(failed);
  });
}

async function playSources(sources: string[], volume: number, token: number): Promise<void> {
  for (const source of sources) {
    if (token !== playbackToken) return;
    if (!(await playSource(source, volume, token))) return;
  }
}

export function stopMonitorAlarm(): void {
  playbackToken += 1;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
  finishActiveAudio?.(false);
  finishActiveAudio = null;
}

export function playMonitorAlarm(
  vehicles: MonitorAnnouncementVehicle[],
  settings: MonitorSoundSettings,
): boolean {
  stopMonitorAlarm();
  const token = playbackToken;
  const gongSource = settings.gongEnabled
    ? MONITOR_GONGS.find((gong) => gong.id === settings.gong)?.source
    : undefined;
  const speechSources = settings.ttsEnabled ? monitorAnnouncementSources(vehicles) : [];
  const sources = [...(gongSource ? [gongSource] : []), ...speechSources];
  if (settings.volume <= 0 || !sources.length) return false;
  void playSources(sources, settings.volume, token);
  return true;
}

export function testMonitorAlarm(settings: MonitorSoundSettings): boolean {
  return playMonitorAlarm(
    [
      { gameVehicleId: '1_HLF_1', displayName: '1-HLF-1' },
      { gameVehicleId: '1_RTW_A', displayName: '1-RTW-A' },
    ],
    settings,
  );
}
