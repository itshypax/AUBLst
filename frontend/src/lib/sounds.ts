export type SoundCue =
  | 'new-incident'
  | 'radio-message'
  | 'speech-request'
  | 'alarm-level-increase'
  | 'resource-shortage'
  | 'ship-blocked'
  | 'ship-released'
  | 'tram-blocked'
  | 'tram-released'
  | 'train-blocked'
  | 'train-released'
  | 'incident-completed';

export const SOUND_CUES: ReadonlyArray<{ id: SoundCue; label: string; source: string | null }> = [
  { id: 'new-incident', label: 'Neuer Einsatz', source: './assets/phone.wav' },
  { id: 'radio-message', label: 'Funkmeldung', source: './assets/Alarm.wav' },
  { id: 'speech-request', label: 'Sprechwunsch', source: './assets/sprechwunsch.mp3' },
  { id: 'alarm-level-increase', label: 'Alarmstufenerhöhung', source: null },
  { id: 'resource-shortage', label: 'Rettungsmittelknappheit', source: null },
  { id: 'ship-blocked', label: 'Schiffsverkehr gesperrt', source: null },
  { id: 'ship-released', label: 'Schiffsverkehr freigegeben', source: null },
  { id: 'tram-blocked', label: 'Tramverkehr gesperrt', source: null },
  { id: 'tram-released', label: 'Tramverkehr freigegeben', source: null },
  { id: 'train-blocked', label: 'Zugverkehr gesperrt', source: null },
  { id: 'train-released', label: 'Zugverkehr freigegeben', source: null },
  { id: 'incident-completed', label: 'Einsatz abgeschlossen', source: null },
];

const cueById = new Map(SOUND_CUES.map((cue) => [cue.id, cue]));
const audioByCue = new Map<SoundCue, HTMLAudioElement>();
let enabled = true;
let volume = 0.7;

function audioFor(cue: SoundCue): HTMLAudioElement | null {
  const existing = audioByCue.get(cue);
  if (existing) return existing;
  const source = cueById.get(cue)?.source;
  if (!source) return null;
  const audio = new Audio(source);
  audio.volume = volume;
  audioByCue.set(cue, audio);
  return audio;
}

export function configureSounds(nextEnabled: boolean, nextVolume: number): void {
  enabled = nextEnabled;
  volume = Math.min(1, Math.max(0, nextVolume));
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
