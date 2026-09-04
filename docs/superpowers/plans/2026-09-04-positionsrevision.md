# Positionsupdates von der Zustandsrevision trennen (A2) – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ziel:** Der Sync aus dem Spiel (jede Sekunde, `SyncIntervalMs = 1000` in
der Bridge) erhöht die Sitzungsrevision nur noch, wenn sich etwas anderes als
Fahrzeugpositionen geändert hat. Positionen bekommen eine eigene Revision und
eine eigene, sehr kleine Abfrage.

**Architektur:** `sessions` bekommt `position_revision` und
`sync_fingerprint`. `action_sync` bildet über den Nutzdaten ohne x/y einen
Fingerabdruck; nur bei geändertem Fingerabdruck (oder Statuswechsel, oder
als Sicherheitsnetz alle 15 Sekunden) steigt `revision`. Positionsänderungen
erhöhen `position_revision`. Der SSE-Stream meldet beides getrennt
(`event: change`, `event: positions`). Das Frontend holt bei `positions`
nur `[[id, x, y], ...]` und schreibt x/y in die vorhandenen Fahrzeugobjekte;
die Karten lesen dafür `app.positionRevision`.

**Tech Stack:** PHP 8.3 (Backend, Tests in `backend/tests/run.php` ohne
Datenbank), Svelte 5 / Vitest (Frontend), `scripts/load-smoke.mjs` in der CI
gegen echte MariaDB.

## Globale Randbedingungen

- Keine Commits ohne Freigabe von Josua.
- Adapterprotokoll (sync, update_vehicles, commands_*) bleibt unverändert;
  neue Felder sind additiv.
- Ohne SSE (Polling-Rückfall) müssen Positionen weiterhin ankommen: eigener
  Positions-Poll im gleichen Takt wie der Zustandsabruf.
- PHP kann lokal nicht ausgeführt werden; `load-smoke.mjs` in der CI ist der
  Beweis, dass die neuen Backend-Pfade laufen. Deshalb wird er erweitert.
- Nach jedem Task: `npx vitest run`, `npm run check`, `npx eslint .`.

---

### Task 1: Reine Backend-Helfer (ohne Datenbank)

**Files:**
- Modify: `backend/src/domain.php`
- Test: `backend/tests/run.php`

**Produces:**

```php
// Welche Art von Änderung ein Fahrzeugupdate enthält.
function vehicle_change_kinds($saved, array $row): array; // ['positions' => bool, 'data' => bool]
// Fingerabdruck über den Sync-Inhalt ohne Fahrzeugpositionen.
function sync_fingerprint(array $data): string; // 64 Hex-Zeichen
```

- [x] Test: neues Fahrzeug (`$saved === false`) → data true, positions true.
- [x] Test: nur x/y anders → positions true, data false.
- [x] Test: nur status anders → data true, positions false.
- [x] Test: identisch → beides false.
- [x] Test: Fingerabdruck ändert sich nicht, wenn nur x/y eines Fahrzeugs
      anders sind; ändert sich bei anderem Status, anderem Einsatz, anderer
      Uhrzeit; ist unabhängig von der Reihenfolge der Fahrzeuge.
- [x] Umsetzung:

```php
function vehicle_change_kinds($saved, array $row): array {
    if (!$saved) return ['positions' => true, 'data' => true];
    $positions = (float)$saved['x'] !== (float)$row['x'] || (float)$saved['y'] !== (float)$row['y'];
    $data = false;
    foreach (['name', 'type', 'modes'] as $field) {
        if ((string)($saved[$field] ?? '') !== (string)($row[$field] ?? '')) $data = true;
    }
    if ((int)$saved['status'] !== (int)$row['status']) $data = true;
    return ['positions' => $positions, 'data' => $data];
}

function sync_fingerprint(array $data): string {
    $vehicles = [];
    foreach (($data['vehicles'] ?? []) as $vehicle) {
        if (!is_array($vehicle)) continue;
        $id = trim((string)($vehicle['game_vehicle_id'] ?? ''));
        if ($id === '') continue;
        unset($vehicle['x'], $vehicle['y']);
        ksort($vehicle);
        $vehicles[$id] = $vehicle;
    }
    ksort($vehicles);
    $payload = [
        'players' => $data['players'] ?? null,
        'hospitals' => $data['hospitals'] ?? null,
        'messages' => $data['messages'] ?? null,
        'events' => $data['events'] ?? null,
        'time' => $data['time'] ?? null,
        'map_bounds' => $data['map_bounds'] ?? null,
        'vehicles' => $vehicles,
    ];
    return hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}
```

