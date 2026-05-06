export interface CarConfig {
  shiftSpeed: { [gear: number]: number };
  gearRatio: { [gear: number]: number };
  idleRPM: number;
}

export const carConfig: CarConfig = {
  shiftSpeed: {
    1: 81, // km/h
    2: 118, // km/h
    3: 157, // km/h
    4: 202, // km/h
    5: 249, // km/h
    6: 301, // km/h
  },
  gearRatio: {
    1: 2.89,
    2: 1.99,
    3: 1.49,
    4: 1.16,
    5: 0.94,
    6: 0.78,
  },
  idleRPM: 800,
};
