using MySqlConnector;

namespace Aublst.Api;

public sealed class SessionRepository(Db db)
{
    public async Task<FrontendSession?> ResolveByCodeAsync(string code, CancellationToken cancellationToken)
    {
        var normalized = code.Trim().ToLowerInvariant();
        if (normalized.Length is < 4 or > 10) return null;

        await using var connection = await db.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, public_id, token, pin, mod_id, revision, bridge_kind,
                   bridge_protocol_version, bridge_app_version, bridge_capabilities,
                   bridge_seen_at, monitor_show_hospital_capacity,
                   min_x, min_y, max_x, max_y
            FROM sessions WHERE token = @code LIMIT 1
            """;
        command.Parameters.AddWithValue("@code", normalized);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadFrontendSession(reader) : null;
    }

    public async Task<FrontendSession?> AuthenticateFrontendAsync(
        Guid publicId,
        string? code,
        string? pin,
        bool requireWrite,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        await using var connection = await db.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, public_id, token, pin, mod_id, revision, bridge_kind,
                   bridge_protocol_version, bridge_app_version, bridge_capabilities,
                   bridge_seen_at, monitor_show_hospital_capacity,
                   min_x, min_y, max_x, max_y
            FROM sessions WHERE public_id = @publicId AND token = @code LIMIT 1
            """;
        command.Parameters.AddWithValue("@publicId", publicId.ToString("D"));
        command.Parameters.AddWithValue("@code", code.Trim().ToLowerInvariant());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        var session = ReadFrontendSession(reader);
        if (requireWrite && session.Pin is not null && !string.Equals(session.Pin, pin?.Trim(), StringComparison.Ordinal))
            return null;
        return session;
    }

    public async Task<(BridgeSession Session, string AccessToken)> CreateAsync(
        CreateSessionRequest request,
        CancellationToken cancellationToken)
    {
        var publicId = Guid.NewGuid();
        var accessToken = BridgeSecurity.CreateAccessToken();
        var tokenHash = BridgeSecurity.Hash(accessToken);
        var bounds = request.MapBounds ?? new MapBounds();

        await using var connection = await db.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        if (!string.IsNullOrWhiteSpace(request.ModId))
        {
            await using var mod = Command(connection, transaction, "INSERT IGNORE INTO mods (mod_id) VALUES (@modId)");
            mod.Parameters.AddWithValue("@modId", request.ModId.Trim());
            await mod.ExecuteNonQueryAsync(cancellationToken);
        }

        for (var attempt = 0; attempt < 12; attempt++)
        {
            var code = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(2)).ToLowerInvariant();
            try
            {
                await using var insert = Command(connection, transaction, """
                    INSERT INTO sessions
                        (token, pin, mod_id, min_x, min_y, max_x, max_y, public_id,
                         bridge_kind, bridge_token_hash, bridge_id, bridge_protocol_version, bridge_app_version,
                         bridge_capabilities, bridge_seen_at)
                    VALUES
                        (@code, @pin, @modId, @minX, @minY, @maxX, @maxY, @publicId,
                         'aublst-bridge', @tokenHash, @bridgeId, @protocol, @appVersion, @capabilities, NOW(6))
                    """);
                insert.Parameters.AddWithValue("@code", code);
                insert.Parameters.AddWithValue("@pin", DbValue(request.Pin));
                insert.Parameters.AddWithValue("@modId", DbValue(request.ModId));
                insert.Parameters.AddWithValue("@minX", bounds.MinX);
                insert.Parameters.AddWithValue("@minY", bounds.MinY);
                insert.Parameters.AddWithValue("@maxX", bounds.MaxX);
                insert.Parameters.AddWithValue("@maxY", bounds.MaxY);
                insert.Parameters.AddWithValue("@publicId", publicId.ToString("D"));
                insert.Parameters.AddWithValue("@tokenHash", tokenHash);
                insert.Parameters.AddWithValue("@bridgeId", request.Bridge.BridgeId.Trim());
                insert.Parameters.AddWithValue("@protocol", request.Bridge.ProtocolVersion);
                insert.Parameters.AddWithValue("@appVersion", DbValue(request.Bridge.AppVersion));
                insert.Parameters.AddWithValue("@capabilities", request.Bridge.Capabilities is { Count: > 0 }
                    ? System.Text.Json.JsonSerializer.Serialize(request.Bridge.Capabilities)
                    : DBNull.Value);
                await insert.ExecuteNonQueryAsync(cancellationToken);

                var session = new BridgeSession(
                    (int)insert.LastInsertedId,
                    publicId,
                    code,
                    request.ModId,
                    tokenHash,
                    request.Bridge.BridgeId.Trim(),
                    0,
                    0,
                    bounds);
                await transaction.CommitAsync(cancellationToken);
                return (session, accessToken);
            }
            catch (MySqlException exception) when (exception.Number == 1062 && attempt < 11)
            {
                // Der kurze Code kann kollidieren; Public-ID und Bridge-Token bleiben unverändert sicher.
            }
        }

