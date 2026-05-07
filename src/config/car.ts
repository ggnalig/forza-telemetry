export interface CarConfig {
  shiftSpeed: number[];
  gearRatio: number[];
  finalDrive: number;
  idleRPM: number;
}

export const carConfig: CarConfig = {
  shiftSpeed: [120, 184, 230, 288, 392],
  gearRatio: [2.0, 1.3, 1.04, 0.83, 0.61, 4.62],
  finalDrive: 4.62,
  idleRPM: 800,
};
