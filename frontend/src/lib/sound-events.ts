import { isSpeechRequest } from './speech-requests';
import { decodeEntities } from './text';
import type { SoundCue } from './sounds';
import type { LogRow } from './types';

function textOf(row: LogRow): string {
  return decodeEntities(`${row.message} ${row.long_message}`).toLocaleLowerCase('de-DE');
}

export function soundCueForLog(row: LogRow): SoundCue | null {
  if (isSpeechRequest(row)) return 'speech-request';
  const text = textOf(row);

  if (text.includes('rettungsmittelknappheit')) return 'resource-shortage';
  if (text.includes('alarmstufe') && !/(aufgehoben|reduziert|beendet|zurückgenommen)/.test(text)) {
    return 'alarm-level-increase';
  }

  const released = /(freigegeben|freigeben|freigabe|aufgehoben|wieder frei)/.test(text);
  const blocked = /(gesperrt|sperren|sperrung|eingestellt|einstellen)/.test(text);
  if (!released && !blocked) return null;

  if (/(schiffsverkehr|schiffverkehr)/.test(text)) return released ? 'ship-released' : 'ship-blocked';
  if (/(tramverkehr|straßenbahnverkehr|strassenbahnverkehr)/.test(text)) return released ? 'tram-released' : 'tram-blocked';
  if (/(zugverkehr|bahnverkehr|bahnstrecke|gleisverkehr|schienenverkehr)/.test(text)) return released ? 'train-released' : 'train-blocked';
  return null;
}

export function soundCuesForLogs(rows: LogRow[]): SoundCue[] {
  const cues: SoundCue[] = [];
  let hasUnclassified = false;
  for (const row of rows) {
    const cue = soundCueForLog(row);
    if (cue) {
      if (!cues.includes(cue)) cues.push(cue);
    } else {
      hasUnclassified = true;
    }
  }
  if (hasUnclassified && !cues.includes('speech-request') && !cues.includes('radio-message')) cues.push('radio-message');
  return cues;
}
