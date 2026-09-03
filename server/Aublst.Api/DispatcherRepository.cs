using System.Globalization;
using System.Text.Json;
using MySqlConnector;

namespace Aublst.Api;

public sealed class DispatcherRepository(Db db)
{
    public async Task<Dictionary<string, object?>> CreateEventAsync(FrontendSession session, JsonElement body, CancellationToken ct)
    {
        var name = Text(body, "name", "Event", 255);
        var x = Number(body, "x"); var y = Number(body, "y");
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        await using var insert = Command(connection, tx, "INSERT INTO events(session_id,name,x,y,status,created_by) VALUES(@sid,@name,@x,@y,'active','frontend')");
        Params(insert, session.DatabaseId, ("@name", name), ("@x", x), ("@y", y)); await insert.ExecuteNonQueryAsync(ct);
        var id = (int)insert.LastInsertedId;
        await AddCommand(connection, tx, session.DatabaseId, "event_create", new { event_id = id, name, target = new { x, y } }, ct);
        await Journal(connection, tx, session.DatabaseId, id, "event_created", "Einsatz in der Leitstelle angelegt", null, ct);
        await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct);
        return new Dictionary<string, object?> { ["id"] = id, ["session_id"] = session.DatabaseId, ["game_event_id"] = null, ["name"] = name, ["x"] = x, ["y"] = y, ["status"] = "active", ["created_by"] = "frontend" };
    }

    public async Task<bool> FinishEventAsync(FrontendSession session, int eventId, CancellationToken ct)
    {
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        var rows = await Rows(connection, tx, "SELECT game_event_id,created_by FROM events WHERE session_id=@sid AND id=@id FOR UPDATE", session.DatabaseId, ct, ("@id", eventId));
        if (rows.Count == 0 || rows[0]["created_by"]?.ToString() != "frontend") return false;
        await Execute(connection, tx, "UPDATE events SET status='completed',updated_at=NOW() WHERE session_id=@sid AND id=@id", session.DatabaseId, ct, ("@id", eventId));
        await AddCommand(connection, tx, session.DatabaseId, "event_delete", new { event_id = eventId, event_game_id = rows[0]["game_event_id"] }, ct);
        await Journal(connection, tx, session.DatabaseId, eventId, "event_finished", "Einsatz abgeschlossen", null, ct);
        await Execute(connection, tx, "DELETE FROM event_leaders WHERE session_id=@sid AND event_id=@id", session.DatabaseId, ct, ("@id", eventId));
        await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct); return true;
    }

    public async Task<string?> AssignAsync(FrontendSession session, JsonElement body, CancellationToken ct)
    {
        var eventId = Integer(body, "event_id"); var vehicleIds = Integers(body, "vehicle_ids");
        if (eventId <= 0 || vehicleIds.Count == 0) return "Einsatz und Fahrzeuge werden benötigt.";
        var playerId = NullableInteger(body, "player_id"); var modes = body.TryGetProperty("modes", out var modeElement) ? modeElement : default;
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        var events = await Rows(connection, tx, "SELECT * FROM events WHERE session_id=@sid AND id=@id FOR UPDATE", session.DatabaseId, ct, ("@id", eventId));
        if (events.Count == 0) return "Einsatz nicht gefunden.";
        var ev = events[0];
        if (ev["created_by"]?.ToString() == "frontend" && string.IsNullOrWhiteSpace(ev["game_event_id"]?.ToString())) return "Der Leitstellen-Einsatz wurde vom Spiel noch nicht übernommen. Bitte kurz warten und erneut versuchen.";
        string? playerUid = null; string? playerName = null;
        if (playerId is not null)
        {
            var players = await Rows(connection, tx, "SELECT player_uid,name FROM players WHERE session_id=@sid AND id=@id", session.DatabaseId, ct, ("@id", playerId.Value));
            if (players.Count == 0) return "Der ausgewählte Spieler ist nicht mehr verfügbar.";
            playerUid = players[0]["player_uid"]?.ToString(); playerName = players[0]["name"]?.ToString();
        }
        var names = new List<string>();
        foreach (var vehicleId in vehicleIds)
        {
            var vehicles = await Rows(connection, tx, "SELECT * FROM vehicles WHERE session_id=@sid AND id=@id FOR UPDATE", session.DatabaseId, ct, ("@id", vehicleId));
            if (vehicles.Count == 0) return $"Fahrzeug #{vehicleId} ist nicht mehr verfügbar.";
            var vehicle = vehicles[0]; var status = Convert.ToInt32(vehicle["status"] ?? 0);
            if (status is not (1 or 2) && !SupportsMultiple(vehicle)) return $"{VehicleName(vehicle)} ist inzwischen alarmiert oder nicht mehr verfügbar.";
            if (!SupportsMultiple(vehicle)) await RemoveAssignments(connection, tx, session.DatabaseId, vehicleId, null, ct);
            await Execute(connection, tx, """
                INSERT INTO assignments(session_id,event_id,vehicle_id,assigned_player_id,status) VALUES(@sid,@event,@vehicle,@player,'enroute')
                ON DUPLICATE KEY UPDATE assigned_player_id=VALUES(assigned_player_id),status=VALUES(status),updated_at=NOW()
                """, session.DatabaseId, ct, ("@event", eventId), ("@vehicle", vehicleId), ("@player", playerId ?? (object)DBNull.Value));
            var mode = ModeFor(modes, vehicleId);
            var commandId = await AddCommand(connection, tx, session.DatabaseId, "assign", new
            {
                event_id = eventId, event_game_id = ev["game_event_id"], vehicle_id = vehicleId,
                game_vehicle_id = vehicle["game_vehicle_id"], target = new { x = ev["x"], y = ev["y"] },
                assign_to_player_id = playerUid, mode
            }, ct);
            await InsertAlarmHistory(connection, tx, session.DatabaseId, commandId, ev, vehicle, playerId, playerName, mode, ct);
            if (playerId is not null) await Execute(connection, tx, "UPDATE vehicles SET assigned_player_id=@player WHERE session_id=@sid AND id=@id", session.DatabaseId, ct, ("@player", playerId.Value), ("@id", vehicleId));
            names.Add(VehicleName(vehicle));
        }
        await Journal(connection, tx, session.DatabaseId, eventId, "vehicles_dispatched", "Alarmiert: " + string.Join(", ", names), new { vehicle_ids = vehicleIds }, ct);
        await IncidentLeaderService.ReconcileAsync(connection, tx, session.DatabaseId, eventId, ct);
        await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct); return null;
    }

    public async Task<bool> UnassignAsync(FrontendSession session, JsonElement body, CancellationToken ct)
    {
        var vehicleIds = Integers(body, "vehicle_ids"); var eventId = NullableInteger(body, "event_id");
        if (vehicleIds.Count == 0) return false;
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        foreach (var vehicleId in vehicleIds)
        {
            var rows = await Rows(connection, tx, "SELECT game_vehicle_id,name FROM vehicles WHERE session_id=@sid AND id=@id", session.DatabaseId, ct, ("@id", vehicleId));
            if (rows.Count == 0) continue;
            var assignedEvents = eventId is null
                ? await Rows(connection, tx, "SELECT event_id FROM assignments WHERE session_id=@sid AND vehicle_id=@id", session.DatabaseId, ct, ("@id", vehicleId))
                : [new Dictionary<string, object?> { ["event_id"] = eventId.Value }];
            await RemoveAssignments(connection, tx, session.DatabaseId, vehicleId, eventId, ct);
            await AddCommand(connection, tx, session.DatabaseId, "unassign", new { event_id = -1, vehicle_id = vehicleId, game_vehicle_id = rows[0]["game_vehicle_id"], assign_to_player_id = (string?)null }, ct);
            foreach (var assigned in assignedEvents) await Journal(connection, tx, session.DatabaseId, Convert.ToInt32(assigned["event_id"]), "vehicles_unassigned", "Aus Einsatz gelöst: " + VehicleName(rows[0]), null, ct);
        }
        await IncidentLeaderService.ReconcileAsync(connection, tx, session.DatabaseId, eventId, ct);
        await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct); return true;
    }

    public async Task<bool> ReassignAsync(FrontendSession session, int vehicleId, int eventId, CancellationToken ct)
    {
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        var vehicleRows = await Rows(connection, tx, "SELECT * FROM vehicles WHERE session_id=@sid AND id=@id FOR UPDATE", session.DatabaseId, ct, ("@id", vehicleId));
        var eventRows = await Rows(connection, tx, "SELECT id FROM events WHERE session_id=@sid AND id=@id AND status='active'", session.DatabaseId, ct, ("@id", eventId));
        if (vehicleRows.Count == 0 || eventRows.Count == 0) return false;
        var status = Convert.ToInt32(vehicleRows[0]["status"] ?? 0); if (status is not (3 or 4)) return false;
        var old = await Rows(connection, tx, "SELECT event_id,assigned_player_id FROM assignments WHERE session_id=@sid AND vehicle_id=@id LIMIT 1", session.DatabaseId, ct, ("@id", vehicleId));
        await RemoveAssignments(connection, tx, session.DatabaseId, vehicleId, null, ct);
        await Execute(connection, tx, "INSERT INTO assignments(session_id,event_id,vehicle_id,assigned_player_id,status) VALUES(@sid,@event,@vehicle,@player,@status)", session.DatabaseId, ct,
            ("@event", eventId), ("@vehicle", vehicleId), ("@player", old.FirstOrDefault()?["assigned_player_id"] ?? DBNull.Value), ("@status", status == 4 ? "on_scene" : "enroute"));
        await Journal(connection, tx, session.DatabaseId, eventId, "vehicle_reassigned", VehicleName(vehicleRows[0]) + " diesem Einsatz zugeordnet", null, ct);
        await IncidentLeaderService.ReconcileAsync(connection, tx, session.DatabaseId, eventId, ct);
        await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct); return true;
    }

    public async Task<bool> SetLeaderAsync(FrontendSession session, int eventId, int? vehicleId, string role, CancellationToken ct)
    {
        if (eventId <= 0 || role is not ("fire" or "medical")) return false;
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        if (vehicleId is > 0)
        {
            var rows = await Rows(connection, tx, "SELECT v.* FROM assignments a JOIN vehicles v ON v.id=a.vehicle_id AND v.session_id=a.session_id WHERE a.session_id=@sid AND a.event_id=@event AND a.vehicle_id=@vehicle", session.DatabaseId, ct, ("@event", eventId), ("@vehicle", vehicleId.Value));
            if (rows.Count == 0 || Convert.ToInt32(rows[0]["status"] ?? 0) is not (3 or 4)) return false;
        }
        await Execute(connection, tx, "DELETE FROM event_leaders WHERE session_id=@sid AND event_id=@event AND role=@role", session.DatabaseId, ct, ("@event", eventId), ("@role", role));
        if (vehicleId is > 0) await Execute(connection, tx, "INSERT INTO event_leaders(session_id,event_id,vehicle_id,role,source) VALUES(@sid,@event,@vehicle,@role,'manual')", session.DatabaseId, ct, ("@event", eventId), ("@vehicle", vehicleId.Value), ("@role", role));
        else await IncidentLeaderService.ReconcileAsync(connection, tx, session.DatabaseId, eventId, ct);
        await Journal(connection, tx, session.DatabaseId, eventId, "leader_changed", (role == "medical" ? "Einsatzleiter RD" : "Einsatzleiter FW") + (vehicleId is > 0 ? $": Fahrzeug #{vehicleId}" : " auf Automatik gesetzt"), null, ct);
        await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct); return true;
    }

    public async Task<Dictionary<string, object?>?> AddFeedbackAsync(FrontendSession session, int eventId, string content, CancellationToken ct)
    {
        content = content.Trim(); if (eventId <= 0 || content.Length is 0 or > 4000) return null;
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        await using var command = Command(connection, tx, "INSERT INTO event_feedback(session_id,event_id,content) SELECT @sid,@event,@content FROM events WHERE session_id=@sid AND id=@event");
        Params(command, session.DatabaseId, ("@event", eventId), ("@content", content)); if (await command.ExecuteNonQueryAsync(ct) == 0) return null;
        var id = (int)command.LastInsertedId; await Journal(connection, tx, session.DatabaseId, eventId, "feedback_added", "Rückmeldung ergänzt", null, ct); await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct);
        return new Dictionary<string, object?> { ["id"] = id, ["event_id"] = eventId, ["content"] = content, ["created_at"] = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) };
    }

    public async Task AlarmVehicleAsync(FrontendSession session, int vehicleId, string? mode, CancellationToken ct)
    {
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        var rows = await Rows(connection, tx, "SELECT * FROM vehicles WHERE session_id=@sid AND id=@id", session.DatabaseId, ct, ("@id", vehicleId)); if (rows.Count == 0) return;
        var vehicle = rows[0]; var commandId = await AddCommand(connection, tx, session.DatabaseId, "assign", new { event_id = (int?)null, event_game_id = (string?)null, vehicle_id = vehicleId, game_vehicle_id = vehicle["game_vehicle_id"], target = new { x = vehicle["x"], y = vehicle["y"] }, assign_to_player_id = (string?)null, mode }, ct);
        await InsertAlarmHistory(connection, tx, session.DatabaseId, commandId, null, vehicle, null, null, mode, ct); await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct);
    }

    public async Task SetMonitorCapacityAsync(FrontendSession session, bool enabled, CancellationToken ct) => await SimpleWrite(session, "UPDATE sessions SET monitor_show_hospital_capacity=@value WHERE id=@sid", ct, ("@value", enabled));

    public async Task SetVehiclePlayerAsync(FrontendSession session, int vehicleId, int playerId, CancellationToken ct) =>
        await SimpleWrite(session, "UPDATE vehicles SET assigned_player_id=@player WHERE session_id=@sid AND id=@vehicle", ct, ("@player", playerId), ("@vehicle", vehicleId));

    public async Task<Dictionary<string, object?>> SetNoteAsync(FrontendSession session, int eventId, string content, CancellationToken ct)
    {
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        await Execute(connection, tx, "INSERT INTO notes(session_id,event_id,content) VALUES(@sid,@event,@content) ON DUPLICATE KEY UPDATE content=VALUES(content),updated_at=NOW()", session.DatabaseId, ct, ("@event", eventId), ("@content", content));
        await Journal(connection, tx, session.DatabaseId, eventId, "note_changed", "Einsatznotiz geändert", null, ct); await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct);
        return new Dictionary<string, object?> { ["event_id"] = eventId, ["content"] = content };
    }

    public async Task<bool> SetHospitalAsync(FrontendSession session, int vehicleId, int hospitalId, string bedType, CancellationToken ct)
    {
        if (bedType is not ("ward" or "icu")) return false;
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        var vehicles = await Rows(connection, tx, "SELECT * FROM vehicles WHERE session_id=@sid AND id=@id", session.DatabaseId, ct, ("@id", vehicleId));
        var hospitals = await Rows(connection, tx, "SELECT * FROM hospitals WHERE session_id=@sid AND id=@id", session.DatabaseId, ct, ("@id", hospitalId));
        if (vehicles.Count == 0 || hospitals.Count == 0) return false;
        var available = Convert.ToInt32(hospitals[0][bedType == "icu" ? "icu_available" : "ward_available"] ?? 0);
        await Execute(connection, tx, """
            INSERT INTO hospital_reservations(session_id,vehicle_id,hospital_id,bed_type,status,baseline_available) VALUES(@sid,@vehicle,@hospital,@bed,'reserved',@available)
            ON DUPLICATE KEY UPDATE hospital_id=VALUES(hospital_id),bed_type=VALUES(bed_type),status='reserved',baseline_available=VALUES(baseline_available),arrived_at=NULL,updated_at=NOW()
            """, session.DatabaseId, ct, ("@vehicle", vehicleId), ("@hospital", hospitalId), ("@bed", bedType), ("@available", available));
        await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct); return true;
    }

    public async Task ClearHospitalAsync(FrontendSession session, int vehicleId, CancellationToken ct) => await SimpleWrite(session, "DELETE FROM hospital_reservations WHERE session_id=@sid AND vehicle_id=@vehicle", ct, ("@vehicle", vehicleId));

    public async Task<(List<int> Ids, string? UpdatedAt)?> UpdateLogAsync(FrontendSession session, int id, bool acknowledge, CancellationToken ct)
    {
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        var rows = await Rows(connection, tx, "SELECT occurrence_id,event_id FROM activity_logs WHERE session_id=@sid AND id=@id", session.DatabaseId, ct, ("@id", id)); if (rows.Count == 0) return null;
        var occurrence = Convert.ToInt32(rows[0]["occurrence_id"] ?? 0); var ids = occurrence > 0
            ? (await Rows(connection, tx, "SELECT id FROM activity_logs WHERE session_id=@sid AND occurrence_id=@occ", session.DatabaseId, ct, ("@occ", occurrence))).Select(x => Convert.ToInt32(x["id"])).ToList()
            : [id];
        if (acknowledge) await Execute(connection, tx, occurrence > 0 ? "UPDATE activity_logs SET acknowledged=1,updated_at=NOW(6) WHERE session_id=@sid AND occurrence_id=@occ AND state='active'" : "UPDATE activity_logs SET acknowledged=1,updated_at=NOW(6) WHERE session_id=@sid AND id=@id AND state='active'", session.DatabaseId, ct, occurrence > 0 ? [("@occ", (object)occurrence)] : [("@id", (object)id)]);
        else
        {
            if (occurrence > 0) await Execute(connection, tx, "UPDATE speech_request_occurrences SET state='inactive',updated_at=NOW(6) WHERE session_id=@sid AND id=@occ", session.DatabaseId, ct, ("@occ", occurrence));
            await Execute(connection, tx, occurrence > 0 ? "UPDATE activity_logs SET state='inactive',updated_at=NOW(6) WHERE session_id=@sid AND occurrence_id=@occ" : "UPDATE activity_logs SET state='inactive',updated_at=NOW(6) WHERE session_id=@sid AND id=@id", session.DatabaseId, ct, occurrence > 0 ? [("@occ", (object)occurrence)] : [("@id", (object)id)]);
        }
        await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct); return (ids, DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss.ffffff", CultureInfo.InvariantCulture));
    }

    public async Task RecordMetricsAsync(JsonElement body, CancellationToken ct)
    {
        if (!body.TryGetProperty("metrics", out var metrics) || metrics.ValueKind != JsonValueKind.Object) return;
        await using var connection = await db.OpenAsync(ct);
        foreach (var metric in metrics.EnumerateObject())
        {
            if (metric.Name is not ("state_load_ms" or "active_events") || !metric.Value.TryGetDouble(out var value)) continue;
            await using var command = connection.CreateCommand(); command.CommandText = "INSERT INTO anonymous_metrics(metric_day,metric_name,sample_count,value_sum,value_max) VALUES(CURRENT_DATE,@name,1,@value,@value) ON DUPLICATE KEY UPDATE sample_count=sample_count+1,value_sum=value_sum+VALUES(value_sum),value_max=GREATEST(value_max,VALUES(value_max))";
            command.Parameters.AddWithValue("@name", metric.Name); command.Parameters.AddWithValue("@value", value); await command.ExecuteNonQueryAsync(ct);
        }
    }

    private async Task SimpleWrite(FrontendSession session, string sql, CancellationToken ct, params (string, object)[] args)
    {
        await using var connection = await db.OpenAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct); await Execute(connection, tx, sql, session.DatabaseId, ct, args); await Touch(connection, tx, session.DatabaseId, ct); await tx.CommitAsync(ct);
    }

    private static async Task RemoveAssignments(MySqlConnection c, MySqlTransaction tx, int sid, int vehicleId, int? eventId, CancellationToken ct)
    {
        var condition = eventId is null ? "" : " AND event_id=@event";
        await Execute(c, tx, "DELETE FROM event_leaders WHERE session_id=@sid AND vehicle_id=@vehicle" + condition, sid, ct, ("@vehicle", vehicleId), ("@event", eventId ?? 0));
        await Execute(c, tx, "DELETE FROM assignments WHERE session_id=@sid AND vehicle_id=@vehicle" + condition, sid, ct, ("@vehicle", vehicleId), ("@event", eventId ?? 0));
    }

    private static async Task<int> AddCommand(MySqlConnection c, MySqlTransaction tx, int sid, string type, object payload, CancellationToken ct)
    {
        await using var command = Command(c, tx, "INSERT INTO commands(session_id,type,payload) VALUES(@sid,@type,@payload)"); Params(command, sid, ("@type", type), ("@payload", JsonSerializer.Serialize(payload))); await command.ExecuteNonQueryAsync(ct); return (int)command.LastInsertedId;
    }

    private static async Task InsertAlarmHistory(MySqlConnection c, MySqlTransaction tx, int sid, int commandId, Dictionary<string, object?>? ev, Dictionary<string, object?> vehicle, int? playerId, string? playerName, string? mode, CancellationToken ct) =>
        await Execute(c, tx, "INSERT INTO alarm_history(session_id,command_id,event_id,event_name,vehicle_id,game_vehicle_id,vehicle_name,assigned_player_id,player_name,mode) VALUES(@sid,@command,@event,@eventName,@vehicle,@gameVehicle,@vehicleName,@player,@playerName,@mode)", sid, ct,
            ("@command", commandId), ("@event", ev?["id"] ?? DBNull.Value), ("@eventName", ev?["name"] ?? DBNull.Value), ("@vehicle", vehicle["id"]!), ("@gameVehicle", vehicle["game_vehicle_id"]!), ("@vehicleName", vehicle["name"] ?? DBNull.Value), ("@player", playerId ?? (object)DBNull.Value), ("@playerName", playerName ?? (object)DBNull.Value), ("@mode", mode ?? (object)DBNull.Value));

    private static async Task Journal(MySqlConnection c, MySqlTransaction tx, int sid, int eventId, string action, string summary, object? payload, CancellationToken ct) =>
        await Execute(c, tx, "INSERT INTO event_journal(session_id,event_id,source,action_type,summary,payload) VALUES(@sid,@event,'dispatcher',@action,@summary,@payload)", sid, ct, ("@event", eventId), ("@action", action), ("@summary", summary), ("@payload", payload is null ? DBNull.Value : JsonSerializer.Serialize(payload)));

    private static async Task Touch(MySqlConnection c, MySqlTransaction tx, int sid, CancellationToken ct) => await Execute(c, tx, "UPDATE sessions SET revision=revision+1,last_activity_at=NOW() WHERE id=@sid", sid, ct);
    private static async Task<int> Execute(MySqlConnection c, MySqlTransaction tx, string sql, int sid, CancellationToken ct, params (string, object)[] args) { await using var command = Command(c, tx, sql); Params(command, sid, args); return await command.ExecuteNonQueryAsync(ct); }
    private static async Task<List<Dictionary<string, object?>>> Rows(MySqlConnection c, MySqlTransaction tx, string sql, int sid, CancellationToken ct, params (string, object)[] args) { await using var command = Command(c, tx, sql); Params(command, sid, args); return await FrontendRepository.ReadRowsAsync(command, ct); }
    private static MySqlCommand Command(MySqlConnection c, MySqlTransaction tx, string sql) => new(sql, c, tx);
    private static void Params(MySqlCommand command, int sid, params (string, object)[] args) { command.Parameters.AddWithValue("@sid", sid); foreach (var (name, value) in args) if (!command.Parameters.Contains(name)) command.Parameters.AddWithValue(name, value ?? DBNull.Value); }
    private static string VehicleName(Dictionary<string, object?> row) => string.IsNullOrWhiteSpace(row.GetValueOrDefault("name")?.ToString()) ? row.GetValueOrDefault("game_vehicle_id")?.ToString() ?? "Fahrzeug" : row["name"]!.ToString()!;
    private static bool SupportsMultiple(Dictionary<string, object?> vehicle) => VehicleRules.IsUntracked(vehicle.GetValueOrDefault("game_vehicle_id")?.ToString(), vehicle.GetValueOrDefault("type")?.ToString());
    private static string? ModeFor(JsonElement modes, int vehicleId) { if (modes.ValueKind != JsonValueKind.Object || !modes.TryGetProperty(vehicleId.ToString(CultureInfo.InvariantCulture), out var value)) return null; return value.ValueKind == JsonValueKind.String ? value.GetString() : null; }
    private static string Text(JsonElement body, string name, string fallback, int max) { if (!body.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String) return fallback; var text = value.GetString()?.Trim() ?? fallback; return text.Length > max ? text[..max] : text; }
    private static double Number(JsonElement body, string name) => body.TryGetProperty(name, out var value) && value.TryGetDouble(out var number) ? number : 0;
    private static int Integer(JsonElement body, string name) => body.TryGetProperty(name, out var value) && value.TryGetInt32(out var number) ? number : 0;
    private static int? NullableInteger(JsonElement body, string name) => body.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null && value.TryGetInt32(out var number) ? number : null;
    private static List<int> Integers(JsonElement body, string name) => body.TryGetProperty(name, out var values) && values.ValueKind == JsonValueKind.Array ? values.EnumerateArray().Select(x => x.TryGetInt32(out var n) ? n : 0).Where(x => x > 0).Distinct().ToList() : [];
}
