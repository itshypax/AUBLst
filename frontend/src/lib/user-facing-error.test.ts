import { describe, expect, it } from 'vitest';
import { userFacingError } from './user-facing-error';

describe('userFacingError', () => {
  it('zeigt einen vorab bekannten Session-Code als wartend an', () => {
    const raw = 'Session not found. Waiting for initial sync.';

    expect(userFacingError(raw, 'state')).toEqual({
      title: 'Warte auf Spielstart',
      message: 'Der Session-Code ist gespeichert. Die Leitstelle verbindet sich automatisch, sobald das Spiel startet.',
    });
    expect(userFacingError(raw, 'logs').title).toBe('Funk noch nicht verfügbar');
  });

  it('gibt unbekannte Servertexte nicht an den Nutzer weiter', () => {
    const raw = 'PDOException: SQLSTATE[42S02] base table not found';
    const result = userFacingError(raw, 'state');

    expect(result.title).toBe('Daten konnten nicht geladen werden');
    expect(result.message).not.toContain('PDOException');
    expect(result.message).not.toContain('SQLSTATE');
  });

  it('übersetzt PIN- und Sperrfehler ohne Servertext', () => {
    expect(userFacingError('Unauthorized! The correct pin is required to execute this action.', 'state').title).toBe('PIN nicht akzeptiert');
    expect(userFacingError('Zu viele fehlgeschlagene Verbindungsversuche. Bitte später erneut versuchen.', 'state')).toEqual({
      title: 'Zu viele Versuche',
      message: 'Warte kurz und versuche die Verbindung danach erneut.',
    });
  });
});
