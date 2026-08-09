const phone = new Audio('./assets/phone.wav');
const alarm = new Audio('./assets/Alarm.wav');
const speechRequest = new Audio('./assets/sprechwunsch.mp3');

let enabled = true;
let volume = 0.7;

export function configureSounds(nextEnabled: boolean, nextVolume: number): void {
  enabled = nextEnabled;
  volume = Math.min(1, Math.max(0, nextVolume));
  phone.volume = volume;
  alarm.volume = volume;
  speechRequest.volume = volume;
}

async function play(sound: HTMLAudioElement, force = false): Promise<boolean> {
  if (!enabled && !force) return false;
  try {
    sound.pause();
    sound.currentTime = 0;
    sound.volume = volume;
    await sound.play();
    return true;
  } catch {
    return false;
  }
}

export const playPhone = (): Promise<boolean> => play(phone);
export const playAlarm = (): Promise<boolean> => play(alarm);
export const playSpeechRequest = (): Promise<boolean> => play(speechRequest);
export const testSound = (): Promise<boolean> => play(alarm, true);
