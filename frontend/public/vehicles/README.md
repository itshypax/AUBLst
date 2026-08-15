# Fahrzeuggrafiken pro Mod

Jeder Mod hat unter `vehicles/` einen Ordner, dessen Name exakt seiner `mod_id`
entspricht. EMDispatch lädt daraus die `manifest.json`. Gibt es kein Manifest,
zeichnet die Karte das vorhandene neutrale Fahrzeugsymbol.

Die Regeln unter `icons` werden von oben nach unten geprüft. Eine Regel kann
eine genaue `game_vehicle_id`, einen `type`, eine Liste `stations` oder eine
Kombination daraus enthalten. `file` ist relativ zum Ordner des Manifests.

```json
{
  "version": 1,
  "icons": [
    { "game_vehicle_id": "1_HLF_2", "file": "HLF2.webp" },
    { "type": "RTW", "stations": ["72", "74"], "file": "RTW_Ext.webp" },
    { "type": "RTW", "file": "RTW.webp" }
  ]
}
```

Ein Submod kann die Regeln eines anderen Mods erben. Eigene Regeln stehen vor
den geerbten Regeln:

```json
{
  "version": 1,
  "extends": "AUBMP",
  "icons": [
    { "game_vehicle_id": "1_HLF_1", "file": "HLF-Winter.webp" }
  ]
}
```

Nach einer Bildänderung bei gleichem Dateinamen muss `version` erhöht werden,
damit Browser nicht die alte Grafik aus dem Cache verwenden.
