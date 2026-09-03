using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using MySqlConnector;

namespace Aublst.Api;

public sealed class FrontendRepository(Db db, IWebHostEnvironment environment, IConfiguration configuration)
{
    private string MapsPath
    {
        get
        {
            var configured = configuration["MapsPath"] ?? "maps";
            var path = Path.IsPathRooted(configured) ? configured : Path.GetFullPath(Path.Combine(environment.ContentRootPath, configured));
            if (Directory.Exists(path)) return path;
            return Path.GetFullPath(Path.Combine(environment.ContentRootPath, "..", "..", "backend", "maps"));
        }
    }

    public async Task<object> StateAsync(FrontendSession session, bool monitor, long? knownRevision, CancellationToken ct)
    {
        if (knownRevision == session.Revision) return new { unchanged = true, revision = session.Revision };
        await using var connection = await db.OpenAsync(ct);
        var players = monitor ? [] : await RowsAsync(connection,
            "SELECT id, player_uid AS player_id, name FROM players WHERE session_id=@sid ORDER BY name", session.DatabaseId, ct);
        var vehicles = await RowsAsync(connection, monitor
            ? "SELECT id, game_vehicle_id, name, type, modes, x, y, status, assigned_player_id FROM vehicles WHERE session_id=@sid"
            : """
              SELECT v.*, h.created_at AS status_since FROM vehicles v
              LEFT JOIN (SELECT vehicle_id, MAX(id) latest_id FROM vehicle_status_history WHERE session_id=@sid GROUP BY vehicle_id) latest ON latest.vehicle_id=v.id
              LEFT JOIN vehicle_status_history h ON h.id=latest.latest_id WHERE v.session_id=@sid
              """, session.DatabaseId, ct);
        var events = await RowsAsync(connection,
            "SELECT * FROM events WHERE session_id=@sid AND status='active' ORDER BY created_at DESC,id DESC", session.DatabaseId, ct);
        var assignments = await AssignmentsAsync(connection, session.DatabaseId, ct);
        var hospitals = monitor ? [] : await RowsAsync(connection, "SELECT * FROM hospitals WHERE session_id=@sid", session.DatabaseId, ct);
        var reservations = monitor ? [] : await RowsAsync(connection, """
            SELECT r.id,r.vehicle_id,r.hospital_id,r.bed_type,r.status,r.created_at,r.updated_at,r.arrived_at,
                   v.game_vehicle_id,v.name AS vehicle_name,h.name AS hospital_name
            FROM hospital_reservations r JOIN vehicles v ON v.id=r.vehicle_id AND v.session_id=r.session_id
            JOIN hospitals h ON h.id=r.hospital_id AND h.session_id=r.session_id
            WHERE r.session_id=@sid ORDER BY r.created_at,r.id
            """, session.DatabaseId, ct);
        var capacities = monitor && session.MonitorShowHospitalCapacity
            ? await CapacitiesAsync(connection, session.DatabaseId, ct) : [];
        var timeRows = await RowsAsync(connection, "SELECT * FROM clock WHERE session_id=@sid", session.DatabaseId, ct);

        return new Dictionary<string, object?>
        {
            ["session"] = SessionData(session), ["players"] = players, ["vehicles"] = vehicles,
            ["hospitals"] = hospitals, ["events"] = events, ["assignments"] = assignments,
            ["hospital_reservations"] = reservations, ["monitor_hospital_capacities"] = capacities,
            ["time"] = timeRows.FirstOrDefault()
        };
    }

