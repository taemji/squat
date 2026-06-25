export type MotionStage = "steady" | "descending" | "bottom" | "rising";
export type SquatMotionState = "standing" | "down" | "bottom" | "rising";
export type PhoneMotionDirection = "down" | "up";

export interface MotionVector {
  x: number;
  y: number;
  z: number;
}

export interface PhoneMotionTracker {
  gravityBaseline: MotionVector | null;
  lastTimestamp: number | null;
}

export interface PhoneMotionSample {
  direction: PhoneMotionDirection | null;
  score: number;
  timestamp: number;
}

const GRAVITY_MAGNITUDE = 9.81;
const MOTION_THRESHOLD = 1.05;
const QUIET_DRIFT_THRESHOLD = 0.35;
const MIN_DIRECTION_GAP_MS = 90;
const MAX_REP_GAP_MS = 1800;
const REP_COOLDOWN_MS = 350;
const RETURN_TO_START_RATIO = 0.72;
const MIN_RETURN_SCORE = 1.2;

export interface SquatMotionProfile {
  firstDirection: PhoneMotionDirection | null;
  firstDirectionAt: number | null;
  cooldownUntil: number;
  strongestScore: number;
  outboundScore: number;
  returnScore: number;
}

export interface SquatMotionResult {
  state: SquatMotionState;
  stage: MotionStage;
  completedRep: boolean;
  profile: SquatMotionProfile;
}

export function createSquatMotionProfile(): SquatMotionProfile {
  return {
    firstDirection: null,
    firstDirectionAt: null,
    cooldownUntil: 0,
    strongestScore: 0,
    outboundScore: 0,
    returnScore: 0,
  };
}

export function createPhoneMotionTracker(gravityBaseline: MotionVector | null = null): PhoneMotionTracker {
  return {
    gravityBaseline,
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

export function measurePhoneMotion(
  tracker: PhoneMotionTracker,
  acceleration: MotionVector,
  timestamp: number
): { tracker: PhoneMotionTracker; sample: PhoneMotionSample } {
  if (!tracker.gravityBaseline) {
    return {
      tracker: { ...tracker, gravityBaseline: acceleration, lastTimestamp: timestamp },
      sample: { direction: null, score: 0, timestamp },
    };
  }

  const gravityBaseline = tracker.gravityBaseline;
  const baselineMagnitude = Math.sqrt(
    gravityBaseline.x * gravityBaseline.x + gravityBaseline.y * gravityBaseline.y + gravityBaseline.z * gravityBaseline.z
  );
  const delta = {
    x: acceleration.x - gravityBaseline.x,
    y: acceleration.y - gravityBaseline.y,
    z: acceleration.z - gravityBaseline.z,
  };
  const signedMotion = baselineMagnitude >= GRAVITY_MAGNITUDE * 0.4
    ? (() => {
      const verticalUnit = {
        x: gravityBaseline.x / baselineMagnitude,
        y: gravityBaseline.y / baselineMagnitude,
        z: gravityBaseline.z / baselineMagnitude,
      };

      return (delta.x * verticalUnit.x) + (delta.y * verticalUnit.y) + (delta.z * verticalUnit.z);
    })()
    : [delta.x, delta.y, delta.z].reduce((strongest, value) => Math.abs(value) > Math.abs(strongest) ? value : strongest, 0);
  const score = Math.abs(signedMotion);
  const direction = score >= MOTION_THRESHOLD
    ? signedMotion >= 0 ? "down" : "up"
    : null;
  const nextGravityBaseline = score <= QUIET_DRIFT_THRESHOLD
    ? {
      x: gravityBaseline.x * 0.98 + acceleration.x * 0.02,
      y: gravityBaseline.y * 0.98 + acceleration.y * 0.02,
      z: gravityBaseline.z * 0.98 + acceleration.z * 0.02,
    }
    : gravityBaseline;

  return {
    tracker: {
      gravityBaseline: nextGravityBaseline,
      lastTimestamp: timestamp,
    },
    sample: { direction, score, timestamp },
  };
}

export function evaluateSquatMotion(
  currentState: SquatMotionState,
  motion: PhoneMotionSample,
  profile: SquatMotionProfile = createSquatMotionProfile()
): SquatMotionResult {
  const strongestScore = Math.max(profile.strongestScore, motion.score);
  const nextProfile = { ...profile, strongestScore };

  if (motion.timestamp < profile.cooldownUntil) {
    return { state: "standing", stage: "steady", completedRep: false, profile: nextProfile };
  }

  if (!motion.direction) {
    if (currentState === "down") {
      return { state: "bottom", stage: "bottom", completedRep: false, profile: nextProfile };
    }

    if (currentState === "bottom") {
      return { state: "bottom", stage: "bottom", completedRep: false, profile: nextProfile };
    }

    if (currentState === "rising") {
      return { state: "rising", stage: "rising", completedRep: false, profile: nextProfile };
    }

    return { state: "standing", stage: "steady", completedRep: false, profile: nextProfile };
  }

  if (currentState === "standing") {
    return {
      state: "down",
      stage: "descending",
      completedRep: false,
      profile: {
        ...nextProfile,
        firstDirection: motion.direction,
        firstDirectionAt: motion.timestamp,
        outboundScore: motion.score,
        returnScore: 0,
      },
    };
  }

  const firstDirection = profile.firstDirection ?? motion.direction;
  const firstDirectionAt = profile.firstDirectionAt ?? motion.timestamp;
  const elapsedMs = motion.timestamp - firstDirectionAt;
  const outboundScore = motion.direction === firstDirection ? profile.outboundScore + motion.score : profile.outboundScore;
  const returnScore = motion.direction !== firstDirection ? profile.returnScore + motion.score : profile.returnScore;

  if (elapsedMs > MAX_REP_GAP_MS) {
    return {
      state: "down",
      stage: "descending",
      completedRep: false,
      profile: {
        ...nextProfile,
        firstDirection: motion.direction,
        firstDirectionAt: motion.timestamp,
        outboundScore: motion.score,
        returnScore: 0,
      },
    };
  }

  if (
    motion.direction !== firstDirection
    && elapsedMs >= MIN_DIRECTION_GAP_MS
    && returnScore >= Math.max(MIN_RETURN_SCORE, outboundScore * RETURN_TO_START_RATIO)
  ) {
    return {
      state: "standing",
      stage: "rising",
      completedRep: true,
      profile: {
        ...nextProfile,
        firstDirection: null,
        firstDirectionAt: null,
        cooldownUntil: motion.timestamp + REP_COOLDOWN_MS,
        outboundScore: 0,
        returnScore: 0,
      },
    };
  }

  return {
    state: motion.direction !== firstDirection ? "rising" : currentState === "rising" ? "rising" : "down",
    stage: motion.direction !== firstDirection ? "rising" : currentState === "bottom" ? "bottom" : "descending",
    completedRep: false,
    profile: { ...nextProfile, firstDirection, firstDirectionAt, outboundScore, returnScore },
  };
}