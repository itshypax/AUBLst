export function statusDisplay(value: number | string): string {
  return Number(value) === 0 ? 'C' : String(value);
}
