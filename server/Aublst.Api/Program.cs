using System.Text.Json;
using System.Threading.RateLimiting;
using Aublst.Api;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(options => options.SingleLine = true);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.CamelCase;
});
builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v2", new() { Title = "AUBLst API", Version = "v2" });
    options.AddSecurityDefinition("Bearer", new()
    {
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "opaque"
    });
});
builder.Services.AddSingleton<Db>();
builder.Services.AddScoped<SessionRepository>();
builder.Services.AddScoped<SnapshotRepository>();
builder.Services.AddScoped<CommandRepository>();
builder.Services.AddScoped<FrontendRepository>();
builder.Services.AddScoped<DispatcherRepository>();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("bridge", context => RateLimitPartition.GetTokenBucketLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "local",
        _ => new TokenBucketRateLimiterOptions
        {
            // Mehrere Alarmmonitore teilen sich häufig eine öffentliche IP.
            // Das Limit soll Missbrauch abfangen, nicht einen Gerätepark drosseln.
            TokenLimit = 1200,
            TokensPerPeriod = 1200,
            ReplenishmentPeriod = TimeSpan.FromMinutes(1),
            QueueLimit = 8,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            AutoReplenishment = true
        }));
});

var app = builder.Build();
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
});
app.UseExceptionHandler(error => error.Run(async context =>
{
    var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    app.Logger.LogError(exception, "Unhandled API v2 error for {Path}", context.Request.Path);
    await Results.Problem(
        statusCode: StatusCodes.Status500InternalServerError,
        title: "Interner Serverfehler",
        type: "https://aublst.de/problems/internal").ExecuteAsync(context);
}));
app.UseRateLimiter();
app.UseSwagger(options => options.RouteTemplate = "api/{documentName}/openapi.json");

var v2 = app.MapGroup("/api/v2").RequireRateLimiting("bridge");
v2.MapFrontendEndpoints();

v2.MapGet("/capabilities", () => Results.Ok(new
{
    apiVersion = 2,
    kind = "aublst-api",
    bridgeProtocolVersion = 2,
    authentication = new { bridge = "bearer", frontend = "session-code-and-optional-pin" },
    features = new[]
    {
        "typed-snapshots-v2",
        "idempotent-snapshots-v1",
        "command-leases-v1",
        "bridge-heartbeat-v1",
        "frontend-session-resolution-v1",
        "dispatcher-state-and-actions-v1",
        "server-sent-events-v1",
        "problem-details-v1"
    }
}));

v2.MapPost("/sessions", async (
    CreateSessionRequest request,
    SessionRepository sessions,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Bridge?.BridgeId))
        return ProblemResults.Validation("bridge.bridgeId fehlt.");
    if (request.Bridge.ProtocolVersion != 2)
        return ProblemResults.Validation("Diese API erwartet Bridge-Protokoll 2.");
    if (request.Pin is { Length: > 10 })
        return ProblemResults.Validation("Die PIN darf höchstens zehn Zeichen lang sein.");

    var created = await sessions.CreateAsync(request, cancellationToken);
    var response = new CreateSessionResponse(
        new SessionInfo(created.Session.PublicId, created.Session.Code, created.Session.ModId, created.Session.Bounds),
        new BridgeCredentials(created.AccessToken),
        new ProtocolInfo(2));
    return Results.Created($"/api/v2/sessions/{created.Session.PublicId:D}/bridge", response);
});

v2.MapGet("/sessions/{sessionId:guid}/bridge", async (
    Guid sessionId,
    HttpRequest request,
    SessionRepository sessions,
    CancellationToken cancellationToken) =>
{
    var session = await sessions.AuthenticateAsync(sessionId, request.Headers.Authorization, cancellationToken);
    return session is null
        ? ProblemResults.Unauthorized()
        : Results.Ok(new
        {
            session = new SessionInfo(session.PublicId, session.Code, session.ModId, session.Bounds),
            bridgeId = session.BridgeId,
            lastSequence = session.LastSequence,
            revision = session.Revision
        });
});

