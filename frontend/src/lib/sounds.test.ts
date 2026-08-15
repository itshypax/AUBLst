import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Soundprofile', () => {
  it('lädt Profile, Vererbung und Warnzeiten aus dem Manifest', async () => {
    const play = vi.fn(async () => undefined);
    const audioSources: string[] = [];
    class AudioStub {
      volume = 1;
      currentTime = 0;
      constructor(source: string) { audioSources.push(source); }
      pause() {}
      play = play;
    }
    vi.stubGlobal('Audio', AudioStub);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: 7,
        default_profile: 'standard',
        profiles: [
          { id: 'standard', label: 'Standard', cues: { 'new-incident': 'assets/phone.wav' } },
          { id: 'jannik', label: 'Stimme Jannik', extends: 'standard', cues: { 'speech-request': 'sounds/Jannik/sprechwunsch.m4a' } },
        ],
        alerts: {
          unassigned_vehicle_exceptions: ['0_flb_1'],
          vehicle_c_timeout_seconds: 150,
          vehicle_c_timeout_overrides: { '1_test_1': 360 },
          speech_request_timeout_seconds: 180,
        },
      }),
    })));

    const sounds = await import('./sounds');
    expect(await sounds.loadSoundManifest()).toEqual([
      { id: 'standard', label: 'Standard' },
      { id: 'jannik', label: 'Stimme Jannik' },
    ]);
    expect(sounds.getSoundAlertConfig()).toMatchObject({
      unassignedVehicleExceptions: ['0_FLB_1'],
      vehicleCTimeoutSeconds: 150,
      vehicleCTimeoutOverrides: { '1_TEST_1': 360 },
      speechRequestTimeoutSeconds: 180,
    });

    sounds.configureSounds(true, 0.5, 'jannik');
    await sounds.playSoundCue('new-incident');
    await sounds.playSoundCue('speech-request');
    expect(audioSources).toEqual(['./assets/phone.wav?v=7', './sounds/Jannik/sprechwunsch.m4a?v=7']);
    expect(play).toHaveBeenCalledTimes(2);
  });
});
