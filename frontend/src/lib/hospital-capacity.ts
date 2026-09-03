export type HospitalCapacityLevel = 'ok' | 'low' | 'full';

export function hospitalCapacityLevel(available: number): HospitalCapacityLevel {
  const value = Number(available);
  if (value <= 0) return 'full';
  if (value <= 2) return 'low';
  return 'ok';
}

export function hospitalCapacityLabel(level: HospitalCapacityLevel): string {
  if (level === 'full') return 'belegt';
  if (level === 'low') return 'knapp';
  return 'verfügbar';
}

const HOSPITAL_ORDER = ['uni', 'hanse', 'berg', 'lichtenau'];

export function compareHospitalNames(left: string | null, right: string | null): number {
  const leftName = (left ?? '').toLocaleLowerCase('de-DE');
  const rightName = (right ?? '').toLocaleLowerCase('de-DE');
  const rank = (name: string) => {
    const index = HOSPITAL_ORDER.findIndex((part) => name.includes(part));
    return index === -1 ? HOSPITAL_ORDER.length : index;
  };
  return rank(leftName) - rank(rightName) || leftName.localeCompare(rightName, 'de-DE');
}
