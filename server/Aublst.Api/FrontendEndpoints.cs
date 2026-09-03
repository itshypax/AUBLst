using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace Aublst.Api;

public static class FrontendEndpoints
{
    public static RouteGroupBuilder MapFrontendEndpoints(this RouteGroupBuilder v2)
    {
        v2.MapGet("/sessions/resolve/{code}", async (string code, SessionRepository sessions, CancellationToken ct) =>
        {
            var session = await sessions.ResolveByCodeAsync(code, ct);
            return session is null ? Error(404, "Sitzung nicht gefunden.") : Results.Ok(new
            {
                session_id = session.PublicId,
                session_token = session.Code,
                bridge = FrontendRepository.BridgeData(session)
            });
        }).AllowAnonymous();

        v2.MapGet("/sessions/{sessionId:guid}", async (Guid sessionId, HttpRequest request, SessionRepository sessions, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct);
            return session is null ? Error(401, "Sitzungscode oder PIN ist falsch.") : Results.Ok(new { ok = true, session_token = session.Code, bridge = FrontendRepository.BridgeData(session) });
        });

        v2.MapGet("/sessions/{sessionId:guid}/state", async (Guid sessionId, string? profile, long? knownRevision, HttpRequest request, SessionRepository sessions, FrontendRepository frontend, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, false, ct);
            return session is null ? Error(401, "Sitzung nicht gefunden.") : Results.Ok(await frontend.StateAsync(session, profile == "monitor", knownRevision, ct));
        });
        v2.MapGet("/sessions/{sessionId:guid}/logs", async (Guid sessionId, string? since, long? sinceId, HttpRequest request, SessionRepository sessions, FrontendRepository frontend, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, false, ct);
            return session is null ? Error(401, "Sitzung nicht gefunden.") : Results.Ok(await frontend.LogsAsync(session, since, sinceId ?? 0, ct));
        });
        v2.MapGet("/sessions/{sessionId:guid}/status-history", async (Guid sessionId, HttpRequest request, SessionRepository sessions, FrontendRepository frontend, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, false, ct);
            return session is null ? Error(401, "Sitzung nicht gefunden.") : Results.Ok(await frontend.StatusHistoryAsync(session, ct));
        });
        v2.MapGet("/sessions/{sessionId:guid}/statistics", async (Guid sessionId, HttpRequest request, SessionRepository sessions, FrontendRepository frontend, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, false, ct);
            return session is null ? Error(401, "Sitzung nicht gefunden.") : Results.Ok(await frontend.StatisticsAsync(session, ct));
        });
        v2.MapGet("/sessions/{sessionId:guid}/events", async (Guid sessionId, string? view, HttpRequest request, SessionRepository sessions, FrontendRepository frontend, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, false, ct);
            return session is null ? Error(401, "Sitzung nicht gefunden.") : Results.Ok(await frontend.EventArchiveAsync(session, ct));
        });
        v2.MapGet("/sessions/{sessionId:guid}/events/{eventId:int}/record", async (Guid sessionId, int eventId, HttpRequest request, SessionRepository sessions, FrontendRepository frontend, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, false, ct); if (session is null) return Error(401, "Sitzung nicht gefunden.");
            var record = await frontend.EventRecordAsync(session, eventId, ct); return record is null ? Error(404, "Einsatz nicht gefunden.") : Results.Ok(record);
        });
        v2.MapGet("/sessions/{sessionId:guid}/events/{eventId:int}/vehicles", EventRead((f, s, id, ct) => f.EventVehiclesAsync(s, id, ct)));
        v2.MapGet("/sessions/{sessionId:guid}/events/{eventId:int}/logs", EventRead((f, s, id, ct) => f.EventLogsAsync(s, id, ct)));
        v2.MapGet("/sessions/{sessionId:guid}/events/{eventId:int}/feedback", EventRead((f, s, id, ct) => f.EventFeedbackAsync(s, id, ct)));

        v2.MapPost("/sessions/{sessionId:guid}/events", async (Guid sessionId, JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); return session is null ? Error(401, "Sitzungscode oder PIN ist falsch.") : Results.Ok(new { ok = true, @event = await dispatcher.CreateEventAsync(session, body, ct) });
        });
        v2.MapPost("/sessions/{sessionId:guid}/events/{eventId:int}/finish", async (Guid sessionId, int eventId, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch.");
            return await dispatcher.FinishEventAsync(session, eventId, ct) ? Results.Ok(new { ok = true }) : Error(409, "Der Einsatz kann hier nicht abgeschlossen werden.");
        });
        v2.MapPost("/sessions/{sessionId:guid}/events/{eventId:int}/assignments", async (Guid sessionId, int eventId, JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch.");
            using var patched = AddProperty(body, "event_id", eventId); var error = await dispatcher.AssignAsync(session, patched.RootElement, ct); return error is null ? Results.Ok(new { ok = true }) : Error(409, error);
        });
        v2.MapDelete("/sessions/{sessionId:guid}/assignments", async (Guid sessionId, [FromBody] JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); return session is null ? Error(401, "Sitzungscode oder PIN ist falsch.") : await dispatcher.UnassignAsync(session, body, ct) ? Results.Ok(new { ok = true }) : Error(400, "Keine Fahrzeuge ausgewählt.");
        });
        v2.MapPatch("/sessions/{sessionId:guid}/assignments/{vehicleId:int}", async (Guid sessionId, int vehicleId, JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch.");
            return await dispatcher.ReassignAsync(session, vehicleId, Int(body, "event_id"), ct) ? Results.Ok(new { ok = true }) : Error(409, "Das Fahrzeug kann nicht umdisponiert werden.");
        });
        v2.MapPut("/sessions/{sessionId:guid}/events/{eventId:int}/leaders/{role}", async (Guid sessionId, int eventId, string role, JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch.");
            return await dispatcher.SetLeaderAsync(session, eventId, NullableInt(body, "vehicle_id"), role, ct) ? Results.Ok(new { ok = true }) : Error(409, "Einsatzleiter konnte nicht gesetzt werden.");
        });
        v2.MapPost("/sessions/{sessionId:guid}/events/{eventId:int}/feedback", async (Guid sessionId, int eventId, JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch.");
            var feedback = await dispatcher.AddFeedbackAsync(session, eventId, String(body, "content"), ct); return feedback is null ? Error(400, "Rückmeldung fehlt oder Einsatz wurde nicht gefunden.") : Results.Ok(new { ok = true, feedback });
        });
        v2.MapPut("/sessions/{sessionId:guid}/events/{eventId:int}/note", async (Guid sessionId, int eventId, JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch."); var note = await dispatcher.SetNoteAsync(session, eventId, String(body, "content"), ct); return Results.Ok(new { ok = true, note });
        });
        v2.MapPost("/sessions/{sessionId:guid}/vehicles/{vehicleId:int}/alarm", async (Guid sessionId, int vehicleId, JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch."); await dispatcher.AlarmVehicleAsync(session, vehicleId, OptionalString(body, "mode"), ct); return Results.Ok(new { ok = true });
        });
        v2.MapPut("/sessions/{sessionId:guid}/vehicles/{vehicleId:int}/player", async (Guid sessionId, int vehicleId, JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch."); await dispatcher.SetVehiclePlayerAsync(session, vehicleId, Int(body, "player_id"), ct); return Results.Ok(new { ok = true });
        });
        v2.MapPut("/sessions/{sessionId:guid}/settings/monitor-hospital-capacity", async (Guid sessionId, JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch."); var enabled = Bool(body, "enabled"); await dispatcher.SetMonitorCapacityAsync(session, enabled, ct); return Results.Ok(new { ok = true, enabled });
        });
        v2.MapPut("/sessions/{sessionId:guid}/hospital-reservations/{vehicleId:int}", async (Guid sessionId, int vehicleId, JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch."); return await dispatcher.SetHospitalAsync(session, vehicleId, Int(body, "hospital_id"), String(body, "bed_type"), ct) ? Results.Ok(new { ok = true }) : Error(409, "Klinikvormerkung konnte nicht gesetzt werden.");
        });
        v2.MapDelete("/sessions/{sessionId:guid}/hospital-reservations/{vehicleId:int}", async (Guid sessionId, int vehicleId, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch."); await dispatcher.ClearHospitalAsync(session, vehicleId, ct); return Results.Ok(new { ok = true });
        });
        v2.MapPost("/sessions/{sessionId:guid}/logs/{logId:int}/view", LogWrite(false));
        v2.MapPost("/sessions/{sessionId:guid}/logs/{logId:int}/acknowledge", LogWrite(true));
        v2.MapPost("/sessions/{sessionId:guid}/metrics", async (Guid sessionId, JsonElement body, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, false, ct); if (session is null) return Error(401, "Sitzung nicht gefunden."); await dispatcher.RecordMetricsAsync(body, ct); return Results.NoContent();
        });

        v2.MapGet("/sessions/{sessionId:guid}/routing", async (Guid sessionId, HttpRequest request, SessionRepository sessions, FrontendRepository frontend, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, false, ct); return session is null ? Error(401, "Sitzung nicht gefunden.") : Results.Ok(await frontend.RoutingAsync(session, ct));
        });
        v2.MapPut("/sessions/{sessionId:guid}/routing", async (Guid sessionId, JsonElement body, HttpRequest request, SessionRepository sessions, FrontendRepository frontend, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch."); if (session.ModId is null) return Error(400, "Die Sitzung hat keine Karte."); return Results.Ok(await frontend.SaveRoutingAsync(session, body, ct));
        });
        v2.MapGet("/mods/{modId}/map", (string modId, FrontendRepository frontend) =>
        {
            var asset = frontend.MapAsset(modId); return asset is null ? Error(404, "Kartenbild nicht gefunden.") : Results.File(asset.Value.Path, asset.Value.ContentType, enableRangeProcessing: true, lastModified: File.GetLastWriteTimeUtc(asset.Value.Path));
        });

        v2.MapGet("/sessions/{sessionId:guid}/stream", async (Guid sessionId, long? lastRevision, HttpContext context, SessionRepository sessions, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, context.Request, sessions, false, ct); if (session is null) { context.Response.StatusCode = 401; return; }
            context.Response.Headers.CacheControl = "no-cache"; context.Response.Headers.Connection = "keep-alive"; context.Response.ContentType = "text/event-stream";
            var revision = lastRevision ?? -1;
            for (var i = 0; i < 50 && !ct.IsCancellationRequested; i++)
            {
                var current = await sessions.ResolveByCodeAsync(session.Code, ct); if (current is null) break;
                if (current.Revision != revision) { revision = current.Revision; await context.Response.WriteAsync($"event: change\ndata: {{\"revision\":{revision}}}\n\n", ct); await context.Response.Body.FlushAsync(ct); }
                await Task.Delay(500, ct);
            }
        });
        return v2;

        static Delegate EventRead(Func<FrontendRepository, FrontendSession, int, CancellationToken, Task<object>> read) =>
            async (Guid sessionId, int eventId, HttpRequest request, SessionRepository sessions, FrontendRepository frontend, CancellationToken ct) =>
            {
                var session = await Auth(sessionId, request, sessions, false, ct); return session is null ? Error(401, "Sitzung nicht gefunden.") : Results.Ok(await read(frontend, session, eventId, ct));
            };
        static Delegate LogWrite(bool acknowledge) => async (Guid sessionId, int logId, HttpRequest request, SessionRepository sessions, DispatcherRepository dispatcher, CancellationToken ct) =>
        {
            var session = await Auth(sessionId, request, sessions, true, ct); if (session is null) return Error(401, "Sitzungscode oder PIN ist falsch.");
            var result = await dispatcher.UpdateLogAsync(session, logId, acknowledge, ct); return result is null ? Error(404, "Funkmeldung nicht gefunden.") : Results.Ok(new { ok = true, ids = result.Value.Ids, updated_at = result.Value.UpdatedAt });
        };
    }

    private static Task<FrontendSession?> Auth(Guid id, HttpRequest request, SessionRepository sessions, bool write, CancellationToken ct) =>
        sessions.AuthenticateFrontendAsync(id, request.Headers["X-Session-Code"], request.Headers["X-Session-Pin"], write, ct);
    private static IResult Error(int status, string message) => Results.Json(new { error = message }, statusCode: status);
    private static JsonDocument AddProperty(JsonElement body, string name, int value) { var values = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(body.GetRawText()) ?? []; values[name] = JsonSerializer.SerializeToElement(value); return JsonDocument.Parse(JsonSerializer.Serialize(values)); }
    private static int Int(JsonElement body, string name) => body.TryGetProperty(name, out var value) && value.TryGetInt32(out var result) ? result : 0;
    private static int? NullableInt(JsonElement body, string name) => body.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null && value.TryGetInt32(out var result) ? result : null;
    private static bool Bool(JsonElement body, string name) => body.TryGetProperty(name, out var value) && value.ValueKind is JsonValueKind.True;
    private static string String(JsonElement body, string name) => OptionalString(body, name) ?? "";
    private static string? OptionalString(JsonElement body, string name) => body.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