        throw new InvalidOperationException("Es konnte kein freier Sitzungscode erzeugt werden.");
    }

    public async Task<BridgeSession?> AuthenticateAsync(
        Guid publicId,
        string? authorization,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(authorization)
            || !authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return null;

        var accessToken = authorization[7..].Trim();
        if (accessToken.Length < 32) return null;

        await using var connection = await db.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, public_id, token, mod_id, bridge_token_hash, bridge_id,
                   last_bridge_sequence, revision, min_x, min_y, max_x, max_y
            FROM sessions WHERE public_id = @publicId LIMIT 1
            """;
        command.Parameters.AddWithValue("@publicId", publicId.ToString("D"));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        var tokenHash = reader.GetString("bridge_token_hash");
        if (!BridgeSecurity.FixedTimeEquals(tokenHash, accessToken)) return null;

        return new BridgeSession(
            reader.GetInt32("id"),
            reader.GetGuid("public_id"),
            reader.GetString("token"),
            reader.IsDBNull(reader.GetOrdinal("mod_id")) ? null : reader.GetString("mod_id"),
            tokenHash,
            reader.GetString("bridge_id"),
            reader.GetUInt64("last_bridge_sequence"),
            reader.GetInt64("revision"),
            new MapBounds(reader.GetDouble("min_x"), reader.GetDouble("min_y"), reader.GetDouble("max_x"), reader.GetDouble("max_y")));
    }

    private static MySqlCommand Command(MySqlConnection connection, MySqlTransaction transaction, string sql) =>
        new(sql, connection, transaction);

    private static FrontendSession ReadFrontendSession(MySqlDataReader reader) => new(
        reader.GetInt32("id"),
        reader.IsDBNull(reader.GetOrdinal("public_id")) ? null : reader.GetGuid("public_id"),
        reader.GetString("token"),
        NullableString(reader, "pin"),
        NullableString(reader, "mod_id"),
        reader.GetInt64("revision"),
        reader.GetString("bridge_kind"),
        reader.GetInt32("bridge_protocol_version"),
        NullableString(reader, "bridge_app_version"),
        NullableString(reader, "bridge_capabilities"),
        reader.IsDBNull(reader.GetOrdinal("bridge_seen_at")) ? null : reader.GetDateTime("bridge_seen_at"),
        reader.GetBoolean("monitor_show_hospital_capacity"),
        new MapBounds(reader.GetDouble("min_x"), reader.GetDouble("min_y"), reader.GetDouble("max_x"), reader.GetDouble("max_y")));

    private static string? NullableString(MySqlDataReader reader, string name) =>
        reader.IsDBNull(reader.GetOrdinal(name)) ? null : reader.GetString(name);

    private static object DbValue(string? value) => string.IsNullOrWhiteSpace(value) ? DBNull.Value : value.Trim();
}
