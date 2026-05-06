export interface CarConfig {
  shiftSpeed: number[];
  gearRatio: number[];
  finalDrive: number;
  idleRPM: number;
}

export const carConfig: CarConfig = {
  shiftSpeed: [75, 109, 146, 287, 231, 278],
  gearRatio: [2.89, 1.99, 1.49, 1.16, 0.94, 0.78, 3.7],
  finalDrive: 3.7,
  idleRPM: 800,
};
