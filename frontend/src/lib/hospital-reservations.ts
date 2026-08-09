import type { HospitalReservation, Vehicle } from './types';

export function reservationAffectsCapacity(reservation: HospitalReservation, vehicles: Vehicle[]): boolean {
  if (reservation.status === 'reserved') return true;
  if (reservation.status !== 'arrived') return false;
  return Number(vehicles.find((vehicle) => vehicle.id === reservation.vehicle_id)?.status) === 8;
}
