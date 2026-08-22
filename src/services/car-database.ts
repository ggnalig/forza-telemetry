import carDatabaseJson from "../data/car-database.json";

export interface CarInfo {
  carId: number;
  year: number;
  make: string;
  model: string;
  displayName: string;
}

const carDatabase = carDatabaseJson as Record<string, CarInfo>;

/**
 * Looks up a car by its telemetry `car.ordinal`. The lookup table is merged
 * from both Forza Motorsport and Forza Horizon 6 car-ordinal dumps (see
 * scripts/build-car-database.ts) since this backend's UDP wire format and
 * car-ordinal ID space are shared across both games - returns null for any
 * ordinal not present in either source (a newer DLC car, or one added after
 * the dump was generated) rather than guessing.
 */
export function lookupCarInfo(carId: number): CarInfo | null {
  return carDatabase[String(carId)] ?? null;
}
