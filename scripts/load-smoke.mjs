import { performance } from "node:perf_hooks";

const apiBase = process.argv[2] ?? "http://127.0.0.1:8080/backend/api.php";
const suppliedToken = process.argv[3] ?? "";
const requestsPerProfile = Number(process.argv[4] ?? 40);

async function post(action, body) {
  const response = await fetch(
    `${apiBase}?action=${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`${action}: ${response.status} ${data.error ?? ""}`.trim());
  return data;
}

async function testSession() {
  if (suppliedToken) return suppliedToken;
  const created = await post("session_create", { mod_id: "AUBMP" });
  const token = created.session_token;
  await post("sync", {
    session_token: token,
    mod_id: "AUBMP",
    map_bounds: { min_x: -10000, min_y: -10000, max_x: 10000, max_y: 10000 },
    players: { 0: "Spieler" },
    vehicles: Array.from({ length: 60 }, (_, index) => ({
      game_vehicle_id: `LOAD_${index + 1}`,
      name: `Lasttest ${index + 1}`,
      type: index % 4 === 0 ? "RTW" : "HLF",
      status: 2,
      x: index * 10,
      y: index * -10,
    })),
    hospitals: [],
    messages: [],
    events: [
      {
        game_event_id: "load-event",
        name: "Lasttest",
        x: 200,
        y: -200,
        status: "active",
      },
    ],
    time: { h: 12, m: 0 },
  });
  const state = await post("state", { session_token: token });
  const vehicle = state.vehicles.find(
    (item) => item.game_vehicle_id === "LOAD_1",
  );
  const event = state.events.find(
    (item) => item.game_event_id === "load-event",
  );
  await post("events_assign", {
    session_token: token,
    event_id: event.id,
    vehicle_ids: [vehicle.id],
  });
  await post("update_vehicles", {
    session_token: token,
    updates: [{ game_vehicle_id: "LOAD_1", status: 3, x: 40, y: -30 }],
  });
  const record = await post("event_record", {
    session_token: token,
    event_id: event.id,
  });
  if (!record.journal?.length || !record.positions?.length) {
    throw new Error("Disponentenprotokoll oder Positionsaufzeichnung fehlt");
  }

  // Eine reine Positionsänderung erhöht nur die Positionsrevision.
  const stateBefore = await post("state", { session_token: token });
  const positionsBefore = await post("positions", { session_token: token });
  if (positionsBefore.positions?.length !== 60) {
    throw new Error("Positionskanal liefert nicht alle Fahrzeuge");
  }
  await post("update_vehicles", {
    session_token: token,
    updates: [{ game_vehicle_id: "LOAD_2", x: 999, y: -999 }],
  });
  const stateAfter = await post("state", {
    session_token: token,
    known_revision: stateBefore.session.revision,
  });
  if (stateAfter.unchanged !== true) {
    throw new Error("Positionsänderung hat die Zustandsrevision erhöht");
  }
  const positionsAfter = await post("positions", {
    session_token: token,
    known_position_revision: positionsBefore.position_revision,
  });
  const movedId = stateBefore.vehicles.find(
    (item) => item.game_vehicle_id === "LOAD_2",
  ).id;
  const moved = positionsAfter.positions?.find(([id]) => id === movedId);
  if (
    positionsAfter.unchanged ||
    !(positionsAfter.position_revision > positionsBefore.position_revision) ||
    !moved ||
    moved[1] !== 999
  ) {
    throw new Error(
      "Positionsrevision oder Koordinaten fehlen nach Positionsänderung",
    );
  }
  // Geteilte Layouts: anlegen, laden, überschreiben, als Kopie neu anlegen, löschen.
  const layoutPanels = [
    { key: "map", type: "map", x: 0, y: 0, w: 16, h: 16 },
    { key: "events", type: "events", x: 16, y: 0, w: 8, h: 16 },
  ];
  const saved = await post("layouts_put", {
    session_token: token,
    name: "Lasttest-Ansicht",
    layout: { panels: layoutPanels },
  });
  if (!/^[A-Z0-9]{6}$/.test(saved.code ?? "")) {
    throw new Error("Layout-Code fehlt oder hat das falsche Format");
  }
  const loaded = await post("layouts_get", { session_token: token, code: saved.code });
  if (loaded.name !== "Lasttest-Ansicht" || loaded.layout?.panels?.length !== 2) {
    throw new Error("Gespeichertes Layout kommt nicht zurück");
  }
  const updated = await post("layouts_put", {
    session_token: token,
    code: saved.code,
    name: "Lasttest-Ansicht 2",
    layout: { panels: layoutPanels },
  });
  if (updated.code !== saved.code || updated.created !== false) {
    throw new Error("Überschreiben per Code hat einen neuen Code erzeugt");
  }
  const copy = await post("layouts_put", {
    session_token: token,
    name: loaded.name,
    layout: loaded.layout,
  });
  if (!copy.created || copy.code === saved.code) {
    throw new Error("Import als Kopie hat keinen eigenen Code erzeugt");
  }
  await post("layouts_delete", { session_token: token, code: copy.code });
  await post("layouts_delete", { session_token: token, code: saved.code });
  let deleted = false;
  try {
    await post("layouts_get", { session_token: token, code: saved.code });
  } catch {
    deleted = true;
  }
  if (!deleted) throw new Error("Layout ist nach dem Löschen noch abrufbar");
  return token;
}

// Öffnet den SSE-Stream und wartet auf ein bestimmtes Ereignis. Liefert die
// Zeit bis zum Ereignis in Millisekunden.
async function waitForStreamEvent(token, eventName, lastRevision, lastPositionRevision, trigger, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${apiBase}?action=stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        session_token: token,
        last_revision: lastRevision,
        last_position_revision: lastPositionRevision,
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`stream: ${response.status}`);
    }
    if (trigger) await trigger();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`stream endete ohne "${eventName}"`);
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes(`event: ${eventName}\n`)) {
        return Math.round(performance.now() - started);
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function testStream(token) {
  const state = await post("state", { session_token: token });
  const revision = Number(state.session.revision);
  const positionRevision = Number(state.session.position_revision);
  const initial = await waitForStreamEvent(token, "change", -1, -1, null, 8000);
  const pushed = await waitForStreamEvent(
    token,
    "positions",
    revision,
    positionRevision,
    () =>
      post("update_vehicles", {
        session_token: token,
        updates: [{ game_vehicle_id: "LOAD_3", x: 1234, y: -1234 }],
      }),
    8000,
  );
  return { initial_ms: initial, positions_push_ms: pushed };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  );
}

async function runProfile(action, clients, token) {
  const durations = [];
  let errors = 0;
  await Promise.all(
    Array.from({ length: clients }, async () => {
      let revision = -1;
      for (let index = 0; index < requestsPerProfile; index += 1) {
        const started = performance.now();
        try {
          const response = await post(action, {
            session_token: token,
            ...(revision >= 0 ? { known_revision: revision } : {}),
          });
          revision = Number(
            response.revision ?? response.session?.revision ?? revision,
          );
        } catch {
          errors += 1;
        } finally {
          durations.push(performance.now() - started);
        }
      }
    }),
  );
  return {
    action,
    clients,
    requests: durations.length,
    errors,
    p50_ms: Math.round(percentile(durations, 0.5) * 10) / 10,
    p95_ms: Math.round(percentile(durations, 0.95) * 10) / 10,
    max_ms: Math.round(Math.max(...durations) * 10) / 10,
  };
}

const token = await testSession();
const stream = await testStream(token);
console.log("Stream:", stream);
const results = await Promise.all([
  runProfile("state", 2, token),
  runProfile("monitor_state", 5, token),
  runProfile("positions", 5, token),
]);
console.table(results);
if (results.some((result) => result.errors > 0 || result.p95_ms > 500))
  process.exitCode = 1;
