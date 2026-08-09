import { describe, expect, it } from 'vitest';
import { userFacingError } from './user-facing-error';

describe('userFacingError', () => {
  it('übersetzt eine fehlende Sitzung passend zum betroffenen Bereich', () => {
    const raw = 'Session not found. Initialize with action=sync first.';

    expect(userFacingError(raw, 'state')).toEqual({
      title: 'Sitzung nicht gefunden',
      message: 'Prüfe die Sitzungsnummer. Falls sie stimmt, starte die Sitzung einmal im Spiel.',
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
