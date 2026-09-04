import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MONITOR_SOUND_SETTINGS,
  loadMonitorSoundSettings,
  MONITOR_GONGS,
  monitorAnnouncementSources,
  monitorVehicleSpeechSources,
} from './alarm-monitor-sound';

describe('Alarmmonitor-Ton', () => {
  it('verwendet den Gong Stuttgart als Standard', () => {
    expect(DEFAULT_MONITOR_SOUND_SETTINGS.gong).toBe('stuttgart');
  });

  it('bietet den Gong Hamburg als zusätzliche Auswahl an', () => {
    expect(MONITOR_GONGS).toContainEqual({
      id: 'hamburg',
      label: 'Gong Hamburg',
      source: './sounds/monitor/gong-hamburg.wav',
    });
    expect(DEFAULT_MONITOR_SOUND_SETTINGS.gong).toBe('stuttgart');
  });

  it('ersetzt eine nicht mehr angebotene gespeicherte Gongauswahl', () => {
    const settings = loadMonitorSoundSettings({
      getItem: () => JSON.stringify({ gong: 'short', gongEnabled: true, ttsEnabled: false, volume: 0.4 }),
    });

    expect(settings.gong).toBe('stuttgart');
    expect(settings.volume).toBe(0.4);
  });

  it('stellt eine alte gespeicherte Standardauswahl einmalig auf Stuttgart um', () => {
    const settings = loadMonitorSoundSettings({
      getItem: () => JSON.stringify({ gong: 'soundxpro-fire-station', volume: 0.6 }),
    });

    expect(settings.gong).toBe('stuttgart');
  });

  it('behält den bewusst ausgewählten bisherigen Feuerwehr-Gong bei', () => {
    const settings = loadMonitorSoundSettings({
      getItem: () => JSON.stringify({ gong: 'soundxpro-fire-station', volume: 0.6, version: 2 }),
    });

    expect(settings.gong).toBe('soundxpro-fire-station');
  });

  it('spricht die Fahrzeugkennung mit Anton aus der deutschen Buchstabiertafel', () => {
    expect(monitorVehicleSpeechSources('1_RTW_A')).toEqual([
      './sounds/monitor/tts-conrad/callsigns/1_rtw_a.mp3',
    ]);
  });

  it('erzeugt keine Ansage für frei erfundene Fahrzeugkombinationen', () => {
    expect(monitorVehicleSpeechSources('1_GRTW_Z')).toEqual([]);
  });

  it('verwendet die tatsächliche KMB-Kennung aus der Auenburg-Mod', () => {
    expect(monitorVehicleSpeechSources('4_KMB_1')).toEqual([
      './sounds/monitor/tts-conrad/callsigns/4_kmb_1.mp3',
    ]);
    expect(monitorVehicleSpeechSources('4_KMBD_1')).toEqual([]);
  });

  it('setzt mehrere Fahrzeugnamen ohne Verbindungswort zusammen', () => {
    expect(monitorAnnouncementSources([
      { gameVehicleId: '1_HLF_1', displayName: '1-HLF-1' },
      { gameVehicleId: '1_RTW_A', displayName: '1-RTW-A' },
    ])).toEqual([
      './sounds/monitor/tts-conrad/intro.mp3',
      './sounds/monitor/tts-conrad/callsigns/1_hlf_1.mp3',
      './sounds/monitor/tts-conrad/callsigns/1_rtw_a.mp3',
    ]);
  });
});

import { MONITOR_VOICES, saveMonitorSoundSettings } from './alarm-monitor-sound';

describe('Alarmmonitor-Stimme', () => {
  it('bietet Conrad und Marvin an und startet mit Conrad', () => {
    expect(MONITOR_VOICES.map((voice) => voice.id)).toEqual(['conrad', 'marvin']);
    expect(DEFAULT_MONITOR_SOUND_SETTINGS.voice).toBe('conrad');
  });

  it('spricht mit Marvin aus dem eigenen Ordner im m4a-Format', () => {
    expect(monitorVehicleSpeechSources('1_RTW_A', 'marvin')).toEqual([
      './sounds/monitor/tts-marvin/callsigns/1_rtw_a.m4a',
    ]);
    expect(monitorAnnouncementSources([{ gameVehicleId: '1_HLF_1', displayName: '1-HLF-1' }], 'marvin')).toEqual([
      './sounds/monitor/tts-marvin/intro.m4a',
      './sounds/monitor/tts-marvin/callsigns/1_hlf_1.m4a',
    ]);
  });

  it('merkt sich die gewählte Stimme und fällt bei Unbekanntem auf Conrad zurück', () => {
    let stored = '';
    saveMonitorSoundSettings(
      { ...DEFAULT_MONITOR_SOUND_SETTINGS, voice: 'marvin' },
      { setItem: (_key, value) => { stored = value; } },
    );
    expect(loadMonitorSoundSettings({ getItem: () => stored }).voice).toBe('marvin');
    expect(loadMonitorSoundSettings({ getItem: () => JSON.stringify({ voice: 'siri', version: 2 }) }).voice).toBe('conrad');
  });
});
