using System.Text.Json;
using System.Text.Json.Serialization;

namespace Aublst.Api;

public sealed record MapBounds(
    [property: JsonPropertyName("minX")] double MinX = 0,
    [property: JsonPropertyName("minY")] double MinY = 0,
    [property: JsonPropertyName("maxX")] double MaxX = 1000,
    [property: JsonPropertyName("maxY")] double MaxY = 1000);

public sealed record BridgeDescriptor(
    string BridgeId,
    string? AppVersion,
    int ProtocolVersion = 2,
    IReadOnlyList<string>? Capabilities = null);

public sealed record CreateSessionRequest(
    string? ModId,
    string? Pin,
    MapBounds? MapBounds,
    BridgeDescriptor Bridge);

public sealed record SessionInfo(Guid Id, string Code, string? ModId, MapBounds MapBounds);
public sealed record BridgeCredentials(string AccessToken);
public sealed record ProtocolInfo(int Version);
public sealed record CreateSessionResponse(SessionInfo Session, BridgeCredentials Bridge, ProtocolInfo Protocol);

public sealed record PlayerSnapshot(string PlayerId, string? Name);
public sealed record VehicleSnapshot(
    string GameVehicleId,
    string? Name,
    string? Type,
    string? Modes,
    double? X,
    double? Y,
    int? Status);
public sealed record HospitalSnapshot(
    string GameHospitalId,
    string? Name,
    double? X,
    double? Y,
    int? IcuAvailable,
    int? WardAvailable,
    int? IcuTotal,
    int? WardTotal);
public sealed record EventSnapshot(
    int? Id,
    string? GameEventId,
    string? Name,
    double? X,
    double? Y,
    string? Status);
public sealed class MessageSnapshot
{
    public string? Type { get; init; }
    public string? EntityId { get; init; }
    public int? EventId { get; init; }
    public string? Message { get; init; }
    public string? LongMessage { get; init; }
    public string? State { get; init; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Metadata { get; init; }
}
public sealed record GameClock(int H, int M);

public sealed record SnapshotRequest(
    ulong Sequence,
    DateTimeOffset CapturedAt,
    IReadOnlyList<PlayerSnapshot>? Players,
    IReadOnlyList<VehicleSnapshot>? Vehicles,
    IReadOnlyList<HospitalSnapshot>? Hospitals,
    IReadOnlyList<EventSnapshot>? Events,
    IReadOnlyList<MessageSnapshot>? Messages,
    GameClock? Time,
    MapBounds? MapBounds,
    string? ModId);
public sealed record SnapshotResponse(bool Accepted, ulong Sequence, long Revision);

public sealed record HeartbeatRequest(
    string? AppVersion,
    string Status,
    bool Em4Running,
    bool LogfileOk,
    bool InputFileOk,
    DateTimeOffset? LastGameDataAt,
    string? LastError,
    IReadOnlyList<string>? Capabilities);

public sealed record ClaimCommandsRequest(int Limit = 50, int LeaseSeconds = 30);
public sealed record CommandEnvelope(long Id, string Type, JsonElement Payload, DateTimeOffset CreatedAt, string LeaseToken);
public sealed record CommandBatch(IReadOnlyList<CommandEnvelope> Commands, DateTimeOffset ServerTime);
public sealed record CompleteCommandsRequest(string LeaseToken, IReadOnlyList<long> CommandIds);
public sealed record ReleaseCommandsRequest(string LeaseToken, IReadOnlyList<long> CommandIds, string? Error);
public sealed record UpdatedResponse(int Updated);
