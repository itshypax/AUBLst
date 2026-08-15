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
2. `backend/config.local.example.php` nach `backend/config.local.php` kopieren
   und dort die Zugangsdaten eintragen. Die lokale Datei wird von Git und vom
   Release-Paket ausgelassen.
3. Für den öffentlichen Betrieb in derselben Datei die Frontend-Adresse bei
   `CORS_ALLOW_ORIGIN` eintragen und `REQUIRE_SESSION_PIN` aktivieren.

Beim ersten Request legt das Backend Datenbank und Tabellen selbst an
(`backend/src/schema.sql`), sofern der DB-Benutzer die Rechte dazu hat.
Spätere Schemaänderungen laufen einmalig über die versionierten Migrationen.
Sessions ohne Aktivität werden nach einer Stunde automatisch aufgeräumt.
Wiederholte falsche Sitzungs- oder PIN-Eingaben werden vorübergehend gesperrt.

### Kartenbilder

Kartenbild als `backend/maps/<mod_id>.jpg` (oder `.png`/`.webp`) ablegen,
fertig. Der Upload per `mods_put` (Base64 in die Datenbank) funktioniert
weiterhin, Dateien haben aber Vorrang.

### Fahrzeuggrafiken

Fahrzeuggrafiken liegen unter `frontend/public/vehicles/<mod_id>/`. Die
`manifest.json` im jeweiligen Ordner ordnet Fahrzeuge und Typen den Bildern
zu. Submods können mit `extends` die Regeln ihres Hauptmods erben. Das Format
ist in `frontend/public/vehicles/README.md` beschrieben.

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

Ohne aktive Sitzung erscheint zuerst ein Verbindungsdialog für Token und PIN.
Später lässt sich die Sitzung weiterhin über die Kopfzeile wechseln. Die
Zugangsdaten bleiben nur für die aktuelle Browser-Sitzung gespeichert und
werden nach einem Aufruf über URL-Parameter sofort aus der Adresszeile entfernt.

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
- `POST api.php?action=session_validate` – Session und gegebenenfalls PIN prüfen
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

### Maßstab und Straßennetz

Ohne Kartenkalibrierung verwenden Entfernungen den EM4-Maßstab von `0,1 m` je
Spielkoordinate. Eine Routing-Datei kann stattdessen Texturbreite, Texturhöhe
und Pixel pro Meter enthalten. Das Backend rechnet diese Werte auf die von EM4
gelieferten Kartengrenzen um.

Für AUBMP sind `8192 × 8192 px` und `10,5 px/m` voreingestellt. Das entspricht
rund `780,2 × 780,2 m` beziehungsweise `0,609 km²`.
Landfahrzeuge fahren auf dem hinterlegten Netz. RTH, ITH, Christoph-Einheiten
und Boote verwenden immer die Luftlinie. Ohne passendes Netz, bei mehr als
300 Metern Abstand zur nächsten Straße oder zwischen getrennten Teilnetzen
zeigt die Leitstelle ausdrücklich `Luftlinie (Fallback)` an.

Der Straßeneditor läuft lokal ohne Sitzung und ohne PHP-Backend. Er ist nur in
der Entwicklungsumgebung über `localhost` oder `127.0.0.1` erreichbar; Zugriffe
über eine LAN-Adresse und Produktions-Builds enthalten keinen Editor. Nach
`npm run dev` wird die gewünschte Karte über ihre `mod_id` geöffnet:

```text
http://localhost:5173/?routing_editor=1&mod_id=AUBMP
```

Der Dev-Server lädt `backend/maps/AUBMP.png` und schreibt beim Speichern
`backend/maps/AUBMP.routing.json`. Der Editor zeigt auf Wunsch ein 50-Meter-
Raster. Ein Klick zeichnet, Ziehen auf freier Fläche verschiebt die Karte und
ein Punkt lässt sich per Drag versetzen. Straßenkreuzungen werden automatisch
verbunden. Brücken dürfen Straßen kreuzen und rasten nur an ihren Endpunkten
auf dem Straßennetz ein.

`Netz prüfen` sucht getrennte Teilnetze, Straßenkreuzungen ohne Knoten,
doppelte Abschnitte und Punkte außerhalb der Karte. Ausfahrten von Wachen und
Kliniken werden als kurze Straßenäste bis zum jeweiligen Fahrzeugstandort
eingezeichnet. Bei mehreren Hallen können mehrere Äste angelegt werden; das
Fahrzeug wird automatisch dem nächstgelegenen Ast zugeordnet.

Mit `Verbindung` wird nur der angeklickte Straßen- oder Brückenabschnitt
gelöscht. `Punkt` entfernt einen Knoten samt angeschlossenen Abschnitten. Die
Routenvorschau gehört ausschließlich zum Testmodus des lokalen Editors; im
aktiven Spielbetrieb werden keine Routen eingezeichnet.

Die Routing-Datei wird zusammen mit dem Kartenbild veröffentlicht. Bei einer
normalen Sitzung bildet das Backend die normalisierten Kartenpunkte auf die von
EM4 gelieferten Kartengrenzen ab. Der Graph ist in der Leitstelle unsichtbar und
wird dort nur für die Entfernungsberechnung geladen.

## Entwicklung

```bash
cd frontend
npm run dev      # Dev-Server mit Hot Reload
npm run check    # Typprüfung (svelte-check)
npm test         # Komponenten- und Zustandsprüfungen (Vitest)
npm run build    # Produktions-Build
```

Die Backend-Regeln für Fahrzeugstatus, Alarmierbarkeit, Klinikvormerkungen
und CORS haben einen kleinen Testlauf ohne zusätzliche Bibliotheken:

```bash
php backend/tests/run.php
```

### Manuelles Plesk-Release

Das Release-Skript prüft das Frontend, baut `dist` und legt ein ZIP mit genau
den beiden Plesk-Ordnern `backend/` und `frontend/` unter `.release/` ab:

```powershell
.\scripts\build-release.ps1
```

Ist PHP nicht als `php` verfügbar, kann der Pfad zur PHP-CLI mitgegeben werden:

```powershell
.\scripts\build-release.ps1 -PhpPath "C:\Pfad\zu\php.exe" -RequirePhp
```

`backend/config.local.php` wird nie in das ZIP kopiert. Die vorhandene
Produktionskonfiguration auf Plesk bleibt beim Hochladen damit erhalten.

## Credits

- Kartenbild: Antonym (Discord: `@ant_0nym`)
- Fahrzeugbilder: offizielles Auenburg-Handbuch

## Lizenz

Siehe [LICENSE](LICENSE).
