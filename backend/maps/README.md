# Kartenbilder

Kartenbild hier als `<mod_id>.jpg`, `.png` oder `.webp` ablegen, dann muss
nichts mehr per `mods_put` hochgeladen werden. Beispiel: Session mit
`mod_id = demo-city` sucht nach `demo-city.jpg`.

Dateien hier haben Vorrang vor per API hochgeladenen Bildern.

Ein optionales `<mod_id>.map.json` kann eine abweichende Bilddatei und den
inneren Spielbereich festlegen. Das vollständige Bild bleibt sichtbar; Marker,
Klickpositionen und Routing beziehen sich nur auf `content_rect`.
