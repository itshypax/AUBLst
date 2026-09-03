using System.Security.Cryptography;
using System.Text;

namespace Aublst.Api;

public static class BridgeSecurity
{
    public static string CreateAccessToken() => Base64Url(RandomNumberGenerator.GetBytes(32));
    public static string CreateLeaseToken() => Base64Url(RandomNumberGenerator.GetBytes(24));

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    public static bool FixedTimeEquals(string expectedHex, string token)
    {
        try
        {
            return CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(expectedHex),
                SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static string Base64Url(byte[] value) => Convert.ToBase64String(value)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');
}
