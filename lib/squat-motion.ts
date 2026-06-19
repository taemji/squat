export type MotionStage = "steady" | "descending" | "bottom" | "rising";
export type SquatMotionState = "standing" | "down" | "bottom" | "rising";

const SQUAT_START_TILT_DELTA = 10;
const MIN_SQUAT_DEPTH_TILT_DELTA = 22;
const DEFAULT_SQUAT_DEPTH_TILT_DELTA = 24;
const PERSONAL_DEPTH_RATIO = 0.82;
const SQUAT_RISE_RATIO = 0.58;
const SQUAT_STAND_TILT_DELTA = 8;

export interface SquatMotionProfile {
  targetDepthTiltDelta: number;
  deepestTiltDelta: number;
}

export interface SquatMotionResult {
  state: SquatMotionState;
  stage: MotionStage;
  completedRep: boolean;
  profile: SquatMotionProfile;
}

export function createSquatMotionProfile(): SquatMotionProfile {
  return {
    targetDepthTiltDelta: DEFAULT_SQUAT_DEPTH_TILT_DELTA,
    deepestTiltDelta: 0,
  };
}

export function evaluateSquatMotion(
  currentState: SquatMotionState,
  tiltDelta: number,
  profile: SquatMotionProfile = createSquatMotionProfile()
): SquatMotionResult {
  const deepestTiltDelta = Math.max(profile.deepestTiltDelta, tiltDelta);
  const targetDepthTiltDelta = Math.max(
    MIN_SQUAT_DEPTH_TILT_DELTA,
    Math.min(DEFAULT_SQUAT_DEPTH_TILT_DELTA, deepestTiltDelta * PERSONAL_DEPTH_RATIO)
  );
  const riseTiltDelta = Math.max(SQUAT_STAND_TILT_DELTA + 2, targetDepthTiltDelta * SQUAT_RISE_RATIO);
  const nextProfile = { targetDepthTiltDelta, deepestTiltDelta };

  if (currentState === "standing") {
    if (tiltDelta >= SQUAT_START_TILT_DELTA) {
      return { state: "down", stage: "descending", completedRep: false, profile: nextProfile };
    }

    return { state: "standing", stage: "steady", completedRep: false, profile: nextProfile };
  }

  if (currentState === "down") {
    if (tiltDelta >= targetDepthTiltDelta) {
      return { state: "bottom", stage: "bottom", completedRep: false, profile: nextProfile };
    }

    if (tiltDelta <= SQUAT_STAND_TILT_DELTA) {
      return { state: "standing", stage: "steady", completedRep: false, profile: nextProfile };
    }

    return { state: "down", stage: "descending", completedRep: false, profile: nextProfile };
  }

  if (currentState === "bottom") {
    if (tiltDelta <= riseTiltDelta) {
      return { state: "rising", stage: "rising", completedRep: false, profile: nextProfile };
    }

    return { state: "bottom", stage: "bottom", completedRep: false, profile: nextProfile };
  }

  if (tiltDelta <= SQUAT_STAND_TILT_DELTA) {
    return { state: "standing", stage: "steady", completedRep: true, profile: nextProfile };
  }

  if (tiltDelta >= targetDepthTiltDelta) {
    return { state: "bottom", stage: "bottom", completedRep: false, profile: nextProfile };
  }

  return { state: "rising", stage: "rising", completedRep: false, profile: nextProfile };
}