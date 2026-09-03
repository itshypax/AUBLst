using Microsoft.AspNetCore.Mvc;

namespace Aublst.Api;

public static class ProblemResults
{
    public static IResult Validation(string detail) => Results.Problem(
        statusCode: StatusCodes.Status400BadRequest,
        title: "Ungültige Anfrage",
        detail: detail,
        type: "https://aublst.de/problems/validation");

    public static IResult Unauthorized() => Results.Problem(
        statusCode: StatusCodes.Status401Unauthorized,
        title: "Bridge nicht autorisiert",
        detail: "Das Bearer-Token fehlt oder ist ungültig.",
        type: "https://aublst.de/problems/bridge-authentication");

    public static IResult NotFound() => Results.Problem(
        statusCode: StatusCodes.Status404NotFound,
        title: "Sitzung nicht gefunden",
        type: "https://aublst.de/problems/session-not-found");

    public static IResult Conflict(string detail) => Results.Problem(
        statusCode: StatusCodes.Status409Conflict,
        title: "Konflikt",
        detail: detail,
        type: "https://aublst.de/problems/conflict");
}
