export type MotionStage = "steady" | "descending" | "bottom" | "rising";
export type SquatMotionState = "standing" | "down" | "bottom" | "rising";

export interface MotionVector {
  x: number;
  y: number;
  z: number;
}

export interface VerticalTravelTracker {
  gravityBaseline: MotionVector | null;
  velocity: number;
  position: number;
  lastTimestamp: number | null;
}

const SQUAT_START_VERTICAL_TRAVEL = 3;
const MIN_SQUAT_DEPTH_VERTICAL_TRAVEL = 7;
const DEFAULT_SQUAT_DEPTH_VERTICAL_TRAVEL = 9;
const PERSONAL_DEPTH_RATIO = 0.82;
const SQUAT_RISE_RATIO = 0.58;
const SQUAT_STAND_VERTICAL_TRAVEL = 2;
const GRAVITY_MAGNITUDE = 9.81;
const VERTICAL_TRAVEL_SCALE = 11;
const VELOCITY_DAMPING = 0.9;
const POSITION_DAMPING = 0.985;

export interface SquatMotionProfile {
  targetDepthTravel: number;
  deepestTravel: number;
}

export interface SquatMotionResult {
  state: SquatMotionState;
  stage: MotionStage;
  completedRep: boolean;
  profile: SquatMotionProfile;
}

export function createSquatMotionProfile(): SquatMotionProfile {
  return {
    targetDepthTravel: DEFAULT_SQUAT_DEPTH_VERTICAL_TRAVEL,
    deepestTravel: 0,
  };
}

export function createVerticalTravelTracker(gravityBaseline: MotionVector | null = null): VerticalTravelTracker {
  return {
    gravityBaseline,
    velocity: 0,
    position: 0,
    lastTimestamp: null,
  };
}

export function averageMotionVector(samples: MotionVector[]): MotionVector {
  const sampleCount = Math.max(samples.length, 1);

  return samples.reduce(
    (sum, sample) => ({
      x: sum.x + sample.x / sampleCount,
      y: sum.y + sample.y / sampleCount,
      z: sum.z + sample.z / sampleCount,
    }),
    { x: 0, y: 0, z: 0 }
  );
}

export function measureVerticalTravel(
  tracker: VerticalTravelTracker,
  acceleration: MotionVector,
  timestamp: number
): { tracker: VerticalTravelTracker; verticalTravel: number } {
  if (!tracker.gravityBaseline) {
    return {
      tracker: { ...tracker, gravityBaseline: acceleration, lastTimestamp: timestamp },
      verticalTravel: 0,
    };
  }

  const gravityBaseline = tracker.gravityBaseline;
  const baselineMagnitude = Math.sqrt(
    gravityBaseline.x * gravityBaseline.x + gravityBaseline.y * gravityBaseline.y + gravityBaseline.z * gravityBaseline.z
  ) || GRAVITY_MAGNITUDE;
  const verticalUnit = {
    x: gravityBaseline.x / baselineMagnitude,
    y: gravityBaseline.y / baselineMagnitude,
    z: gravityBaseline.z / baselineMagnitude,
  };
  const verticalAcceleration = ((acceleration.x - gravityBaseline.x) * verticalUnit.x)
    + ((acceleration.y - gravityBaseline.y) * verticalUnit.y)
    + ((acceleration.z - gravityBaseline.z) * verticalUnit.z);
  const elapsedSeconds = Math.min(Math.max((timestamp - (tracker.lastTimestamp ?? timestamp)) / 1000, 0), 0.08);
  const velocity = (tracker.velocity + verticalAcceleration * elapsedSeconds) * VELOCITY_DAMPING;
  const position = (tracker.position + velocity * elapsedSeconds * VERTICAL_TRAVEL_SCALE) * POSITION_DAMPING;

  return {
    tracker: {
      gravityBaseline,
      velocity,
      position,
      lastTimestamp: timestamp,
    },
    verticalTravel: Math.abs(position),
  };
}

export function evaluateSquatMotion(
  currentState: SquatMotionState,
  verticalTravel: number,
  profile: SquatMotionProfile = createSquatMotionProfile()
): SquatMotionResult {
  const deepestTravel = Math.max(profile.deepestTravel, verticalTravel);
  const targetDepthTravel = Math.max(
    MIN_SQUAT_DEPTH_VERTICAL_TRAVEL,
    Math.min(DEFAULT_SQUAT_DEPTH_VERTICAL_TRAVEL, deepestTravel * PERSONAL_DEPTH_RATIO)
  );
  const riseTravel = Math.max(SQUAT_STAND_VERTICAL_TRAVEL + 1, targetDepthTravel * SQUAT_RISE_RATIO);
  const nextProfile = { targetDepthTravel, deepestTravel };

  if (currentState === "standing") {
    if (verticalTravel >= SQUAT_START_VERTICAL_TRAVEL) {
      return { state: "down", stage: "descending", completedRep: false, profile: nextProfile };
    }

    return { state: "standing", stage: "steady", completedRep: false, profile: nextProfile };
  }

  if (currentState === "down") {
    if (verticalTravel >= targetDepthTravel) {
      return { state: "bottom", stage: "bottom", completedRep: false, profile: nextProfile };
    }

    if (verticalTravel <= SQUAT_STAND_VERTICAL_TRAVEL) {
      return { state: "standing", stage: "steady", completedRep: false, profile: nextProfile };
    }

    return { state: "down", stage: "descending", completedRep: false, profile: nextProfile };
  }

  if (currentState === "bottom") {
    if (verticalTravel <= riseTravel) {
      return { state: "rising", stage: "rising", completedRep: false, profile: nextProfile };
    }

    return { state: "bottom", stage: "bottom", completedRep: false, profile: nextProfile };
  }

  if (verticalTravel <= SQUAT_STAND_VERTICAL_TRAVEL) {
    return { state: "standing", stage: "steady", completedRep: true, profile: nextProfile };
  }

  if (verticalTravel >= targetDepthTravel) {
    return { state: "bottom", stage: "bottom", completedRep: false, profile: nextProfile };
  }

  return { state: "rising", stage: "rising", completedRep: false, profile: nextProfile };
}