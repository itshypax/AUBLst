export type ErrorArea = 'state' | 'logs';

export interface UserFacingError {
  title: string;
  message: string;
}

export function userFacingError(raw: string, area: ErrorArea): UserFacingError {
  const error = raw.trim().toLocaleLowerCase('en-US');

  if (error.includes('session not found') || error.includes('initialize with action=sync')) {
    return area === 'state'
      ? {
          title: 'Sitzung nicht gefunden',
          message: 'Prüfe die Sitzungsnummer. Falls sie stimmt, starte die Sitzung einmal im Spiel.',
        }
      : {
          title: 'Funk noch nicht verfügbar',
          message: 'Funkmeldungen erscheinen, sobald das Spiel mit dieser Sitzung verbunden ist.',
        };
  }

  if (
    error.includes('pin') &&
    (error.includes('invalid') || error.includes('incorrect') || error.includes('wrong') || error.includes('correct pin') || error.includes('required'))
  ) {
    return {
      title: 'PIN nicht akzeptiert',
      message: 'Prüfe die eingegebene PIN und verbinde die Sitzung erneut.',
    };
  }

  if (error.includes('zu viele fehlgeschlagene') || error.includes('too many') || error.includes('429')) {
    return {
      title: 'Zu viele Versuche',
      message: 'Warte kurz und versuche die Verbindung danach erneut.',
    };
  }

  if (
    error.includes('server nicht erreichbar') ||
    error.includes('server antwortet nicht') ||
    error.includes('failed to fetch') ||
    error.includes('networkerror')
  ) {
    return area === 'state'
      ? {
          title: 'Server nicht erreichbar',
          message: 'Die Verbindung zur Leitstelle ist unterbrochen. Versuche es gleich noch einmal.',
        }
      : {
          title: 'Funkverbindung unterbrochen',
          message: 'Neue Funkmeldungen können gerade nicht abgerufen werden.',
        };
  }

  return area === 'state'
    ? {
        title: 'Daten konnten nicht geladen werden',
        message: 'Verbinde die Sitzung erneut. Bleibt das Problem bestehen, prüfe den Server.',
      }
    : {
        title: 'Funkmeldungen konnten nicht geladen werden',
        message: 'Versuche es gleich noch einmal.',
      };
}
