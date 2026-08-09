import { vi } from 'vitest';

class AudioStub {
  currentTime = 0;
  volume = 1;
  pause = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);
}

Object.defineProperty(globalThis, 'Audio', { value: AudioStub, configurable: true });
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:test-map'), configurable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
