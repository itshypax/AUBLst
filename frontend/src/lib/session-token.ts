export function normalizeSessionToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}
