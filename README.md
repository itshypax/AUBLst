# AUBLst

Web-Leitstelle für Spiele: Das Spiel meldet Fahrzeuge, Einsätze, Krankenhäuser
und Funkmeldungen an den Server, ein Disponent alarmiert im Browser Fahrzeuge
und schickt die Befehle zurück ins Spiel. Änderungen werden über Server-Sent
Events gemeldet; regelmäßige HTTP-Abgleiche bleiben als Rückfall aktiv. Dafür
ist kein Websocket-Server nötig.

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
4. `APP_TIMEZONE` steht auf `Europe/Berlin` und gilt für PHP und jede
   Datenbankverbindung. Alle Zeitstempel werden in dieser Zone gespeichert
   und ausgeliefert, unabhängig davon, in welcher Zone Server oder Container
   laufen.

Vor dem ersten Start und nach Updates wird das Schema einmalig mit
`php backend/bin/maintenance.php migrate` eingespielt. Im Docker-Image passiert
das beim Containerstart. Normale API-Requests führen deshalb keine DDL-Abfragen
mehr aus. `php backend/bin/maintenance.php cleanup` entfernt abgelaufene
Sessions anhand von `last_activity_at`; Docker ruft den Befehl alle fünf Minuten
auf.
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

### Soundprofile

Die auswählbaren Stimmen, Audiodateien und Warnzeiten stehen in
`frontend/public/sounds/manifest.json`. Neue Profile können vorhandene Profile
erben und nur einzelne Töne austauschen. Dateipfade und Fahrzeugausnahmen für
die C-Zeitwarnung sind in `frontend/public/sounds/README.md` beschrieben.

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

Den Inhalt von `frontend/dist/` direkt ins Webroot neben `backend/` legen. Die
Leitstelle läuft dann unter `/`, die API bleibt unter `/backend/api.php`. Das
Release-Paket enthält eine Weiterleitung von `/frontend/` nach `/`. Querystring
und URL-Fragment bleiben erhalten, daher funktionieren alte Adapterlinks mit
`session_token`, `pin`, `view`, `monitor`, `api_base` und `workspace` weiter.

Aufruf dann z. B.:

```text
https://example.org/leitstelle/?session_token=a1b2&pin=1234
```

Für Spieler gibt es zusätzlich einen schreibgeschützten Alarmmonitor:

```text
https://example.org/leitstelle/?view=monitor
```

Dort werden Raumcode und Wache 1–4 gewählt. Der Monitor zeigt nur laufende
Einsätze, denen mindestens ein Fahrzeug der gewählten Wache zugeordnet ist;
eine PIN wird dafür nicht benötigt. Hat die Leitstelle einem RTW oder ITW eine
Klinik zugewiesen, steht das Ziel in der Fahrzeugtafel unter dem Fahrzeug,
solange die Zuweisung besteht. Der Einstieg ist auch direkt im
Verbindungsdialog und in den Sitzungseinstellungen verlinkt.

Ohne aktive Sitzung erscheint zuerst ein Verbindungsdialog für Token und PIN.
Später lässt sich die Sitzung weiterhin über die Kopfzeile wechseln. Die
Zugangsdaten bleiben nur für die aktuelle Browser-Sitzung gespeichert und
werden nach einem Aufruf über URL-Parameter sofort aus der Adresszeile entfernt.

Das Web-App-Manifest erlaubt auf unterstützten Desktop- und Mobilbrowsern die
Installation als eigenständige App. In den Verbindungseinstellungen können
Desktop-Meldungen für neue Einsätze und Sprechwünsche eingeschaltet werden.
Diese Meldungen funktionieren, solange die App geöffnet ist. Web Push bei
geschlossenem Browser ist noch nicht enthalten.

### Arbeitsansichten

Die Leitstelle besteht aus Fenstern (Karte, Fahrzeuge, Einsätze, aktueller
Einsatz, FMS-Log, Sprechwünsche, Krankenhäuser, BMAs) auf einem Raster mit
24 Spalten und 16 Zeilen. Über „Anordnung bearbeiten“ (Kopfzeile oder
Ansichten-Dialog) lassen sich Fenster am blauen Kopf verschieben, an der
Ecke rechts unten in der Größe ändern, entfernen und aus der Leiste oben neu
hinzufügen. Karte, Fahrzeuge, Einsätze, FMS-Log und Krankenhäuser dürfen
mehrfach vorkommen; eine Fahrzeugliste kann fest auf Feuerwehr oder
Rettungsdienst stehen. Pfeiltasten verschieben ein fokussiertes Fenster,
Umschalt + Pfeiltasten ändern die Größe, Entf entfernt es.

Ansichten liegen im Browser (je Fenster, mit Spiegel für neue Fenster) und
auf Wunsch in der Server-Bibliothek. Dort bekommt jede Ansicht einen
sechsstelligen Code; „Link kopieren“ erzeugt `?layout=CODE`, mit dem andere
die Ansicht nach dem Verbinden direkt übernehmen. Wer den Code hat, kann die
Ansicht auch überschreiben oder löschen. Export und Import als JSON-Datei
gibt es ebenfalls im Ansichten-Dialog. Ältere Ansichten mit vier festen
Bereichen werden beim ersten Laden ins Raster umgerechnet.

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

