namespace Aublst.Api;

public static class VehicleRules
{
    private static readonly HashSet<string> UntrackedAlarmUnits = new(StringComparer.OrdinalIgnoreCase)
    {
        "ASF", "BSW", "JA", "FUSTW", "TD"
    };

    public static bool IsUntracked(string? gameVehicleId, string? type) =>
        (!string.IsNullOrWhiteSpace(gameVehicleId) && UntrackedAlarmUnits.Contains(gameVehicleId.Trim()))
        || (!string.IsNullOrWhiteSpace(type) && UntrackedAlarmUnits.Contains(type.Trim()));
}
