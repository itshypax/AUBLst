# Soundprofile

Die `manifest.json` enthält die auswählbaren Stimmen und die Warnzeiten. Pfade
unter `cues` beginnen im Ordner `frontend/public/`. Ein Profil kann mit
`extends` alle nicht überschriebenen Töne eines anderen Profils übernehmen.

Ein Ton kann weiterhin direkt als Dateipfad eingetragen werden. Soll er
mehrfach laufen, bekommt er ein Objekt mit `file` und `repeat`. `repeat` ist
die gesamte Abspielanzahl und darf zwischen 1 und 10 liegen:

```json
{
  "new-incident": {
    "file": "sounds/Jannik/anrufton.m4a",
    "repeat": 2
  }
}
```

Mit `"none"` wird ein Ton ausdrücklich ausgeschaltet. Das überschreibt auch
einen Ton, der über `extends` geerbt wurde:

```json
{
  "ship-released": "none"
}
```

`browser_titles` enthält optionale Browsertitel für ein Profil. `chance` liegt
zwischen 0 und 1. Die nicht belegte Restwahrscheinlichkeit verwendet „Hier
Leitstelle Auenburg“. Die Auswahl wird beim Laden oder Wechsel des Profils neu
getroffen und bleibt danach bestehen:

```json
{
  "id": "jannik",
  "browser_titles": [
    {
      "text": "Hier Leitstelle Goslar",
      "chance": 0.05
    }
  ]
}
```

Für „Stimme Jannik“ werden diese Dateien erwartet:

```text
frontend/public/sounds/Jannik/sprechwunsch.m4a
frontend/public/sounds/Jannik/fahrzeug-3-ohne-einsatz.m4a
frontend/public/sounds/Jannik/fahrzeug-4-ohne-einsatz.m4a
frontend/public/sounds/Jannik/fahrzeug-c-zeitueberschreitung.m4a
frontend/public/sounds/Jannik/sprechwunsch-zeitueberschreitung.m4a
frontend/public/sounds/Jannik/anrufton.m4a
frontend/public/sounds/Jannik/alarmstufenerhoehung.m4a
frontend/public/sounds/Jannik/rettungsmittelknappheit.m4a
frontend/public/sounds/Jannik/schienenverkehr-eingestellt.m4a
frontend/public/sounds/Jannik/schienenverkehr-freigegeben.m4a
frontend/public/sounds/Jannik/schiffsverkehr-eingestellt.m4a
frontend/public/sounds/Jannik/schiffsverkehr-freigegeben.m4a
```

Die Profile „Marvin“ und „Schwabe“ verwenden dieselben Dateinamen in den
Ordnern `frontend/public/sounds/Marvin/` und `frontend/public/sounds/Schwabe/`.
Die Ereignistöne sind derzeit für Jannik und Schwabe eingetragen. Für
Schienen- und Tramverkehr wird jeweils dieselbe Audiodatei verwendet.

Normale Funkmeldungen kommen durch `extends: "standard"` weiter aus dem
Standardprofil. Solange eine Profildatei fehlt, bleibt nur der betroffene
Hinweis stumm.

`unassigned_vehicle_exceptions` enthält Fahrzeuge, die in Status 3 oder 4
absichtlich keinem Einsatz zugeordnet sind. Für sie wird kein entsprechender
Hinweiston abgespielt.

`vehicle_c_timeout_overrides` setzt die C-Wartezeit für einzelne
`game_vehicle_id`s in Sekunden. `0` schaltet die C-Warnung für das betreffende
Fahrzeug aus:

```json
{
  "vehicle_c_timeout_seconds": 120,
  "vehicle_c_timeout_overrides": {
    "72_RTW_A": 300,
    "CHRISTOPH_82": 0
  }
}
```

Nach Änderungen an Audiodateien mit unverändertem Dateinamen muss `version`
erhöht werden, damit der Browser nicht die alte Datei aus dem Cache verwendet.