- `POST api.php?action=capabilities` – API-Version und optionale Funktionen
- `POST api.php?action=stream` – SSE-Kanal für Änderungen; Polling bleibt kompatibel
- `POST api.php?action=state` – aktueller Leitstellenzustand mit laufenden Einsätzen
- `POST api.php?action=monitor_state` – schlanker Zustand für den Alarmmonitor
- `POST api.php?action=positions` – nur Fahrzeugkoordinaten als `[[id, x, y], …]`
  mit eigener `position_revision`; `known_position_revision` liefert bei
  unverändertem Stand nur `unchanged`. Der Sync aus dem Spiel erhöht die
  Sitzungsrevision nur noch bei anderen Änderungen als Positionen, spätestens
  aber alle 15 Sekunden.
- `POST api.php?action=status_history` – letzte 500 Fahrzeugstatusänderungen
- `POST api.php?action=layouts_list` / `layouts_get` / `layouts_put` / `layouts_delete`
  – Bibliothek der Arbeitsansichten, unabhängig von Sitzungen. Jedes Layout hat
  einen sechsstelligen Code; `layouts_put` ohne Code legt ein neues an, mit Code
  überschreibt es. Wer den Code hat, darf überschreiben und löschen.
- `POST api.php?action=logs` – Funkmeldungen; Cursor über `since` und `since_id`
- `POST api.php?action=events_create` / `events_finish` / `events_assign` /
  `events_unassign` – Einsätze anlegen, abschließen, Fahrzeuge (de)alarmieren
- `POST api.php?action=events_get_vehicles` / `events_get_note` /
  `events_set_note` / `events_get_logs` – Details und Verlauf zum Einsatz
- `POST api.php?action=vehicles_assign_player` – Fahrzeug einem Spieler geben
- `POST api.php?action=vehicles_alarm` – Einheit ohne Einsatz alarmieren
  (für Aktionen wie Sperrungen; der Adapter erhält ein assign mit event_id -1)

Schreibende Leitstellen-Actions prüfen die Session-PIN zentral, sofern die
Sitzung eine PIN hat. Ohne gesetzte PIN reicht weiterhin der vierstellige Code.
Befehle an das Spiel landen in der `commands`-Tabelle und werden per
`commands_pending`/`commands_ack` abgeholt – daran hat sich gegenüber
EMDispatch nichts geändert, bestehende Spielanbindungen laufen unverändert
weiter.

Bei Fahrzeugmeldungen ist `entity_id` immer die `game_vehicle_id`, nicht der
Anzeigename. Pro Fahrzeug bleibt höchstens ein Sprechwunsch offen. Weitere
Status-5-Meldungen dieses Fahrzeugs gehören zu diesem Eintrag. Sobald er
abgearbeitet ist, legt die nächste Status-5-Meldung einen neuen Sprechwunsch
mit eigener Eingangszeit an.

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
FMS-Status kommt aus EM4. Einzige Ausnahme: Der Disponent kann ein Fahrzeug
über das Kontextmenü außer Dienst setzen (Status 6). Dieser Status bleibt
stehen, egal was das Spiel meldet, bis das Spiel Status 2 meldet oder der
Disponent das Fahrzeug über dasselbe Menü wieder in Dienst nimmt. Meldet das
Spiel selbst Status 6, bleibt das unangetastet.

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

Die Sitzungsstatistik verwendet dieselbe Projektion und legt historische
Einsatzorte als Heatmap über das tatsächliche Kartenbild. Leaflet oder Mapbox
sind für diese Spielkarte nicht nötig, da keine geografischen Kacheln oder
Koordinaten vorliegen.

## Entwicklung

```bash
cd frontend
npm run dev      # Dev-Server mit Hot Reload
npm run check    # Typprüfung (svelte-check)
npm run lint     # ESLint für TypeScript und Svelte
npm run format   # Dateien mit Prettier formatieren
npm test         # Komponenten- und Zustandsprüfungen (Vitest)
npm run test:e2e # Browser-Smoke-Tests (Playwright)
npm run build    # Produktions-Build
```

Die Backend-Regeln für Fahrzeugstatus, Alarmierbarkeit, Klinikvormerkungen
und CORS haben einen kleinen Testlauf ohne zusätzliche Bibliotheken:

```bash
php backend/tests/run.php
```

GitHub Actions führt Lint, Typecheck, Unit-Tests, Build, Playwright sowie
PHP-Syntax- und Backend-Tests bei Pushes und Pull Requests aus.

## Docker und Betrieb

Für einen vollständigen Betrieb mit Apache/PHP und MariaDB gibt es eine
Produktions-Compose-Datei:

```bash
cp .env.docker.example .env
# Passwörter in .env ändern
docker compose up -d --build
```

Details zu Backup, Plesk, SSE und den lokalen anonymen Tagesaggregaten stehen
in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Die Bewertung der elf Ausbaupunkte
und die verbleibenden Schritte stehen in
[docs/TECHNICAL-ROADMAP.md](docs/TECHNICAL-ROADMAP.md).

### Manuelles Plesk-Release

Das Release-Skript prüft das Frontend, baut `dist` und legt unter `.release/`
ein ZIP für das Document Root an. Der Build liegt auf `/`, `backend/` bleibt
ein Unterordner und `frontend/` enthält nur die alte Weiterleitung:

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
