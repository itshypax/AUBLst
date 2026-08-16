# Deployment

## Docker Compose

Die produktive Compose-Datei startet MariaDB und eine Apache/PHP-Instanz. Das Frontend wird beim Image-Build erstellt und liegt unter `/frontend/`, die API unter `/backend/api.php`.

```bash
cp .env.docker.example .env
# Passwörter in .env ändern
docker compose up -d --build
```

Danach ist die Leitstelle unter `http://localhost:8080/` erreichbar. Die Datenbank liegt im Volume `aublst-db`. Vor einem Update sollte dieses Volume gesichert werden.

```bash
docker compose exec db mariadb-dump -uaublst -p game_ops_dashboard > aublst-backup.sql
docker compose pull
docker compose up -d --build
```

## Plesk oder klassisches Webhosting

Für Plesk bleibt `scripts/build-release.ps1` der kürzeste Weg. Das erzeugte ZIP enthält nur `backend/` und das gebaute `frontend/`; `backend/config.local.php` und Tests werden ausgelassen.

Die API braucht PHP 8.3 mit `pdo_mysql`. Für SSE sollte der Webserver Antworten vom Typ `text/event-stream` nicht puffern. Bei nginx gehört in den API-Standort beispielsweise `proxy_buffering off;`. Die Verbindung endet nach spätestens 25 Sekunden und wird vom Browser neu aufgebaut. Falls das Hosting lang laufende PHP-Anfragen blockiert, kann `ENABLE_REALTIME_STREAM=false` gesetzt werden; das Frontend schaltet selbst auf HTTP-Polling zurück.

Nach dem Upload prüfen:

1. `backend/api.php?action=capabilities` liefert JSON.
2. Eine Sitzung lässt sich verbinden und zeigt `Verbunden`.
3. Ein zweites Browserfenster erhält einen neuen Einsatz ohne manuelles Neuladen.
4. `backend/config.local.php` ist nicht öffentlich abrufbar und enthält einen eingeschränkten DB-Benutzer.

## Anonyme Metriken

Die Tagesaggregate sind standardmäßig aktiv. Sie liegen in der Tabelle
`anonymous_metrics` derselben MariaDB-Datenbank wie Sitzungen und Einsätze. Es
gibt drei Messwerte:

- `events_created`: Zahl der an diesem Tag neu angelegten Einsätze
- `state_load_ms`: Dauer eines Zustandsabrufs; `value_sum / sample_count` ist der Mittelwert
- `active_events`: Zahl der beim Abruf sichtbaren Einsätze; ebenfalls als Mittelwert und Maximum

Pro Tag und Messwert gibt es genau eine Tabellenzeile mit `sample_count`,
`value_sum` und `value_max`. Tokens, PINs, IP-Adressen und einzelne Requests
werden dort nicht gespeichert. Es findet kein Versand an einen externen Dienst
statt. Eine einfache Kontrolle ist direkt in MariaDB möglich:

```sql
SELECT metric_day, metric_name, sample_count, value_sum, value_max,
       value_sum / sample_count AS average_value
FROM anonymous_metrics
ORDER BY metric_day DESC, metric_name;
```

Mit `ENABLE_ANONYMOUS_METRICS=false` lässt sich die Sammlung vollständig
abschalten. Vorhandene Zeilen werden dabei nicht automatisch gelöscht.
