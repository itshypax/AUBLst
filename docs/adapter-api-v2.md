# Adapter auf AUBLst API v2 umstellen

Die API v2 läuft parallel zur bisherigen PHP-API. Der Adapter kann deshalb schrittweise umgestellt werden; ältere Adapter bleiben über `/backend/api.php` funktionsfähig.

## Einstellungen und gespeicherte Sitzung

- `ApiEndpoint` künftig auf die Basis-URL `https://<host>/api/v2` setzen. `ApiActionParameter` und `ActionUrls` werden für v2 nicht mehr gebraucht.
- `SessionToken` aufteilen in:
  - `SessionId` (`Guid`) – technische Kennung in allen v2-URLs
  - `SessionCode` – vierstelliger Code für Leitstelle und Spieler
  - `BridgeAccessToken` – langes Bearer-Token, niemals anzeigen oder loggen
- `BridgeAccessToken` zusammen mit PIN und bisherigen Geheimnissen per DPAPI schützen. Die Durable Queue sollte `SessionId` statt des kurzen Sitzungscodes als Schlüssel verwenden.
- Die Frontend-URL zeigt künftig auf `/`. Beim Öffnen bleibt `session_token=<SessionCode>` erhalten. `api_base` darf für alte Adapter weiter auf `/backend/api.php` zeigen: Das Frontend löst den Sitzungscode einmal über `/api/v2/sessions/resolve/{code}` auf und schaltet bei Bridge-Protokoll 2 selbstständig auf API v2 um.

Für das Frontend gilt damit pro Sitzung:

- `legacy` oder Bridge-Protokoll 1: Lesen, Schreiben und Echtzeitkanal laufen über `/backend/api.php`.
- Bridge-Protokoll 2: Zustand, Aktionen, Karte, Routing und SSE laufen über `/api/v2`.

Das Bridge-Bearer-Token wird nie an Leitstelle oder Alarmmonitor weitergegeben. Diese senden den kurzen Sitzungscode und, falls gesetzt, die PIN in `X-Session-Code` und `X-Session-Pin`.
Wenn Frontend und API bei der lokalen Entwicklung auf getrennten Ports laufen, kann der Adapter zusätzlich `api_v2_base=http://127.0.0.1:8081/api/v2` an die Frontend-URL hängen. Im normalen Betrieb unter einer Domain ist der Parameter nicht nötig.

## HTTP-Client

Den Action-basierten Aufruf für v2 durch feste REST-Routen ersetzen:

| Zweck | Methode und Route |
| --- | --- |
| Fähigkeiten prüfen | `GET /api/v2/capabilities` |
| Sitzung erstellen | `POST /api/v2/sessions` |
| Sitzung/Token prüfen | `GET /api/v2/sessions/{sessionId}/bridge` |
| Spieldaten senden | `PUT /api/v2/sessions/{sessionId}/bridge/snapshot` |
| Bridge-Status senden | `PUT /api/v2/sessions/{sessionId}/bridge/heartbeat` |
| Befehle reservieren | `POST /api/v2/sessions/{sessionId}/commands/claim` |
| Befehle bestätigen | `POST /api/v2/sessions/{sessionId}/commands/ack` |
| Reservierung lösen | `POST /api/v2/sessions/{sessionId}/commands/release` |

Ab dem zweiten Aufruf wird immer `Authorization: Bearer <BridgeAccessToken>` gesendet. Fehler nicht mehr anhand deutscher Texte erkennen, sondern über HTTP-Status und das `type`-Feld der Problem-Details-Antwort (`application/problem+json`).

## Session-Erstellung

Der Create-Request enthält `modId`, optionale `pin` und `mapBounds` sowie:

```json
{
  "bridge": {
    "bridgeId": "bridge-...",
    "appVersion": "0.3.0",
    "protocolVersion": 2,
    "capabilities": ["durable-queue-v1"]
  }
}
```

Aus der Antwort müssen `session.id`, `session.code` und `bridge.accessToken` getrennt gespeichert werden. `AublstBridgeProtocol.ProtocolVersion` wird für den v2-Client auf `2` gesetzt.

## Snapshots

- Die bisherigen Rohdaten in typisierte camelCase-DTOs überführen (`gameVehicleId`, `gameHospitalId`, `gameEventId`, `entityId`, `longMessage`).
- Spieler als Liste `{ playerId, name }` senden, nicht mehr als JSON-Objekt mit dynamischen Schlüsseln.
- Jeder Snapshot bekommt eine streng steigende `sequence` und `capturedAt` in UTC.
- Bei Timeout denselben Snapshot mit derselben Sequenz erneut senden. Erst nach einer Antwort wird die nächste Sequenz vergeben. Das Backend ignoriert so bereits verarbeitete Wiederholungen.
- Nicht enthaltene Bereiche als `null` senden beziehungsweise weglassen; eine leere Liste bedeutet bewusst „keine Einträge“.

## Commands und Durable Queue

- `claim` liefert maximal 100 Befehle und je Charge ein `leaseToken`. Befehle sofort mit `SessionId` und `leaseToken` dauerhaft in der lokalen Queue sichern.
- Erst nach erfolgreichem Schreiben in `input.txt` über `ack` bestätigen.
- Kann ein Befehl nicht geschrieben werden, seine Reservierung über `release` lösen. Bei Prozessabbruch läuft die Reservierung nach spätestens 120 Sekunden selbst aus.
- `ack` und `release` akzeptieren nur Befehle, die genau von dieser Bridge mit demselben Lease-Token reserviert wurden. Damit können zwei Adapter denselben Befehl nicht gleichzeitig abarbeiten.

## Empfohlene Umstellung

1. Einen separaten `BridgeApiV2Client` neben `BridgeApiClient` anlegen.
2. Beim Start `/api/v2/capabilities` prüfen und v2 nur bei `bridgeProtocolVersion: 2` aktivieren; sonst den bisherigen Client verwenden.
3. Settings-Schema auf Version 3 migrieren und bestehende `SessionToken`-Werte als Legacy-Sitzung behandeln.
4. Snapshot-Sequenz, Lease-Token und neue Session-ID in Runtime und Durable Queue durchreichen.
5. Tests für Create/Resume, Timeout mit identischer Sequenz, abgelaufenes Lease, Ack nach Dateischreiben und Legacy-Fallback ergänzen.

Die OpenAPI-Beschreibung liegt zur Laufzeit unter `/api/v2/openapi.json` und sollte als Referenz für die DTOs verwendet werden.