    public async Task<object> LogsAsync(FrontendSession session, string? since, long sinceId, CancellationToken ct)
    {
        await using var connection = await db.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT * FROM activity_logs WHERE session_id=@sid
              AND (updated_at>@since OR (updated_at=@since AND id>@sinceId))
              AND state IN ('active','disabled') ORDER BY updated_at,id LIMIT 100
            """;
        command.Parameters.AddWithValue("@sid", session.DatabaseId);
        command.Parameters.AddWithValue("@since", string.IsNullOrWhiteSpace(since) || since == "0" ? "1970-01-01 00:00:01" : since);
        command.Parameters.AddWithValue("@sinceId", Math.Max(0, sinceId));
        return new { logs = await ReadRowsAsync(command, ct) };
    }

    public async Task<object> StatusHistoryAsync(FrontendSession session, CancellationToken ct)
    {
        await using var connection = await db.OpenAsync(ct);
        return new { status_history = await RowsAsync(connection,
            "SELECT id,game_vehicle_id,vehicle_name,status,created_at FROM vehicle_status_history WHERE session_id=@sid ORDER BY created_at DESC,id DESC LIMIT 500",
            session.DatabaseId, ct) };
    }

    public async Task<object> EventVehiclesAsync(FrontendSession session, int eventId, CancellationToken ct)
    {
        await using var connection = await db.OpenAsync(ct);
        var rows = await RowsAsync(connection, """
            SELECT v.id,v.name,v.game_vehicle_id,v.status,h.mode,l.role AS leader_role,l.source AS leader_source
            FROM assignments a JOIN vehicles v ON v.session_id=a.session_id AND v.id=a.vehicle_id
            LEFT JOIN alarm_history h ON h.session_id=a.session_id AND h.event_id=a.event_id AND h.vehicle_id=a.vehicle_id AND h.mode IS NOT NULL
            LEFT JOIN event_leaders l ON l.session_id=a.session_id AND l.event_id=a.event_id AND l.vehicle_id=a.vehicle_id
            WHERE a.session_id=@sid AND a.event_id=@eventId ORDER BY v.id,h.id
            """, session.DatabaseId, ct, ("@eventId", eventId));
        var grouped = new Dictionary<int, Dictionary<string, object?>>();
        foreach (var row in rows)
        {
            var id = Convert.ToInt32(row["id"], CultureInfo.InvariantCulture);
            if (!grouped.TryGetValue(id, out var vehicle))
            {
                vehicle = new Dictionary<string, object?>(row) { ["alarm_modes"] = new List<string>() };
                vehicle.Remove("mode");
                grouped[id] = vehicle;
            }
            if (row["mode"] is string mode && mode.Trim().Length > 0) ((List<string>)vehicle["alarm_modes"]!).Add(mode);
        }
        return new { ok = true, vehicles = grouped.Values };
    }

    public async Task<object> EventLogsAsync(FrontendSession session, int eventId, CancellationToken ct) =>
        new { logs = await SessionRows(session, "SELECT * FROM activity_logs WHERE session_id=@sid AND event_id=@eventId ORDER BY updated_at,id LIMIT 100", ct, ("@eventId", eventId)) };

    public async Task<object> EventFeedbackAsync(FrontendSession session, int eventId, CancellationToken ct) =>
        new { feedback = await SessionRows(session, "SELECT id,event_id,content,created_at FROM event_feedback WHERE session_id=@sid AND event_id=@eventId ORDER BY created_at,id", ct, ("@eventId", eventId)) };

    public async Task<object> EventArchiveAsync(FrontendSession session, CancellationToken ct) => new
    {
        events = await SessionRows(session, """
            SELECT e.*,
              (SELECT COUNT(*) FROM alarm_history h WHERE h.session_id=e.session_id AND h.event_id=e.id) dispatch_count,
              (SELECT COUNT(*) FROM activity_logs l WHERE l.session_id=e.session_id AND l.event_id=e.id) log_count,
              (EXISTS(SELECT 1 FROM notes n WHERE n.session_id=e.session_id AND n.event_id=e.id AND n.content<>'')
                OR EXISTS(SELECT 1 FROM event_feedback f WHERE f.session_id=e.session_id AND f.event_id=e.id)) has_note
            FROM events e WHERE e.session_id=@sid ORDER BY e.created_at DESC,e.id DESC LIMIT 500
            """, ct)
    };

    public async Task<object?> EventRecordAsync(FrontendSession session, int eventId, CancellationToken ct)
    {
        var events = await SessionRows(session, "SELECT * FROM events WHERE session_id=@sid AND id=@eventId", ct, ("@eventId", eventId));
        if (events.Count == 0) return null;
        return new Dictionary<string, object?>
        {
            ["event"] = events[0],
            ["alarms"] = await SessionRows(session, "SELECT id,event_id,event_name,vehicle_id,game_vehicle_id,vehicle_name,assigned_player_id,player_name,mode,created_at FROM alarm_history WHERE session_id=@sid AND event_id=@eventId ORDER BY created_at,id", ct, ("@eventId", eventId)),
            ["logs"] = await SessionRows(session, "SELECT id,type,entity_id,message,long_message,state,created_at,updated_at FROM activity_logs WHERE session_id=@sid AND event_id=@eventId ORDER BY updated_at,id", ct, ("@eventId", eventId)),
            ["note"] = (await SessionRows(session, "SELECT id,content,created_at,updated_at FROM notes WHERE session_id=@sid AND event_id=@eventId", ct, ("@eventId", eventId))).FirstOrDefault(),
            ["feedback"] = await SessionRows(session, "SELECT id,event_id,content,created_at FROM event_feedback WHERE session_id=@sid AND event_id=@eventId ORDER BY created_at,id", ct, ("@eventId", eventId)),
            ["journal"] = await SessionRows(session, "SELECT id,event_id,source,action_type,summary,payload,created_at FROM event_journal WHERE session_id=@sid AND event_id=@eventId ORDER BY created_at,id", ct, ("@eventId", eventId)),
            ["positions"] = await SessionRows(session, "SELECT p.id,p.event_id,p.vehicle_id,p.x,p.y,p.status,p.recorded_at,v.game_vehicle_id,v.name vehicle_name FROM vehicle_position_history p JOIN vehicles v ON v.id=p.vehicle_id AND v.session_id=p.session_id WHERE p.session_id=@sid AND p.event_id=@eventId ORDER BY p.recorded_at,p.id", ct, ("@eventId", eventId))
        };
    }

    public async Task<object> StatisticsAsync(FrontendSession session, CancellationToken ct)
    {
        await using var connection = await db.OpenAsync(ct);
        var events = await RowsAsync(connection, "SELECT id,name,x,y,status,created_by,created_at,updated_at FROM events WHERE session_id=@sid ORDER BY created_at,id", session.DatabaseId, ct);
        var dispatches = await RowsAsync(connection, "SELECT event_id,game_vehicle_id,vehicle_name,mode,created_at FROM alarm_history WHERE session_id=@sid ORDER BY created_at,id", session.DatabaseId, ct);
        var history = await RowsAsync(connection, "SELECT game_vehicle_id,vehicle_name,status,created_at FROM vehicle_status_history WHERE session_id=@sid ORDER BY created_at,id", session.DatabaseId, ct);
        await using var count = connection.CreateCommand();
        count.CommandText = "SELECT COUNT(*) FROM activity_logs WHERE session_id=@sid";
        count.Parameters.AddWithValue("@sid", session.DatabaseId);
        var logCount = Convert.ToInt32(await count.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);
        return new Dictionary<string, object?>
        {
            ["session"] = new Dictionary<string, object?> { ["token"] = session.Code, ["mod_id"] = session.ModId, ["map_bounds"] = Bounds(session.Bounds), ["generated_at"] = Timestamp(DateTime.UtcNow) },
            ["events"] = events, ["dispatches"] = dispatches, ["status_history"] = history, ["log_count"] = logCount
        };
    }

    public async Task<JsonNode> RoutingAsync(FrontendSession session, CancellationToken ct)
    {
        JsonNode root;
        var file = SafeMapFile(session.ModId, ".routing.json");
        if (file is not null) root = JsonNode.Parse(await File.ReadAllTextAsync(file, ct)) ?? new JsonObject();
        else
        {
            await using var connection = await db.OpenAsync(ct);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT meters_per_world_unit,routing_graph FROM mods WHERE mod_id=@modId";
            command.Parameters.AddWithValue("@modId", session.ModId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            root = await reader.ReadAsync(ct) && !reader.IsDBNull(1) ? JsonNode.Parse(reader.GetString(1)) ?? new JsonObject() : new JsonObject();
        }
        root["nodes"] ??= new JsonArray(); root["edges"] ??= new JsonArray(); root["bma_zones"] ??= new JsonArray();
        root["grid_size_m"] ??= 50.0; root["meters_per_world_unit"] ??= 0.1;
        if (root["coordinate_space"]?.GetValue<string>() == "normalized") ConvertRoutingToWorld(root, session.Bounds);
        return root;
    }

    public async Task<JsonNode> SaveRoutingAsync(FrontendSession session, JsonElement body, CancellationToken ct)
    {
        var root = JsonNode.Parse(body.GetRawText()) ?? new JsonObject();
        root["coordinate_space"] ??= "world";
        root["nodes"] ??= new JsonArray(); root["edges"] ??= new JsonArray(); root["bma_zones"] ??= new JsonArray();
        root["grid_size_m"] ??= 50.0; root["meters_per_world_unit"] ??= 0.1;
        await using var connection = await db.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE mods SET meters_per_world_unit=@scale,routing_graph=@graph,updated_at=NOW() WHERE mod_id=@modId";
        command.Parameters.AddWithValue("@scale", root["meters_per_world_unit"]?.GetValue<double>() ?? 0.1);
        command.Parameters.AddWithValue("@graph", root.ToJsonString());
        command.Parameters.AddWithValue("@modId", session.ModId);
        await command.ExecuteNonQueryAsync(ct);
        root["ok"] = true;
        return root;
    }

    public (string Path, string ContentType, string Version)? MapAsset(string modId)
    {
        if (!SafeModId(modId)) return null;
        var metadata = Path.Combine(MapsPath, modId + ".map.json");
        string? image = null;
        if (File.Exists(metadata)) image = JsonNode.Parse(File.ReadAllText(metadata))?["image"]?.GetValue<string>();
        var path = image is not null && Path.GetFileName(image) == image ? Path.Combine(MapsPath, image) : null;
        if (path is null || !File.Exists(path)) path = new[] { ".webp", ".png", ".jpg", ".jpeg" }.Select(x => Path.Combine(MapsPath, modId + x)).FirstOrDefault(File.Exists);
        if (path is null) return null;
        var info = new FileInfo(path);
        var mime = info.Extension.ToLowerInvariant() switch { ".webp" => "image/webp", ".png" => "image/png", _ => "image/jpeg" };
        return (path, mime, $"{info.LastWriteTimeUtc.Ticks:x}-{info.Length:x}");
    }

    private Dictionary<string, object?> SessionData(FrontendSession session)
    {
        var map = session.ModId is null ? null : MapAsset(session.ModId);
        var routing = SafeMapFile(session.ModId, ".routing.json");
        JsonNode? rect = null;
        var metadata = session.ModId is null ? null : SafeMapFile(session.ModId, ".map.json");
        if (metadata is not null) rect = JsonNode.Parse(File.ReadAllText(metadata))?["content_rect"]?.DeepClone();
        return new Dictionary<string, object?>
        {
            ["token"] = session.Code, ["revision"] = session.Revision, ["mod_id"] = session.ModId,
            ["routing_version"] = routing is null ? null : $"{File.GetLastWriteTimeUtc(routing).Ticks}:{new FileInfo(routing).Length}",
            ["map_image_version"] = map?.Version, ["monitor_show_hospital_capacity"] = session.MonitorShowHospitalCapacity,
            ["bridge"] = BridgeData(session), ["map_content_rect"] = rect, ["map_bounds"] = Bounds(session.Bounds)
        };
    }

    public static object BridgeData(FrontendSession session)
    {
        string[] capabilities = [];
        if (!string.IsNullOrWhiteSpace(session.BridgeCapabilities))
            try { capabilities = JsonSerializer.Deserialize<string[]>(session.BridgeCapabilities) ?? []; } catch (JsonException) { }
        return new { kind = session.BridgeKind, protocol_version = session.BridgeProtocolVersion, app_version = session.BridgeAppVersion, capabilities, seen_at = session.BridgeSeenAt is null ? null : Timestamp(session.BridgeSeenAt.Value) };
    }

    private static async Task<List<Dictionary<string, object?>>> AssignmentsAsync(MySqlConnection connection, int sid, CancellationToken ct)
    {
        var rows = await RowsAsync(connection, """
            SELECT a.event_id,a.vehicle_id,h.mode,l.role leader_role,l.source leader_source FROM assignments a
            JOIN events e ON e.session_id=a.session_id AND e.id=a.event_id AND e.status='active'
            LEFT JOIN alarm_history h ON h.session_id=a.session_id AND h.event_id=a.event_id AND h.vehicle_id=a.vehicle_id AND h.mode IS NOT NULL
            LEFT JOIN event_leaders l ON l.session_id=a.session_id AND l.event_id=a.event_id AND l.vehicle_id=a.vehicle_id
            WHERE a.session_id=@sid ORDER BY a.event_id,a.vehicle_id,h.id
            """, sid, ct);
        var result = new Dictionary<string, Dictionary<string, object?>>();
        foreach (var row in rows)
        {
            var key = $"{row["event_id"]}:{row["vehicle_id"]}";
            if (!result.TryGetValue(key, out var assignment))
            {
                assignment = new Dictionary<string, object?>(row) { ["alarm_modes"] = new List<string>() };
                assignment.Remove("mode"); result[key] = assignment;
            }
            if (row["mode"] is string mode && mode.Trim().Length > 0) ((List<string>)assignment["alarm_modes"]!).Add(mode);
        }
        return result.Values.ToList();
    }

    private static async Task<List<Dictionary<string, object?>>> CapacitiesAsync(MySqlConnection connection, int sid, CancellationToken ct)
    {
        var rows = await RowsAsync(connection, """
            SELECT h.id,h.name,GREATEST(0,h.ward_available-COALESCE(SUM(CASE WHEN r.bed_type='ward' AND (r.status='reserved' OR (r.status='arrived' AND v.status=8)) THEN 1 ELSE 0 END),0)) ward,
              GREATEST(0,h.icu_available-COALESCE(SUM(CASE WHEN r.bed_type='icu' AND (r.status='reserved' OR (r.status='arrived' AND v.status=8)) THEN 1 ELSE 0 END),0)) icu
            FROM hospitals h LEFT JOIN hospital_reservations r ON r.session_id=h.session_id AND r.hospital_id=h.id
            LEFT JOIN vehicles v ON v.session_id=r.session_id AND v.id=r.vehicle_id WHERE h.session_id=@sid GROUP BY h.id,h.name,h.ward_available,h.icu_available ORDER BY h.name,h.id
            """, sid, ct);
        foreach (var row in rows)
        {
            row["ward_level"] = Capacity(Convert.ToInt32(row["ward"])); row["icu_level"] = Capacity(Convert.ToInt32(row["icu"]));
            row.Remove("ward"); row.Remove("icu");
        }
        return rows;
    }

    private async Task<List<Dictionary<string, object?>>> SessionRows(FrontendSession session, string sql, CancellationToken ct, params (string, object)[] values)
    {
        await using var connection = await db.OpenAsync(ct);
        return await RowsAsync(connection, sql, session.DatabaseId, ct, values);
    }

    internal static async Task<List<Dictionary<string, object?>>> RowsAsync(MySqlConnection connection, string sql, int sid, CancellationToken ct, params (string, object)[] values)
    {
        await using var command = connection.CreateCommand(); command.CommandText = sql; command.Parameters.AddWithValue("@sid", sid);
        foreach (var (name, value) in values) command.Parameters.AddWithValue(name, value);
        return await ReadRowsAsync(command, ct);
    }

    internal static async Task<List<Dictionary<string, object?>>> ReadRowsAsync(MySqlCommand command, CancellationToken ct)
    {
        var rows = new List<Dictionary<string, object?>>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < reader.FieldCount; i++) row[reader.GetName(i)] = DbJsonValue(reader, i);
            rows.Add(row);
        }
        return rows;
    }

    private static object? DbJsonValue(DbDataReader reader, int ordinal)
    {
        if (reader.IsDBNull(ordinal)) return null;
        var value = reader.GetValue(ordinal);
        return value switch { DateTime date => Timestamp(date), sbyte number => number != 0, byte[] bytes => Convert.ToBase64String(bytes), _ => value };
    }

    private static Dictionary<string, double> Bounds(MapBounds b) => new() { ["min_x"] = b.MinX, ["min_y"] = b.MinY, ["max_x"] = b.MaxX, ["max_y"] = b.MaxY };
    private static string Timestamp(DateTime value) => value.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss.ffffff", CultureInfo.InvariantCulture);
    private static string Capacity(int available) => available <= 0 ? "full" : available <= 2 ? "low" : "ok";
    private static bool SafeModId(string? id) => id is { Length: > 0 and <= 255 } && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' or '.');
    private string? SafeMapFile(string? modId, string suffix) { if (!SafeModId(modId)) return null; var path = Path.Combine(MapsPath, modId + suffix); return File.Exists(path) ? path : null; }

    private static void ConvertRoutingToWorld(JsonNode root, MapBounds bounds)
    {
        var rangeX = bounds.MaxX - bounds.MinX; var rangeY = bounds.MaxY - bounds.MinY;
        foreach (var node in root["nodes"]?.AsArray() ?? []) if (node is JsonObject item) { item["x"] = bounds.MinX + (item["x"]?.GetValue<double>() ?? 0) * rangeX; item["y"] = -(bounds.MinY + -(item["y"]?.GetValue<double>() ?? 0) * rangeY); }
        foreach (var zone in root["bma_zones"]?.AsArray() ?? []) foreach (var point in zone?["points"]?.AsArray() ?? []) if (point is JsonObject item) { item["x"] = bounds.MinX + (item["x"]?.GetValue<double>() ?? 0) * rangeX; item["y"] = -(bounds.MinY + -(item["y"]?.GetValue<double>() ?? 0) * rangeY); }
        root["coordinate_space"] = "world";
    }
}
