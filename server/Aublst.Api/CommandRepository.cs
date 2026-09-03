using System.Text.Json;
using MySqlConnector;

namespace Aublst.Api;

public sealed class CommandRepository(Db db)
{
    public async Task<CommandBatch> ClaimAsync(
        BridgeSession session,
        ClaimCommandsRequest request,
        CancellationToken cancellationToken)
    {
        var limit = Math.Clamp(request.Limit, 1, 100);
        var leaseSeconds = Math.Clamp(request.LeaseSeconds, 10, 120);
        var leaseToken = BridgeSecurity.CreateLeaseToken();

        await using var connection = await db.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var select = new MySqlCommand("""
            SELECT id
            FROM commands
            WHERE session_id = @sessionId AND processed = 0
              AND (lease_expires_at IS NULL OR lease_expires_at < NOW(6))
            ORDER BY id
            LIMIT @limit
            FOR UPDATE SKIP LOCKED
            """, connection, transaction);
        select.Parameters.AddWithValue("@sessionId", session.DatabaseId);
        select.Parameters.AddWithValue("@limit", limit);

        var ids = new List<long>(limit);
        await using (var reader = await select.ExecuteReaderAsync(cancellationToken))
            while (await reader.ReadAsync(cancellationToken)) ids.Add(reader.GetInt64(0));

        if (ids.Count == 0)
        {
            await transaction.CommitAsync(cancellationToken);
            return new CommandBatch([], DateTimeOffset.UtcNow);
        }

        await using var lease = new MySqlCommand($"""
            UPDATE commands
            SET lease_owner = @owner, lease_token = @leaseToken,
                lease_expires_at = DATE_ADD(NOW(6), INTERVAL {leaseSeconds} SECOND),
                delivery_attempts = delivery_attempts + 1
            WHERE session_id = @sessionId AND id IN ({Placeholders(ids.Count)})
            """, connection, transaction);
        lease.Parameters.AddWithValue("@owner", session.BridgeId);
        lease.Parameters.AddWithValue("@leaseToken", leaseToken);
        lease.Parameters.AddWithValue("@sessionId", session.DatabaseId);
        AddIds(lease, ids);
        await lease.ExecuteNonQueryAsync(cancellationToken);

        await using var fetch = new MySqlCommand($"""
            SELECT id, type, payload, created_at
            FROM commands
            WHERE session_id = @sessionId AND lease_token = @leaseToken
              AND id IN ({Placeholders(ids.Count)})
            ORDER BY id
            """, connection, transaction);
        fetch.Parameters.AddWithValue("@sessionId", session.DatabaseId);
        fetch.Parameters.AddWithValue("@leaseToken", leaseToken);
        AddIds(fetch, ids);

        var commands = new List<CommandEnvelope>(ids.Count);
        await using (var reader = await fetch.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                using var payload = JsonDocument.Parse(reader.GetString("payload"));
                commands.Add(new CommandEnvelope(
                    reader.GetInt64("id"),
                    reader.GetString("type"),
                    payload.RootElement.Clone(),
                    new DateTimeOffset(DateTime.SpecifyKind(reader.GetDateTime("created_at"), DateTimeKind.Utc)),
                    leaseToken));
            }
        }

        await transaction.CommitAsync(cancellationToken);
        return new CommandBatch(commands, DateTimeOffset.UtcNow);
    }

    public Task<int> AcknowledgeAsync(BridgeSession session, CompleteCommandsRequest request, CancellationToken cancellationToken) =>
        CompleteAsync(session, request.LeaseToken, request.CommandIds, true, cancellationToken);

    public Task<int> ReleaseAsync(BridgeSession session, ReleaseCommandsRequest request, CancellationToken cancellationToken) =>
        CompleteAsync(session, request.LeaseToken, request.CommandIds, false, cancellationToken);

    private async Task<int> CompleteAsync(
        BridgeSession session,
        string leaseToken,
        IReadOnlyList<long> ids,
        bool processed,
        CancellationToken cancellationToken)
    {
        var normalized = ids.Where(id => id > 0).Distinct().Take(100).ToArray();
        if (normalized.Length == 0) return 0;

        await using var connection = await db.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = processed
            ? $"""
                UPDATE commands SET processed = 1, processed_at = NOW(6),
                    lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
                WHERE session_id = @sessionId AND lease_owner = @owner
                  AND lease_token = @leaseToken AND id IN ({Placeholders(normalized.Length)})
                """
            : $"""
                UPDATE commands SET lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
                WHERE session_id = @sessionId AND lease_owner = @owner
                  AND lease_token = @leaseToken AND processed = 0
                  AND id IN ({Placeholders(normalized.Length)})
                """;
        command.Parameters.AddWithValue("@sessionId", session.DatabaseId);
        command.Parameters.AddWithValue("@owner", session.BridgeId);
        command.Parameters.AddWithValue("@leaseToken", leaseToken);
        AddIds(command, normalized);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string Placeholders(int count) => string.Join(',', Enumerable.Range(0, count).Select(i => $"@id{i}"));
    private static void AddIds(MySqlCommand command, IReadOnlyList<long> ids)
    {
        for (var i = 0; i < ids.Count; i++) command.Parameters.AddWithValue($"@id{i}", ids[i]);
    }
}