### Task 2: Schema, Revisionen und Sync

**Files:**
- Modify: `backend/src/migrations.php` (neue Migration `2026090401_position_revision`), `backend/src/schema.sql` (sessions),
  `backend/src/repository.php` (`upsert_vehicles`, neue `touch_session_positions`, `store_sync_fingerprint`),
  `backend/src/actions/sessions.php` (`action_sync`), `backend/src/actions/vehicles.php` (`action_update_vehicles`),
  `backend/src/actions/state.php` (`state_session_data` liefert `position_revision`, neue `action_positions`),
  `backend/src/actions/system.php` (Stream meldet `positions`), `backend/api.php` (Action `positions`).

- [x] Migration nach dem Muster der vorhandenen (Spalte nur anlegen, wenn sie fehlt).
- [x] `upsert_vehicles(..., ?array &$changes = null)`: sammelt `positions`/`data` über alle Fahrzeuge.
- [x] `action_sync`: Fingerabdruck vor den Upserts berechnen, `$session['sync_fingerprint']` und `$session['updated_at']` merken.
      Nach den Upserts:
      - data geändert (Fingerabdruck anders, `$changes['data']`, `$leaders_dirty`) oder `updated_at` älter als 15 s → `touch_session` + Fingerabdruck speichern
      - sonst positions geändert → `touch_session_positions`
      - sonst → `mark_session_activity` (damit der Cleanup die Sitzung nicht löscht)
- [x] `action_update_vehicles`: gleiche Dreiteilung ohne Fingerabdruck.
- [x] `action_positions`: `known_position_revision` → `{unchanged:true, position_revision}`; sonst `{position_revision, positions:[[id,x,y],...]}`.
- [x] Stream: `SELECT revision, position_revision`, Body-Feld `last_position_revision`, Frame `event: positions` mit `{"position_revision":N}`.
- [x] `scripts/load-smoke.mjs`: nach dem Sync `positions` abrufen und 60 Einträge erwarten; zweiter Sync mit verschobenen Positionen erhöht `position_revision`, nicht `revision`; Profil `positions` mit 5 Clients parallel.

### Task 3: Frontend

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/state.svelte.ts` (`positionRevision`),
  `frontend/src/lib/realtime.ts` (`onPositions`, `last_position_revision`),
  `frontend/src/lib/polling.ts` (`refreshPositions`, `applyPositions`, Positions-Poll im Rückfall),
  `frontend/src/lib/polling-sync.ts` (Nachricht `positions` an andere Tabs),
  `frontend/src/components/MapPanel.svelte`, `frontend/src/components/AlarmMonitorMap.svelte` (lesen `app.positionRevision`).
- Test: `frontend/src/lib/polling.test.ts`, `frontend/src/lib/realtime.test.ts`, `frontend/src/components/MapPanel.test.ts`.

- [x] Test: `refreshPositions` schreibt x/y in bestehende Fahrzeugobjekte, lässt andere Felder unberührt, setzt `app.positionRevision`, sendet `known_position_revision`.
- [x] Test: `unchanged`-Antwort ändert nichts.
- [x] Test: Stream-Ereignis `positions` ruft `onPositions` auf und merkt sich die Revision.
- [x] Test: Karte zeichnet bei neuer `positionRevision` nur die Markerebene.
- [x] Umsetzung nach den Tests.

### Task 4: Doku

- [x] README (API-Liste Leitstelle → Server: `positions`), `docs/TECHNICAL-ROADMAP.md` (Zeile Zustandsabruf), `docs/konzepte-2026-09-04.md` (Status A2).
