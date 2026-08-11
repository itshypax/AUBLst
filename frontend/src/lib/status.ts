export function statusCode(value: number | string): number | null {
  if (String(value).trim().toUpperCase() === 'C') return 0;
  const code = Number(value);
  return Number.isFinite(code) ? code : null;
}

export function statusDisplay(value: number | string): string {
  return statusCode(value) === 0 ? 'C' : String(value);
}
