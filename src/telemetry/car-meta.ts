// Identifies a specific build of a car, not just the model. Two owned copies
// of the same `car.ordinal` with a different engine (numCylinders), a
// cam/internals upgrade that shifted the redline (maxRpm), or a drivetrain
// conversion get distinct build keys.
//
// Why not just `car.ordinal`: Forza reuses the same ordinal for every
// instance of a given car model, so two owned copies of "the same car" with
// different builds would otherwise be indistinguishable. The composite key
// (ordinal + numCylinders + maxRpm + drivetrain) catches the most
// structurally-different-engine cases. It deliberately does NOT include
// performanceIndex/carClass - those shift with tire/aero/weight changes that
// don't affect the engine/drivetrain at all, and would cause spurious
// "different build" splits. It also can't catch every build difference (a
// turbo swap or a manual gear ratio retune with the same engine/redline/
// drivetrain is invisible to this key) - a manually-selected GearboxTune's
// own `id` is used instead of this key when one is active, which is exact
// rather than inferred (see gearbox-tune-store.ts).

export interface CarMeta {
  carOrdinal: number;
  carClass: number;
  performanceIndex: number;
  drivetrain: number;
  numCylinders: number;
  idleRpm: number;
  maxRpm: number;
}

/**
 * `maxRpm` is rounded before joining so float noise can't split one build
 * into two keys.
 */
export function computeBuildKey(meta: CarMeta): string {
  return `${meta.carOrdinal}:${meta.numCylinders}:${Math.round(meta.maxRpm)}:${meta.drivetrain}`;
}
