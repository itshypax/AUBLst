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
  return token;
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
const results = await Promise.all([
  runProfile("state", 2, token),
  runProfile("monitor_state", 5, token),
]);
console.table(results);
if (results.some((result) => result.errors > 0 || result.p95_ms > 500))
  process.exitCode = 1;
