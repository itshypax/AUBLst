using System.Text.Json;
using MySqlConnector;

namespace Aublst.Api;

public sealed class SnapshotRepository(Db db)
{
    public async Task<SnapshotResponse> ApplyAsync(
        BridgeSession session,
        SnapshotRequest snapshot,
        CancellationToken cancellationToken)
    {
        await using var connection = await db.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using var lockSession = new MySqlCommand(
            "SELECT last_bridge_sequence, revision FROM sessions WHERE id = @id FOR UPDATE",
            connection,
            transaction);
        lockSession.Parameters.AddWithValue("@id", session.DatabaseId);
        ulong currentSequence;
        long currentRevision;
        await using (var reader = await lockSession.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken)) throw new InvalidOperationException("Session disappeared.");
            currentSequence = reader.GetUInt64(0);
            currentRevision = reader.GetInt64(1);
        }

        if (snapshot.Sequence <= currentSequence)
        {
            await transaction.CommitAsync(cancellationToken);
            return new SnapshotResponse(false, currentSequence, currentRevision);
        }

        if (!string.IsNullOrWhiteSpace(snapshot.ModId))
        {
            await ExecuteAsync(connection, transaction,
                "INSERT IGNORE INTO mods (mod_id) VALUES (@modId)",
                cancellationToken, ("@modId", snapshot.ModId.Trim()));
        }

        if (snapshot.Players is not null)
            await ApplyPlayersAsync(connection, transaction, session.DatabaseId, snapshot.Players, cancellationToken);
        if (snapshot.Vehicles is not null)
            await ApplyVehiclesAsync(connection, transaction, session.DatabaseId, snapshot.Vehicles, cancellationToken);
        if (snapshot.Hospitals is not null)
            await ApplyHospitalsAsync(connection, transaction, session.DatabaseId, snapshot.Hospitals, cancellationToken);
        if (snapshot.Messages is not null)
            await ApplyMessagesAsync(connection, transaction, session.DatabaseId, snapshot.Messages, cancellationToken);
        if (snapshot.Events is not null)
            await ApplyEventsAsync(connection, transaction, session.DatabaseId, snapshot.Events, cancellationToken);
        if (snapshot.Vehicles is not null || snapshot.Events is not null)
            await IncidentLeaderService.ReconcileAsync(connection, transaction, session.DatabaseId, null, cancellationToken);
        if (snapshot.Time is not null)
            await ExecuteAsync(connection, transaction, """
                INSERT INTO clock (session_id, time_hours, time_minutes) VALUES (@sessionId, @hours, @minutes)
                ON DUPLICATE KEY UPDATE time_hours = VALUES(time_hours), time_minutes = VALUES(time_minutes)
                """, cancellationToken,
                ("@sessionId", session.DatabaseId), ("@hours", snapshot.Time.H), ("@minutes", snapshot.Time.M));

        var bounds = snapshot.MapBounds;
        await using var touch = new MySqlCommand("""
            UPDATE sessions
            SET last_bridge_sequence = @sequence,
                bridge_seen_at = NOW(6),
                last_activity_at = NOW(6),
                revision = revision + 1,
                mod_id = COALESCE(mod_id, @modId),
                min_x = COALESCE(@minX, min_x), min_y = COALESCE(@minY, min_y),
                max_x = COALESCE(@maxX, max_x), max_y = COALESCE(@maxY, max_y)
            WHERE id = @sessionId
            """, connection, transaction);
        touch.Parameters.AddWithValue("@sequence", snapshot.Sequence);
        touch.Parameters.AddWithValue("@modId", DbValue(snapshot.ModId));
        touch.Parameters.AddWithValue("@minX", bounds is null ? DBNull.Value : bounds.MinX);
        touch.Parameters.AddWithValue("@minY", bounds is null ? DBNull.Value : bounds.MinY);
        touch.Parameters.AddWithValue("@maxX", bounds is null ? DBNull.Value : bounds.MaxX);
        touch.Parameters.AddWithValue("@maxY", bounds is null ? DBNull.Value : bounds.MaxY);
        touch.Parameters.AddWithValue("@sessionId", session.DatabaseId);
        await touch.ExecuteNonQueryAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return new SnapshotResponse(true, snapshot.Sequence, currentRevision + 1);
    }

    public async Task UpdateHeartbeatAsync(
        BridgeSession session,
        HeartbeatRequest heartbeat,
        CancellationToken cancellationToken)
    {
        await using var connection = await db.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE sessions SET bridge_seen_at = NOW(6), last_activity_at = NOW(6),
                bridge_app_version = @appVersion,
                bridge_capabilities = @capabilities,
                bridge_health = @health
            WHERE id = @sessionId
            """;
        command.Parameters.AddWithValue("@appVersion", DbValue(heartbeat.AppVersion));
        command.Parameters.AddWithValue("@capabilities", heartbeat.Capabilities is { Count: > 0 }
            ? JsonSerializer.Serialize(heartbeat.Capabilities)
            : DBNull.Value);
        command.Parameters.AddWithValue("@health", JsonSerializer.Serialize(heartbeat));
        command.Parameters.AddWithValue("@sessionId", session.DatabaseId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task ApplyPlayersAsync(
        MySqlConnection connection,
        MySqlTransaction transaction,
        int sessionId,
        IReadOnlyList<PlayerSnapshot> players,
        CancellationToken cancellationToken)
    {
        var valid = players.Where(p => !string.IsNullOrWhiteSpace(p.PlayerId))
            .DistinctBy(p => p.PlayerId, StringComparer.Ordinal).ToArray();
        foreach (var player in valid)
            await ExecuteAsync(connection, transaction, """
                INSERT INTO players (session_id, player_uid, name) VALUES (@sessionId, @playerId, @name)
                ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = NOW(6)
                """, cancellationToken,
                ("@sessionId", sessionId), ("@playerId", player.PlayerId),
                ("@name", string.IsNullOrWhiteSpace(player.Name) ? player.PlayerId : player.Name));

        if (valid.Length == 0)
        {
            await ExecuteAsync(connection, transaction, "DELETE FROM players WHERE session_id = @sessionId",
                cancellationToken, ("@sessionId", sessionId));
            return;
        }

        await using var delete = new MySqlCommand(
            $"DELETE FROM players WHERE session_id = @sessionId AND player_uid NOT IN ({Placeholders("player", valid.Length)})",
            connection, transaction);
        delete.Parameters.AddWithValue("@sessionId", sessionId);
        for (var i = 0; i < valid.Length; i++) delete.Parameters.AddWithValue($"@player{i}", valid[i].PlayerId);
        await delete.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task ApplyVehiclesAsync(
        MySqlConnection connection,
        MySqlTransaction transaction,
        int sessionId,
        IReadOnlyList<VehicleSnapshot> vehicles,
        CancellationToken cancellationToken)
    {
        foreach (var vehicle in vehicles.Where(v => !string.IsNullOrWhiteSpace(v.GameVehicleId)))
        {
            int? previousStatus = null;
            long? vehicleId = null;
            await using (var existing = new MySqlCommand(
                "SELECT id, status FROM vehicles WHERE session_id = @sessionId AND game_vehicle_id = @gameId",
                connection, transaction))
            {
                existing.Parameters.AddWithValue("@sessionId", sessionId);
                existing.Parameters.AddWithValue("@gameId", vehicle.GameVehicleId);
                await using var reader = await existing.ExecuteReaderAsync(cancellationToken);
                if (await reader.ReadAsync(cancellationToken))
                {
                    vehicleId = reader.GetInt64(0);
                    previousStatus = reader.IsDBNull(1) ? null : reader.GetInt32(1);
                }
            }

            await using var upsert = new MySqlCommand("""
                INSERT INTO vehicles (session_id, game_vehicle_id, name, type, modes, x, y, status)
                VALUES (@sessionId, @gameId, @name, @type, @modes, @x, @y, @status)
                ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id),
                    name = COALESCE(VALUES(name), name), type = COALESCE(VALUES(type), type),
                    modes = COALESCE(VALUES(modes), modes), x = COALESCE(VALUES(x), x),
                    y = COALESCE(VALUES(y), y), status = COALESCE(VALUES(status), status), updated_at = NOW(6)
                """, connection, transaction);
            upsert.Parameters.AddWithValue("@sessionId", sessionId);
            upsert.Parameters.AddWithValue("@gameId", vehicle.GameVehicleId.Trim());
            upsert.Parameters.AddWithValue("@name", DbValue(vehicle.Name));
            upsert.Parameters.AddWithValue("@type", DbValue(vehicle.Type));
            upsert.Parameters.AddWithValue("@modes", DbValue(vehicle.Modes));
            upsert.Parameters.AddWithValue("@x", DbValue(vehicle.X));
            upsert.Parameters.AddWithValue("@y", DbValue(vehicle.Y));
            upsert.Parameters.AddWithValue("@status", DbValue(vehicle.Status));
            await upsert.ExecuteNonQueryAsync(cancellationToken);
            vehicleId ??= upsert.LastInsertedId;

            if (vehicle.Status is >= 0 and <= 9 && vehicle.Status != previousStatus)
                await ExecuteAsync(connection, transaction, """
                    INSERT INTO vehicle_status_history
                        (session_id, vehicle_id, game_vehicle_id, vehicle_name, status)
                    VALUES (@sessionId, @vehicleId, @gameId, @name, @status)
                    """, cancellationToken,
                    ("@sessionId", sessionId), ("@vehicleId", vehicleId.Value),
                    ("@gameId", vehicle.GameVehicleId), ("@name", DbValue(vehicle.Name)),
                    ("@status", vehicle.Status.Value));

            if (vehicle.Status is 1 or 2)
                await ExecuteAsync(connection, transaction,
                    "DELETE FROM hospital_reservations WHERE session_id = @sessionId AND vehicle_id = @vehicleId",
                    cancellationToken, ("@sessionId", sessionId), ("@vehicleId", vehicleId.Value));
            if (vehicle.Status == 2 && !VehicleRules.IsUntracked(vehicle.GameVehicleId, vehicle.Type))
                await ExecuteAsync(connection, transaction,
                    "DELETE FROM assignments WHERE session_id = @sessionId AND vehicle_id = @vehicleId",
                    cancellationToken, ("@sessionId", sessionId), ("@vehicleId", vehicleId.Value));
            if (vehicle.Status == 8)
                await ExecuteAsync(connection, transaction, """
                    UPDATE hospital_reservations SET status = 'arrived',
                        arrived_at = COALESCE(arrived_at, NOW(6)), updated_at = NOW(6)
                    WHERE session_id = @sessionId AND vehicle_id = @vehicleId AND status = 'reserved'
                    """, cancellationToken, ("@sessionId", sessionId), ("@vehicleId", vehicleId.Value));

            var sampled = await ExecuteAsync(connection, transaction, """
                INSERT INTO vehicle_position_history (session_id, event_id, vehicle_id, x, y, status)
                SELECT a.session_id, a.event_id, v.id, v.x, v.y, v.status
                FROM assignments a
                JOIN events e ON e.id = a.event_id AND e.session_id = a.session_id AND e.status = 'active'
                JOIN vehicles v ON v.id = a.vehicle_id AND v.session_id = a.session_id
                WHERE a.session_id = @sessionId AND a.vehicle_id = @vehicleId
                  AND v.x IS NOT NULL AND v.y IS NOT NULL AND v.status IS NOT NULL
                  AND (a.last_position_sample_at IS NULL
                       OR a.last_position_sample_at <= DATE_SUB(NOW(6), INTERVAL 10 SECOND))
                """, cancellationToken, ("@sessionId", sessionId), ("@vehicleId", vehicleId.Value));
            if (sampled > 0)
                await ExecuteAsync(connection, transaction, """
                    UPDATE assignments SET last_position_sample_at = NOW(6)
                    WHERE session_id = @sessionId AND vehicle_id = @vehicleId
                    """, cancellationToken, ("@sessionId", sessionId), ("@vehicleId", vehicleId.Value));
        }
    }

    private static async Task ApplyHospitalsAsync(
        MySqlConnection connection,
        MySqlTransaction transaction,
        int sessionId,
        IReadOnlyList<HospitalSnapshot> hospitals,
        CancellationToken cancellationToken)
    {
        foreach (var hospital in hospitals.Where(h => !string.IsNullOrWhiteSpace(h.GameHospitalId)))
        {
            await ExecuteAsync(connection, transaction, """
                INSERT INTO hospitals
                    (session_id, game_hospital_id, name, x, y, icu_available, ward_available, icu_total, ward_total)
                VALUES (@sessionId, @gameId, @name, @x, @y, @icuAvailable, @wardAvailable, @icuTotal, @wardTotal)
                ON DUPLICATE KEY UPDATE name = VALUES(name), x = VALUES(x), y = VALUES(y),
                    icu_available = VALUES(icu_available), ward_available = VALUES(ward_available),
                    icu_total = VALUES(icu_total), ward_total = VALUES(ward_total), updated_at = NOW(6)
                """, cancellationToken,
                ("@sessionId", sessionId), ("@gameId", hospital.GameHospitalId.Trim()),
                ("@name", DbValue(hospital.Name)), ("@x", DbValue(hospital.X)), ("@y", DbValue(hospital.Y)),
                ("@icuAvailable", DbValue(hospital.IcuAvailable)), ("@wardAvailable", DbValue(hospital.WardAvailable)),
                ("@icuTotal", DbValue(hospital.IcuTotal)), ("@wardTotal", DbValue(hospital.WardTotal)));

            await using var find = new MySqlCommand("""
                SELECT id FROM hospitals WHERE session_id = @sessionId AND game_hospital_id = @gameId
                """, connection, transaction);
            find.Parameters.AddWithValue("@sessionId", sessionId);
            find.Parameters.AddWithValue("@gameId", hospital.GameHospitalId.Trim());
            var hospitalId = Convert.ToInt32(await find.ExecuteScalarAsync(cancellationToken));
            if (hospital.WardAvailable is not null)
                await ReconcileReservationsAsync(connection, transaction, sessionId, hospitalId, "ward", hospital.WardAvailable.Value, cancellationToken);
            if (hospital.IcuAvailable is not null)
                await ReconcileReservationsAsync(connection, transaction, sessionId, hospitalId, "icu", hospital.IcuAvailable.Value, cancellationToken);
        }
    }

    private static async Task ApplyEventsAsync(
        MySqlConnection connection,
        MySqlTransaction transaction,
        int sessionId,
        IReadOnlyList<EventSnapshot> events,
        CancellationToken cancellationToken)
    {
        foreach (var gameEvent in events)
        {
            var status = gameEvent.Status is "active" or "completed" or "canceled" ? gameEvent.Status : "active";
            if (!string.IsNullOrWhiteSpace(gameEvent.GameEventId))
                await ExecuteAsync(connection, transaction, """
                    INSERT INTO events (session_id, game_event_id, name, x, y, status, created_by)
                    VALUES (@sessionId, @gameId, @name, @x, @y, @status, 'game')
                    ON DUPLICATE KEY UPDATE name = VALUES(name), x = VALUES(x), y = VALUES(y),
                        status = VALUES(status), updated_at = NOW(6)
                    """, cancellationToken,
                    ("@sessionId", sessionId), ("@gameId", gameEvent.GameEventId.Trim()),
                    ("@name", DbValue(gameEvent.Name)), ("@x", DbValue(gameEvent.X)), ("@y", DbValue(gameEvent.Y)),
                    ("@status", status));
            else if (gameEvent.Id is > 0)
                await ExecuteAsync(connection, transaction, """
                    UPDATE events SET name = COALESCE(@name, name), x = COALESCE(@x, x),
                        y = COALESCE(@y, y), status = @status, updated_at = NOW(6)
                    WHERE session_id = @sessionId AND id = @id
                    """, cancellationToken,
                    ("@sessionId", sessionId), ("@id", gameEvent.Id.Value), ("@name", DbValue(gameEvent.Name)),
                    ("@x", DbValue(gameEvent.X)), ("@y", DbValue(gameEvent.Y)), ("@status", status));
        }
    }

    private static async Task ApplyMessagesAsync(
        MySqlConnection connection,
        MySqlTransaction transaction,
        int sessionId,
        IReadOnlyList<MessageSnapshot> messages,
        CancellationToken cancellationToken)
    {
        foreach (var message in messages.Where(m => !string.IsNullOrWhiteSpace(m.Message)))
        {
            var inferredEventId = message.EventId;
            if (inferredEventId is null && !string.IsNullOrWhiteSpace(message.EntityId))
            {
                await using var findEvent = new MySqlCommand("""
                    SELECT a.event_id FROM assignments a
                    JOIN vehicles v ON v.id = a.vehicle_id AND v.session_id = a.session_id
                    WHERE v.session_id = @sessionId AND v.game_vehicle_id = @entityId
                    ORDER BY a.updated_at DESC LIMIT 1
                    """, connection, transaction);
                findEvent.Parameters.AddWithValue("@sessionId", sessionId);
                findEvent.Parameters.AddWithValue("@entityId", message.EntityId);
                var value = await findEvent.ExecuteScalarAsync(cancellationToken);
                if (value is not null and not DBNull) inferredEventId = Convert.ToInt32(value);
            }

            var type = message.Type is "global" or "event" or "vehicle"
                ? message.Type
                : inferredEventId is not null ? "event"
                : string.IsNullOrWhiteSpace(message.EntityId) ? "global" : "vehicle";
            var state = message.State is "active" or "inactive" or "disabled" ? message.State : "active";
            var occurrenceId = 0L;
            if (IsSpeechRequest(message) && !string.IsNullOrWhiteSpace(message.EntityId))
            {
                await using var occurrence = new MySqlCommand("""
                    INSERT INTO speech_request_occurrences (session_id, entity_id, event_id, state)
                    VALUES (@sessionId, @entityId, @eventId, 'active')
                    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), event_id = COALESCE(VALUES(event_id), event_id)
                    """, connection, transaction);
                occurrence.Parameters.AddWithValue("@sessionId", sessionId);
                occurrence.Parameters.AddWithValue("@entityId", message.EntityId);
                occurrence.Parameters.AddWithValue("@eventId", DbValue(inferredEventId));
                await occurrence.ExecuteNonQueryAsync(cancellationToken);
                occurrenceId = occurrence.LastInsertedId;
                state = "active";
            }

            await ExecuteAsync(connection, transaction, """
                INSERT INTO activity_logs
                    (session_id, type, entity_id, event_id, message, occurrence_id, long_message, meta, state)
                VALUES (@sessionId, @type, @entityId, @eventId, @message, @occurrenceId, @longMessage, @meta, @state)
                ON DUPLICATE KEY UPDATE event_id = VALUES(event_id), type = VALUES(type),
                    long_message = VALUES(long_message), meta = VALUES(meta), state = VALUES(state), updated_at = NOW(6)
                """, cancellationToken,
                ("@sessionId", sessionId), ("@type", type), ("@entityId", DbValue(message.EntityId)),
                ("@eventId", DbValue(inferredEventId)), ("@message", message.Message!), ("@occurrenceId", occurrenceId),
                ("@longMessage", message.LongMessage ?? message.Message!),
                ("@meta", JsonSerializer.Serialize(message)), ("@state", state));
        }
    }

    private static async Task ReconcileReservationsAsync(
        MySqlConnection connection,
        MySqlTransaction transaction,
        int sessionId,
        int hospitalId,
        string bedType,
        int available,
        CancellationToken cancellationToken)
    {
        var arrived = new List<(long Id, int Baseline)>();
        await using (var select = new MySqlCommand("""
            SELECT id, baseline_available FROM hospital_reservations
            WHERE session_id = @sessionId AND hospital_id = @hospitalId
              AND bed_type = @bedType AND status = 'arrived'
            ORDER BY arrived_at, id
            """, connection, transaction))
        {
            select.Parameters.AddWithValue("@sessionId", sessionId);
            select.Parameters.AddWithValue("@hospitalId", hospitalId);
            select.Parameters.AddWithValue("@bedType", bedType);
            await using var reader = await select.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) arrived.Add((reader.GetInt64(0), reader.GetInt32(1)));
        }
        if (arrived.Count == 0) return;

        var baseline = arrived.Max(row => row.Baseline);
        var confirmed = Math.Min(arrived.Count, Math.Max(0, baseline - available));
        if (confirmed > 0)
        {
            var ids = arrived.Take(confirmed).Select(row => row.Id).ToArray();
            await using var delete = new MySqlCommand(
                $"DELETE FROM hospital_reservations WHERE session_id = @sessionId AND id IN ({Placeholders("reservation", ids.Length)})",
                connection, transaction);
            delete.Parameters.AddWithValue("@sessionId", sessionId);
            for (var i = 0; i < ids.Length; i++) delete.Parameters.AddWithValue($"@reservation{i}", ids[i]);
            await delete.ExecuteNonQueryAsync(cancellationToken);
        }

        await ExecuteAsync(connection, transaction, $"""
            UPDATE hospital_reservations SET baseline_available = @available, updated_at = NOW(6)
            WHERE session_id = @sessionId AND hospital_id = @hospitalId AND bed_type = @bedType
              {(confirmed > 0 ? string.Empty : "AND status = 'arrived'")}
            """, cancellationToken,
            ("@available", available), ("@sessionId", sessionId), ("@hospitalId", hospitalId), ("@bedType", bedType));
    }

    private static bool IsSpeechRequest(MessageSnapshot message)
    {
        var shortText = message.Message ?? string.Empty;
        var longText = message.LongMessage ?? string.Empty;
        var signal = string.Concat(shortText.Where(character => !char.IsWhiteSpace(character))).ToLowerInvariant();
        return shortText.Contains("sprechwunsch", StringComparison.OrdinalIgnoreCase)
            || longText.Contains("sprechwunsch", StringComparison.OrdinalIgnoreCase)
            || signal is "5" or "s5" or "status5" or "fms5";
    }

    private static async Task<int> ExecuteAsync(
        MySqlConnection connection,
        MySqlTransaction transaction,
        string sql,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await using var command = new MySqlCommand(sql, connection, transaction);
        foreach (var parameter in parameters) command.Parameters.AddWithValue(parameter.Name, parameter.Value ?? DBNull.Value);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static object DbValue(object? value) => value ?? DBNull.Value;
    private static string Placeholders(string prefix, int count) =>
        string.Join(',', Enumerable.Range(0, count).Select(index => $"@{prefix}{index}"));
}
