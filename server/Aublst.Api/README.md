# AUBLst API v2

Die API v2 ist die neue Schnittstelle für Bridge, Leitstelle und Alarmmonitor. Die bisherige PHP-API bleibt parallel unter `/backend/` erreichbar.

Wesentliche Unterschiede:

- Ressourcenorientierte URLs statt `api.php?action=...`
- eigene Session-UUID und Bearer-Token für die Bridge
- typisierte Snapshots mit monotoner Sequenznummer
- Commands werden zeitlich begrenzt geleast und erst nach erfolgreichem Schreiben bestätigt
- Fehler folgen `application/problem+json`
- Live- und Readiness-Endpunkte für den Betrieb
- Sitzungsabhängige Frontend-Umschaltung über `GET /api/v2/sessions/resolve/{code}`

Eine mit Bridge-Protokoll 2 angelegte Sitzung nutzt auch im Browser durchgehend API v2. Sitzungen mit Protokoll 1 oder ohne Bridge-Kennung bleiben auf der alten API. Das private Bridge-Token kommt dabei nie in den Browser; Frontend-Zugriffe verwenden Sitzungscode und optionale PIN.

Lokal läuft die API mit `dotnet run --project server/Aublst.Api`. Die Datenbankverbindung kann über `ConnectionStrings__Database` überschrieben werden.
