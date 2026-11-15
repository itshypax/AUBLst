import { describe, expect, it } from 'vitest';
import { controlRoomPath, isMonitorPath, monitorPath, monitorRequested, monitorUrl } from './app-url';

describe('Adressen der Leitstelle', () => {
  it('erkennt den Monitorpfad, auch im Unterordner', () => {
    expect(isMonitorPath('/monitor')).toBe(true);
    expect(isMonitorPath('/leitstelle/monitor/')).toBe(true);
    expect(isMonitorPath('/')).toBe(false);
    expect(isMonitorPath('/monitoring')).toBe(false);
  });

  it('baut Monitor- und Leitstellenpfad auseinander', () => {
    expect(monitorPath('/')).toBe('/monitor');
    expect(monitorPath('/leitstelle/index.html')).toBe('/leitstelle/monitor');
    expect(monitorPath('/leitstelle/monitor')).toBe('/leitstelle/monitor');
    expect(controlRoomPath('/leitstelle/monitor')).toBe('/leitstelle/');
    expect(controlRoomPath('/monitor')).toBe('/');
  });

  it('nimmt die alten Parameter weiter an', () => {
    expect(monitorRequested('?view=monitor', '/')).toBe(true);
    expect(monitorRequested('?monitor=1', '/')).toBe(true);
    expect(monitorRequested('', '/monitor')).toBe(true);
    expect(monitorRequested('?wache=1', '/')).toBe(false);
  });

  it('baut den Link auf den Monitor ohne die alten Parameter', () => {
    expect(monitorUrl(new URL('https://example.org/leitstelle/?view=monitor&session_token=abc'))).toBe(
      'https://example.org/leitstelle/monitor?session_token=abc',
    );
  });
});
