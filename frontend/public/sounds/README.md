# Soundprofile

Die `manifest.json` enthält die auswählbaren Stimmen und die Warnzeiten. Pfade
unter `cues` beginnen im Ordner `frontend/public/`. Ein Profil kann mit
`extends` alle nicht überschriebenen Töne eines anderen Profils übernehmen.

Für „Stimme Jannik“ werden diese Dateien erwartet:

```text
frontend/public/sounds/Jannik/sprechwunsch.m4a
frontend/public/sounds/Jannik/fahrzeug-3-ohne-einsatz.m4a
frontend/public/sounds/Jannik/fahrzeug-4-ohne-einsatz.m4a
frontend/public/sounds/Jannik/fahrzeug-c-zeitueberschreitung.m4a
frontend/public/sounds/Jannik/sprechwunsch-zeitueberschreitung.m4a
```

Die Profile „Marvin“ und „Schwabe“ verwenden dieselben Dateinamen in den
Ordnern `frontend/public/sounds/Marvin/` und
`frontend/public/sounds/Schwabe/`.

Der Klingelton und normale Funkmeldungen kommen durch `extends: "standard"`
weiter aus dem Standardprofil. Solange eine Jannik-Datei fehlt, bleibt nur der
betroffene Hinweis stumm.

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
