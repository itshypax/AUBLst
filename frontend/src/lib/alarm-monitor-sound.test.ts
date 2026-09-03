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
