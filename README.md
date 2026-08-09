# AUBLst

Web-Leitstelle für Spiele: Das Spiel meldet Fahrzeuge, Einsätze, Krankenhäuser
und Funkmeldungen an den Server, ein Disponent alarmiert im Browser Fahrzeuge
und schickt die Befehle zurück ins Spiel. Kommunikation läuft komplett über
HTTP-Polling, es wird also kein Websocket-fähiges Hosting gebraucht.

Hervorgegangen aus [Floko122/EMDispatch](https://github.com/Floko122/EMDispatch) –
danke an Floko122 für die Grundlage.

## Aufbau

- `backend/` – PHP 8 + MySQL (PDO). `api.php` nimmt alle Requests entgegen,
  die Logik liegt unter `backend/src/`.
- `frontend/` – Leitstellen-Oberfläche, Svelte 5 + TypeScript + Vite.
  Der Build erzeugt statische Dateien.
- `backend/maps/` – Kartenbilder als Dateien, benannt nach der mod_id.

Jede Spielinstanz bekommt eine eigene Session (4-stelliger Token, optional
mit PIN gegen fremde Schreibzugriffe). Ein Server kann darum beliebig viele
Spiele gleichzeitig bedienen.

## Setup

### Backend

1. `backend/` auf einen PHP-fähigen Server legen.
2. Zugangsdaten in `backend/config.php` eintragen oder als Umgebungsvariablen
   setzen (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`).
3. Für den öffentlichen Betrieb `CORS_ALLOW_ORIGIN` einschränken.

Mehr braucht es nicht: Beim ersten Request legt das Backend Datenbank und
Tabellen selbst an (`backend/src/schema.sql`), sofern der DB-Benutzer die
Rechte dazu hat. Sessions ohne Aktivität werden nach einer Stunde
automatisch aufgeräumt.

### Kartenbilder

Kartenbild als `backend/maps/<mod_id>.jpg` (oder `.png`/`.webp`) ablegen,
fertig. Der Upload per `mods_put` (Base64 in die Datenbank) funktioniert
weiterhin, Dateien haben aber Vorrang.

### Frontend

```bash
cd frontend
npm install
npm run build
```

Beim Build wird die Kurz-ID des letzten Git-Commits in die Kopfzeile
geschrieben. Ein automatisches Deployment muss deshalb nach `git pull` auch
`npm run build` ausführen. Falls dort kein Git-Verzeichnis verfügbar ist,
kann die ID über `VITE_APP_COMMIT` gesetzt werden.

Den Inhalt von `frontend/dist/` neben den `backend/`-Ordner legen — als
Unterordner (z. B. `frontend/`) oder direkt ins Webroot neben `backend/`.
Die Oberfläche sucht die API standardmäßig unter `../backend/api.php`, was
in beiden Fällen passt; ein anderer Pfad lässt sich per URL-Parameter
`api_base` setzen.

Liegt die Oberfläche im Webroot, zeigt der Öffnen-Button des EMLstAdapters
weiter auf `/frontend` — dafür eine Weiterleitung von `/frontend` auf `/`
einrichten oder den Link im Adapter ignorieren.

Aufruf dann z. B.:

```text
https://example.org/leitstelle/?session_token=a1b2&pin=1234
```

Token und PIN lassen sich auch direkt in der Kopfzeile eintragen. Sie bleiben
nur für die aktuelle Browser-Sitzung gespeichert und werden nach einem Aufruf
über URL-Parameter sofort aus der Adresszeile entfernt.

### Fahrzeug-Gruppierung

Die Fahrzeugübersicht trennt Feuerwehr und Rettungsdienst per Tab und
gruppiert innerhalb der Tabs nach Wachen. Die Wache ist der Präfix der
Fahrzeug-ID (`1_HLF_1` → Wache 1), Rettungsmittel werden an ihren
Typkürzeln erkannt (RTW, NEF, ITW, …).

Einheiten ohne Kartenposition (Abschleppwagen, Bestatter, …) erscheinen
nicht in der Übersicht, bleiben aber im Alarmierungsfenster wählbar.
Aktions-Einheiten (`FS_LST_…`, z. B. Sperrungen) werden über die
Aktionen-Leiste im Fahrzeug-Panel ausgelöst statt über Einsätze.

Eigene Kürzel kommen in eine `groups.json` neben der `index.html`
(Vorlage: `frontend/public/groups.example.json`, kein Rebuild nötig):

```json
{
  "rettungsdienst": ["MZF"],
  "verstecken": ["KRAD"]
}
```

## API (Spiel → Server)

- `POST api.php?action=session_create` – neue Session anlegen (Antwort enthält Token)
- `POST api.php?action=sync` – Session initialisieren/aktualisieren
  (Kartengrenzen, Spieler, Fahrzeuge, Krankenhäuser, Einsätze, Meldungen, Uhrzeit)
- `POST api.php?action=update_vehicles` – Fahrzeugstatus/-position melden
- `POST api.php?action=update_hospitals` – Bettenbelegung melden
- `POST api.php?action=update_events` – Einsätze anlegen/aktualisieren
- `POST api.php?action=mods_put` – Kartenbild für eine Mod hochladen
  (optional, siehe Kartenbilder)
- `GET  api.php?action=commands_pending&session_token=…&last_id=0` – Befehle abholen
- `POST api.php?action=commands_ack` – Befehle quittieren (`{command_ids:[…]}`)

## API (Leitstelle → Server)

- `POST api.php?action=state` – kompletter Zustand
- `POST api.php?action=logs` – Funkmeldungen; Cursor über `since` und `since_id`
- `POST api.php?action=events_create` / `events_finish` / `events_assign` /
  `events_unassign` – Einsätze anlegen, abschließen, Fahrzeuge (de)alarmieren
- `POST api.php?action=events_get_vehicles` / `events_get_note` /
  `events_set_note` / `events_get_logs` – Details und Verlauf zum Einsatz
- `POST api.php?action=vehicles_assign_player` – Fahrzeug einem Spieler geben
- `POST api.php?action=vehicles_alarm` – Einheit ohne Einsatz alarmieren
  (für Aktionen wie Sperrungen; der Adapter erhält ein assign mit event_id -1)

Schreibende Leitstellen-Actions prüfen die Session-PIN, sofern eine gesetzt
ist. Befehle an das Spiel landen in der `commands`-Tabelle und werden per
`commands_pending`/`commands_ack` abgeholt – daran hat sich gegenüber
EMDispatch nichts geändert, bestehende Spielanbindungen laufen unverändert
weiter.

Manuell angelegte Einsatznamen bleiben in der Leitstelle unverändert. Im
`event_create`-Befehl für EM4 werden Umlaute ersetzt (`ä` → `ae`, `ö` → `oe`,
`ü` → `ue`, `ß` → `ss`). Bei Einsätzen aus EM4 wandelt die Leitstelle diese
Schreibweise für die Anzeige zurück, etwa `Sanitaetsdienst` zu `Sanitätsdienst`.

## Koordinaten

Das Spiel liefert Kartengrenzen (`min_x, min_y, max_x, max_y`). Die Karte
zeichnet das Kartenbild eingepasst (wie `object-fit: contain`), kann per Maus
verschoben und gezoomt werden. Rechtsklick legt einen Einsatz an der
angeklickten Weltkoordinate an.

Rechtsklick auf ein Fahrzeug (Liste oder Karte) öffnet ein Kontextmenü zum
Fokussieren auf der Karte, für Klinikzuweisungen und zum Einrücken. Der
FMS-Status kommt ausschließlich aus EM4 und lässt sich in der Leitstelle
nicht manuell überschreiben.

## Entwicklung

```bash
cd frontend
npm run dev      # Dev-Server mit Hot Reload
npm run check    # Typprüfung (svelte-check)
npm test         # Komponenten- und Zustandsprüfungen (Vitest)
npm run build    # Produktions-Build
```

## Credits

- Kartenbild: Antonym (Discord: `@ant_0nym`)
- Fahrzeugbilder: offizielles Auenburg-Handbuch

## Lizenz

Siehe [LICENSE](LICENSE).