v2.MapPut("/sessions/{sessionId:guid}/bridge/snapshot", async (
    Guid sessionId,
    SnapshotRequest snapshot,
    HttpRequest request,
    SessionRepository sessions,
    SnapshotRepository snapshots,
    CancellationToken cancellationToken) =>
{
    var session = await sessions.AuthenticateAsync(sessionId, request.Headers.Authorization, cancellationToken);
    if (session is null) return ProblemResults.Unauthorized();
    if (snapshot.Sequence == 0) return ProblemResults.Validation("sequence muss größer als 0 sein.");
    if (snapshot.CapturedAt == default) return ProblemResults.Validation("capturedAt fehlt.");
    if (snapshot.Vehicles?.Any(vehicle => vehicle.Status is < 0 or > 9) == true)
        return ProblemResults.Validation("Fahrzeugstatus muss zwischen 0 und 9 liegen.");

    return Results.Ok(await snapshots.ApplyAsync(session, snapshot, cancellationToken));
});

v2.MapPut("/sessions/{sessionId:guid}/bridge/heartbeat", async (
    Guid sessionId,
    HeartbeatRequest heartbeat,
    HttpRequest request,
    SessionRepository sessions,
    SnapshotRepository snapshots,
    CancellationToken cancellationToken) =>
{
    var session = await sessions.AuthenticateAsync(sessionId, request.Headers.Authorization, cancellationToken);
    if (session is null) return ProblemResults.Unauthorized();
    if (string.IsNullOrWhiteSpace(heartbeat.Status)) return ProblemResults.Validation("status fehlt.");
    await snapshots.UpdateHeartbeatAsync(session, heartbeat, cancellationToken);
    return Results.NoContent();
});

v2.MapPost("/sessions/{sessionId:guid}/commands/claim", async (
    Guid sessionId,
    ClaimCommandsRequest claim,
    HttpRequest request,
    SessionRepository sessions,
    CommandRepository commands,
    CancellationToken cancellationToken) =>
{
    var session = await sessions.AuthenticateAsync(sessionId, request.Headers.Authorization, cancellationToken);
    return session is null
        ? ProblemResults.Unauthorized()
        : Results.Ok(await commands.ClaimAsync(session, claim, cancellationToken));
});

v2.MapPost("/sessions/{sessionId:guid}/commands/ack", async (
    Guid sessionId,
    CompleteCommandsRequest completion,
    HttpRequest request,
    SessionRepository sessions,
    CommandRepository commands,
    CancellationToken cancellationToken) =>
{
    var session = await sessions.AuthenticateAsync(sessionId, request.Headers.Authorization, cancellationToken);
    if (session is null) return ProblemResults.Unauthorized();
    if (string.IsNullOrWhiteSpace(completion.LeaseToken)) return ProblemResults.Validation("leaseToken fehlt.");
    return Results.Ok(new UpdatedResponse(await commands.AcknowledgeAsync(session, completion, cancellationToken)));
});

v2.MapPost("/sessions/{sessionId:guid}/commands/release", async (
    Guid sessionId,
    ReleaseCommandsRequest release,
    HttpRequest request,
    SessionRepository sessions,
    CommandRepository commands,
    CancellationToken cancellationToken) =>
{
    var session = await sessions.AuthenticateAsync(sessionId, request.Headers.Authorization, cancellationToken);
    if (session is null) return ProblemResults.Unauthorized();
    if (string.IsNullOrWhiteSpace(release.LeaseToken)) return ProblemResults.Validation("leaseToken fehlt.");
    return Results.Ok(new UpdatedResponse(await commands.ReleaseAsync(session, release, cancellationToken)));
});

v2.MapGet("/health/live", () => Results.Ok(new { status = "ok" }));
v2.MapGet("/health/ready", async (Db db, CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = await db.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1";
        await command.ExecuteScalarAsync(cancellationToken);
        return Results.Ok(new { status = "ready" });
    }
    catch
    {
        return Results.Problem(statusCode: 503, title: "Datenbank nicht bereit");
    }
});

app.Run();

public partial class Program;
