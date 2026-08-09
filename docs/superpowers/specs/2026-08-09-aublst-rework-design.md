# AUBLst — Rework-Design (2026-08-09)

## Ausgangslage

EMDispatch ist eine Web-Leitstelle für ein Spiel: Das Spiel meldet Fahrzeuge,
Einsätze, Krankenhäuser und Funkmeldungen an ein PHP/MySQL-Backend, die
Leitstelle im Browser disponiert Fahrzeuge und schickt Befehle zurück, die das
Spiel per Polling abholt. Backend war ein einzelner 640-Zeilen-Switch in
`api.php`, das Frontend eine einzelne `app.js` mit rund 950 Zeilen.

Das Projekt heißt künftig **AUBLst** und soll öffentlich auf einem Server
laufen — jede Spielinstanz nutzt ihre eigene Session (Token + optionale PIN),
die Mandantentrennung existiert bereits über die `sessions`-Tabelle.

## Unverrückbar: der API-Vertrag

Das Spiel kennt diese Actions auf `backend/api.php` und sie bleiben in URL,
Payload, Antwortformat und Statuscodes exakt wie bisher:

- `session_create`, `sync`, `mods_put`, `map_image`
- `update_vehicles`, `update_hospitals`, `update_events`
- `commands_pending`, `commands_ack`
- `state`, `logs`, `log_viewed`
- `events_create`, `events_finish`, `events_assign`, `events_unassign`,
  `events_get_vehicles`, `events_get_note`, `events_set_note`
- `vehicles_assign_player`

Ebenfalls unverändert: das DB-Schema, die PIN-Prüfung (nur auf schreibenden
Frontend-Actions), die Upsert-Semantik (`check_options`-Prioritäten), das
automatische Entlassen aus Zuweisungen bei Status 2, der 4-Hex-Zeichen-Token
aus `random_bytes(2)` und das Polling-Modell (kein Websocket).

## Backend-Umbau

`api.php` wird ein schlanker Front-Controller mit einer Dispatch-Tabelle.
Die Logik zieht nach `backend/src/`:

- `http.php` — JSON-Ein-/Ausgabe, CORS
- `database.php` — PDO-Verbindung
- `session.php` — Session-Auflösung inkl. PIN-Zwang
- `repository.php` — Upserts und Lookups (Vehicles, Events, Hospitals, …)
- `actions/*.php` — ein Handler pro Themengebiet (sessions, mods, state,
  vehicles, hospitals, events, commands, logs)

Kein Composer, kein Autoloader — einfache `require`s, damit das Deployment
"Ordner auf PHP-Server kopieren" bleibt. Strict Types überall.

## Frontend-Neubau

Vite + Svelte 5 + TypeScript in `frontend/`, Build-Output `frontend/dist/`
(statische Dateien, liegen neben dem Backend auf demselben Server).

- Typisierter API-Client, Polling wie bisher: Vollzustand alle 3 s,
  Funkmeldungen alle 2 s.
- `session_token`/`pin` per URL-Parameter oder Eingabe, in localStorage.
- Icons: lucide-svelte. Sounds (Telefon bei neuem Einsatz, Gong bei
  Funkmeldung) bleiben.

### UI (deutsch, dunkles Leitstellen-Design)

- **Karte** groß links: Canvas mit Pan/Zoom, Rechtsklick legt Einsatz an,
  Klick auf Einsatz öffnet die Alarmierung. Hover hebt Einsätze UND Fahrzeuge
  hervor — in beide Richtungen zwischen Karte und Listen.
- **Fahrzeugübersicht** rechts neben der Karte, unterteilt in Feuerwehr /
  Rettungsdienst / Sonstige. Zuordnung über Typ-/Namenspräfixe (LF, HLF, DLK,
  ELW, RW, GW … / RTW, KTW, NEF, NAW, RTH …), erweiterbar über eine optionale
  `groups.json` neben der index.html — ohne Rebuild anpassbar.
- **Einsatzliste** mit Status, Position, Abschließen-Aktion für
  leitstellenseitig angelegte Einsätze.
- **Funkmeldungen** (Activity-Log) und **Krankenhausbetten** unten.
- **Alarmierungsfenster** neu: Einsatzkopf, Notizen, Suche, verfügbare
  Fahrzeuge nach Kategorie gruppiert, ausgewählte Fahrzeuge als entfernbare
  Chips, Modus-Auswahl (Sondersignal) pro Fahrzeug, Spielerzuweisung,
  Zurück-zur-Wache für Status 3.
- Spaltenteiler zwischen Karte und Seitenleiste bleibt verstellbar.

### Ausdrücklich nicht enthalten

- „Nicht eingerückt“-Warnung (bewusst verschoben)
- Schemaänderungen, neue Actions, Websockets, Accounts

## Branding

Name überall AUBLst (Titel, Topbar, package.json, README). README auf Deutsch
mit Setup- und Hosting-Anleitung; Ursprung Floko122/EMDispatch bleibt als
Credit erhalten.
