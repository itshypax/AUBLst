import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MONITOR_SOUND_SETTINGS,
  loadMonitorSoundSettings,
  monitorAnnouncementSources,
  monitorVehicleSpeechSources,
} from './alarm-monitor-sound';

describe('Alarmmonitor-Ton', () => {
  it('verwendet den ausgewählten Feuerwehr-Gong als Standard', () => {
    expect(DEFAULT_MONITOR_SOUND_SETTINGS.gong).toBe('soundxpro-fire-station');
  });

  it('ersetzt eine nicht mehr angebotene gespeicherte Gongauswahl', () => {
    const settings = loadMonitorSoundSettings({
      getItem: () => JSON.stringify({ gong: 'short', gongEnabled: true, ttsEnabled: false, volume: 0.4 }),
    });

    expect(settings.gong).toBe('soundxpro-fire-station');
    expect(settings.volume).toBe(0.4);
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
