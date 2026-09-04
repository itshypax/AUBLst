# Alarmmonitor-Gongs

`gong-stuttgart.wav` ist die Standardauswahl „Gong Stuttgart“. Die Datei wurde
für den Alarmmonitor bereitgestellt und wird unverändert lokal ausgeliefert.

`gong-hamburg.wav` ist als „Gong Hamburg“ auswählbar. Die bereitgestellte Datei
wird unverändert lokal ausgeliefert und ist keine Standardauswahl.

`feuerwehr-gong-soundxpro.mp3` bleibt als „Feuerwehr-Gong“ auswählbar und stammt
von SoundXPro:

- Titel: „Feuerwehr Gong“
- Quelle: https://soundxpro.com/sounds/feuerwehr-gong
- Auf der Quellseite als lizenzfrei und kommerziell nutzbar ausgewiesen

Die Datei wird lokal ausgeliefert, damit jeder Alarmmonitor denselben Klang verwendet
und die Wiedergabe nicht von der Erreichbarkeit der Quellseite abhängt.

## Sprachansage

`tts-conrad/` enthält vorab erzeugte Bausteine der Microsoft-Stimme
`de-DE-ConradNeural`. Die enthaltenen Funkrufnamen entsprechen exakt den regulären
Fahrzeugen aus `4_LST/AUBMP.cfg`. Versteckte Sammel- und Aktions-Einheiten wie TD,
FuSTW oder FS_LST werden nicht als Wachfahrzeuge angesagt. Jeder Funkrufname wird
als vollständige Aufnahme gesprochen; der Browser setzt nur die fertigen
Fahrzeugnamen zur Ansage zusammen.
Buchstabenkennungen verwenden die klassische deutsche Buchstabiertafel, also zum
Beispiel Anton, Berta und Cäsar.

Nach dem Gong beginnt die Stimme mit „Einsatz für“. Mehrere Fahrzeugnamen folgen
ohne Verbindungswort und mit ungefähr 0,5 Sekunden Pause aufeinander.

Die Dateien lassen sich mit `scripts/generate-monitor-tts.py` neu erzeugen. Das
Skript braucht dafür das Python-Paket `edge-tts`; zur Laufzeit gibt es keine
Verbindung zu einem Sprachdienst.

`tts-marvin/` ist eine eigene Aufnahme mit denselben Rufnamen und demselben
Intro, als m4a statt mp3. Welche Stimme läuft, wählt der Monitor in den
Alarmton-Einstellungen unter „Stimme“; Conrad bleibt die Standardauswahl.
Beide Ordner müssen denselben Satz Rufnamen enthalten, sonst bleibt bei der
fehlenden Stimme nur das betroffene Fahrzeug stumm.

## Frühere Vorschläge

Die Dateien sind unter CC0 1.0 veröffentlicht und wurden unverändert von
Wikimedia Commons übernommen.

- `gong-kurz.ogg`: „Gong or bell vibrant (short)“, Stephan, 5,6 Sekunden,
  https://commons.wikimedia.org/wiki/File:Gong_or_bell_vibrant_(short).ogg
- `gong-weich.ogg`: „Meditation Gong“, Marble Toast, 15,8 Sekunden,
  https://commons.wikimedia.org/wiki/File:Meditation_Gong.ogg

Lizenz: https://creativecommons.org/publicdomain/zero/1.0/
