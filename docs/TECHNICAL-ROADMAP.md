# Technische Bewertung

Stand: 16. August 2026

| Punkt | Ergebnis | Weitere Arbeit |
| --- | --- | --- |
| Echtzeit-Updates | SSE signalisiert Sitzungsänderungen; das vorhandene Polling bleibt als Rückfall und Kontrollabgleich. Mehrere Tabs teilen die Abfragen weiterhin über `BroadcastChannel`. | Unter hoher Last Laufzeit und Anzahl paralleler PHP-Worker beobachten. Erst dann wäre ein eigener Push-Dienst sinnvoll. |
| Kartenintegration | Die bestehende Canvas-Karte passt zur fiktiven EM4-Spielwelt, unterstützt Zoom, Einsatzanlage, Fahrzeugfokus und ein eigenes Straßennetz. Leaflet oder Mapbox würde keine Geodaten hinzufügen. | Kein Bibliothekswechsel geplant. |
| Mobil und App | Die Arbeitsansicht hat mobile Breakpoints, größere Touch-Trenner und kann über das Web-App-Manifest als PWA installiert werden. | Eine native iOS-/Android-Hülle lohnt sich erst bei Bedarf an dauerhaftem Hintergrundbetrieb. |
| Tests und CI | Vitest deckt Logik und Komponenten ab. Playwright prüft Sitzungseinstieg und horizontales Überlaufen auf Desktop und Mobil. GitHub Actions führt Lint, Typecheck, Tests, Build und PHP-Prüfungen aus. | E2E-Szenarien mit echter MariaDB für Alarmierung und Mehrfenster-SSE ergänzen. |
| Codequalität | ESLint, Prettier und der bestehende Svelte-Typecheck sind als Skripte vorhanden. | Bestehende Svelte-Listen schrittweise mit stabilen Keys versehen und den Bestand einmal separat formatieren; beides ist bis dahin nicht in CI erzwungen. |
| API-first Backend | Handler sind nach Domänen getrennt. `capabilities` beschreibt API-Version, Echtzeitmodus und Telemetrie. Bestehende Adapter bleiben über `action=` kompatibel. | Bei neuen externen Clients eine versionierte REST-Fassade ergänzen, statt den kompatiblen Adaptervertrag umzubauen. |
| Telemetrie | Standardmäßig aktive, abschaltbare Tagesaggregate erfassen neu angelegte und sichtbare Einsätze sowie Zustands-Ladezeiten ohne Token, PIN, IP oder Einzelereignisse. Die Daten bleiben in der eigenen MariaDB. | Bei Bedarf eine geschützte Betreiberansicht ergänzen; keine öffentliche Statistik-API vorsehen. |
| Installation und Deployment | Produktions-Dockerfile, Compose-Datei, Plesk-Release und eigene Deployment-Anleitung sind vorhanden. | Backup-Wiederherstellung einmal auf dem Zielserver proben. |
| Smart Notifications | Opt-in Desktop-Meldungen informieren bei neuen Einsätzen und Sprechwünschen, wenn der Tab im Hintergrund ist. | Echtes Web Push braucht VAPID-Schlüssel, Subscription-Speicherung und eine Löschroutine. Das ist erst nötig, wenn Meldungen bei geschlossenem Browser gefordert sind. |
| Toasts | Meldungen haben Titel, Statussymbol, Ablaufanzeige und Schließen-Schaltfläche. Alarmierungen erscheinen als `Alarmierung gesendet` mit Fahrzeuganzahl. | Bei parallelen Aktionen auf eine kleine Warteschlange erweitern. |
| Statistik-Heatmap | Historische Einsatzorte werden mit der Live-Kartenprojektion auf das tatsächliche Kartenbild gelegt. | Zeit- und Kategoriefilter ergänzen, sobald Sitzungen genug Daten für sinnvolle Vergleiche enthalten. |
