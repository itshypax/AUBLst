import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  document.title = '';
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

  it('spielt einen Ton so oft ab, wie es im Profil angegeben ist', async () => {
    const instances: AudioStub[] = [];
    class AudioStub {
      volume = 1;
      currentTime = 0;
      onended: (() => void) | null = null;
      play = vi.fn(async () => undefined);
      constructor(public source: string) { instances.push(this); }
      pause() {}
    }
    vi.stubGlobal('Audio', AudioStub);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        profiles: [{
          id: 'standard',
          label: 'Standard',
          cues: {
            'new-incident': { file: 'assets/phone.wav', repeat: 2 },
          },
        }],
      }),
    })));

    const sounds = await import('./sounds');
    await sounds.loadSoundManifest();
    await sounds.playSoundCue('new-incident');
    expect(instances[0].play).toHaveBeenCalledTimes(1);

    instances[0].onended?.();
    await Promise.resolve();
    expect(instances[0].play).toHaveBeenCalledTimes(2);

    instances[0].onended?.();
    await Promise.resolve();
    expect(instances[0].play).toHaveBeenCalledTimes(2);
  });

  it('deaktiviert einen geerbten Ton mit none', async () => {
    const audio = vi.fn();
    vi.stubGlobal('Audio', audio);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        profiles: [
          { id: 'standard', label: 'Standard', cues: { 'radio-message': 'none' } },
          { id: 'silent', label: 'Still', extends: 'standard', cues: { 'new-incident': { file: 'none', repeat: 2 } } },
        ],
      }),
    })));

    const sounds = await import('./sounds');
    await sounds.loadSoundManifest();
    sounds.configureSounds(true, 0.5, 'silent');

    expect(await sounds.playSoundCue('radio-message')).toBe(false);
    expect(await sounds.playSoundCue('new-incident')).toBe(false);
    expect(audio).not.toHaveBeenCalled();
  });

  it('wählt beim Profilwechsel einen Browser-Titel anhand seiner Chance', async () => {
    document.title = 'Hier Leitstelle Auenburg';
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        profiles: [
          { id: 'standard', label: 'Standard' },
          {
            id: 'jannik',
            label: 'Stimme Jannik',
            extends: 'standard',
            browser_titles: [{ text: 'Hier Leitstelle Goslar', chance: 0.05 }],
          },
        ],
      }),
    })));

    const sounds = await import('./sounds');
    await sounds.loadSoundManifest();
    sounds.configureSounds(true, 0.5, 'jannik');
    expect(document.title).toBe('Hier Leitstelle Goslar');
    expect(random).toHaveBeenCalledTimes(1);

    random.mockReturnValue(0.9);
    sounds.configureSounds(true, 0.7, 'jannik');
    expect(document.title).toBe('Hier Leitstelle Goslar');
    expect(random).toHaveBeenCalledTimes(1);

    sounds.configureSounds(true, 0.7, 'standard');
    expect(document.title).toBe('Hier Leitstelle Auenburg');
  });
});
