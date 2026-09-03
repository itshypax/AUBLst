using System.Text.RegularExpressions;
using MySqlConnector;

namespace Aublst.Api;

public static partial class IncidentLeaderService
{
    public static async Task ReconcileAsync(MySqlConnection connection, MySqlTransaction transaction, int sessionId, int? onlyEventId, CancellationToken ct)
    {
        await using var events = new MySqlCommand("SELECT id FROM events WHERE session_id=@sid AND status='active'" + (onlyEventId is null ? "" : " AND id=@event"), connection, transaction);
        events.Parameters.AddWithValue("@sid", sessionId); if (onlyEventId is not null) events.Parameters.AddWithValue("@event", onlyEventId.Value);
        var ids = new List<int>(); await using (var reader = await events.ExecuteReaderAsync(ct)) while (await reader.ReadAsync(ct)) ids.Add(reader.GetInt32(0));
        foreach (var eventId in ids) await ReconcileEventAsync(connection, transaction, sessionId, eventId, ct);
    }

    private static async Task ReconcileEventAsync(MySqlConnection connection, MySqlTransaction transaction, int sessionId, int eventId, CancellationToken ct)
    {
        await using var command = new MySqlCommand("""
            SELECT v.id,v.game_vehicle_id,v.name,v.type,v.status,MIN(h.created_at) first_status_4_at
            FROM assignments a JOIN vehicles v ON v.id=a.vehicle_id AND v.session_id=a.session_id
            LEFT JOIN vehicle_status_history h ON h.session_id=v.session_id AND h.vehicle_id=v.id AND h.status=4
            WHERE a.session_id=@sid AND a.event_id=@event GROUP BY v.id,v.game_vehicle_id,v.name,v.type,v.status
            """, connection, transaction);
        command.Parameters.AddWithValue("@sid", sessionId); command.Parameters.AddWithValue("@event", eventId);
        var vehicles = await FrontendRepository.ReadRowsAsync(command, ct);
        await SetAutomatic(connection, transaction, sessionId, eventId, "fire", SelectFire(vehicles), ct);
        await SetAutomatic(connection, transaction, sessionId, eventId, "medical", SelectMedical(vehicles), ct);
    }

    private static async Task SetAutomatic(MySqlConnection connection, MySqlTransaction transaction, int sid, int eventId, string role, int? vehicleId, CancellationToken ct)
    {
        await using var current = new MySqlCommand("SELECT source FROM event_leaders WHERE session_id=@sid AND event_id=@event AND role=@role", connection, transaction);
        current.Parameters.AddWithValue("@sid", sid); current.Parameters.AddWithValue("@event", eventId); current.Parameters.AddWithValue("@role", role);
        var source = await current.ExecuteScalarAsync(ct); if (source?.ToString() == "manual") return;
        await Execute(connection, transaction, "DELETE FROM event_leaders WHERE session_id=@sid AND event_id=@event AND role=@role", ct, ("@sid", sid), ("@event", eventId), ("@role", role));
        if (vehicleId is not null) await Execute(connection, transaction, "INSERT INTO event_leaders(session_id,event_id,vehicle_id,role,source) VALUES(@sid,@event,@vehicle,@role,'automatic')", ct, ("@sid", sid), ("@event", eventId), ("@vehicle", vehicleId.Value), ("@role", role));
    }

    private static int? SelectMedical(List<Dictionary<string, object?>> vehicles)
    {
        if (vehicles.Count(v => HasType(v, "RTW")) < 3 && vehicles.Count(IsPhysician) < 2) return null;
        var eligible = Eligible(vehicles);
        return eligible.FirstOrDefault(IsPhysician)?.GetValueOrDefault("id") is { } physician ? Convert.ToInt32(physician)
            : eligible.FirstOrDefault(v => HasType(v, "RTW"))?.GetValueOrDefault("id") is { } rtw ? Convert.ToInt32(rtw) : null;
    }

    private static int? SelectFire(List<Dictionary<string, object?>> vehicles)
    {
        var eligible = Eligible(vehicles);
        foreach (var exact in new[] { "1_KDOW_1", "4_ELW_1" })
        {
            var found = eligible.FirstOrDefault(v => NormalizedId(v) == exact); if (found is not null) return Convert.ToInt32(found["id"]);
        }
        var vehicle = eligible.FirstOrDefault(v => HasType(v, "ELW")) ?? eligible.FirstOrDefault(v => HasType(v, "HLF"));
        return vehicle is null ? null : Convert.ToInt32(vehicle["id"]);
    }

    private static List<Dictionary<string, object?>> Eligible(List<Dictionary<string, object?>> vehicles) => vehicles
        .Where(v => Convert.ToInt32(v.GetValueOrDefault("status") ?? 0) is 3 or 4 && v.GetValueOrDefault("first_status_4_at") is not null)
        .OrderBy(v => v["first_status_4_at"]?.ToString()).ThenBy(v => Convert.ToInt32(v["id"])).ToList();
    private static bool IsPhysician(Dictionary<string, object?> vehicle) => new[] { "NEF", "NAW", "ITW", "RTH", "ITH", "CHRISTOPH" }.Any(type => HasType(vehicle, type));
    private static bool HasType(Dictionary<string, object?> vehicle, string type) => TypeBoundary(type).IsMatch(string.Join(' ', new[] { vehicle.GetValueOrDefault("game_vehicle_id"), vehicle.GetValueOrDefault("name"), vehicle.GetValueOrDefault("type") }.Where(x => x is not null)));
    private static string NormalizedId(Dictionary<string, object?> vehicle) => NonAlphaNumeric().Replace(vehicle.GetValueOrDefault("game_vehicle_id")?.ToString()?.ToUpperInvariant() ?? vehicle.GetValueOrDefault("name")?.ToString()?.ToUpperInvariant() ?? "", "_").Trim('_');
    private static Regex TypeBoundary(string type) => new($"(^|[^A-Z]){Regex.Escape(type)}([^A-Z]|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    [GeneratedRegex("[^A-Z0-9]+", RegexOptions.CultureInvariant)] private static partial Regex NonAlphaNumeric();
    private static async Task Execute(MySqlConnection c, MySqlTransaction tx, string sql, CancellationToken ct, params (string, object)[] values) { await using var command = new MySqlCommand(sql, c, tx); foreach (var (name, value) in values) command.Parameters.AddWithValue(name, value); await command.ExecuteNonQueryAsync(ct); }
}
