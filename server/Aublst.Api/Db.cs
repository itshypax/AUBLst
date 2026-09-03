using MySqlConnector;

namespace Aublst.Api;

public sealed class Db(IConfiguration configuration)
{
    private readonly string _connectionString = configuration.GetConnectionString("Database")
        ?? throw new InvalidOperationException("ConnectionStrings:Database fehlt.");

    public async Task<MySqlConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new MySqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }
}

public sealed record BridgeSession(
    int DatabaseId,
    Guid PublicId,
    string Code,
    string? ModId,
    string TokenHash,
    string BridgeId,
    ulong LastSequence,
    long Revision,
    MapBounds Bounds);

public sealed record FrontendSession(
    int DatabaseId,
    Guid? PublicId,
    string Code,
    string? Pin,
    string? ModId,
    long Revision,
    string BridgeKind,
    int BridgeProtocolVersion,
    string? BridgeAppVersion,
    string? BridgeCapabilities,
    DateTime? BridgeSeenAt,
    bool MonitorShowHospitalCapacity,
    MapBounds Bounds);
