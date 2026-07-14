export type MotionStage = "steady" | "descending" | "bottom" | "rising";
export type SquatMotionState = "standing" | "down" | "bottom" | "rising";
export type PhoneMotionDirection = "down" | "up";

export interface MotionVector {
  x: number;
  y: number;
  z: number;
}

export interface PhoneMotionTracker {
  gravityDirection: MotionVector | null;
  gravityMagnitude: number;
  usesGravity: boolean | null;
  lastTimestamp: number | null;
}

export interface PhoneMotionSample {
  direction: PhoneMotionDirection | null;
  score: number;
  timestamp: number;
}

const GRAVITY_MAGNITUDE = 9.81;
const MOTION_THRESHOLD = 0.55;
const QUIET_DRIFT_THRESHOLD = 0.18;
const MIN_VERTICAL_ALIGNMENT = 0.55;
const MIN_MAGNITUDE_FALLBACK_ALIGNMENT = 0.3;
const GRAVITY_DIRECTION_SMOOTHING = 0.15;
const MIN_DIRECTION_GAP_MS = 90;
const MAX_REP_GAP_MS = 5000;
const REP_COOLDOWN_MS = 850;
const REQUIRED_SETTLE_SAMPLES = 2;
const RETURN_TO_START_RATIO = 0.75;
const MIN_OUTBOUND_SCORE = 1.2;
const MIN_RETURN_SCORE = 1;

export interface SquatMotionProfile {
  firstDirection: PhoneMotionDirection | null;
  firstDirectionAt: number | null;
  cooldownUntil: number;
  strongestScore: number;
  outboundScore: number;
  returnScore: number;
  settleSamples: number;
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
    settleSamples: REQUIRED_SETTLE_SAMPLES,
  };
}


export function createPhoneMotionTracker(gravityBaseline: MotionVector | null = null): PhoneMotionTracker {
  const gravityMagnitude = gravityBaseline ? vectorMagnitude(gravityBaseline) : 0;

  return {
    gravityDirection: gravityMagnitude > 0 ? scaleVector(gravityBaseline!, 1 / gravityMagnitude) : null,
    gravityMagnitude,
    usesGravity: gravityBaseline ? gravityMagnitude >= GRAVITY_MAGNITUDE * 0.4 : null,
    lastTimestamp: null,
  };
}

function vectorMagnitude(vector: MotionVector) {
  return Math.sqrt((vector.x * vector.x) + (vector.y * vector.y) + (vector.z * vector.z));
}

function scaleVector(vector: MotionVector, scale: number): MotionVector {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  };
}

function normalizeVector(vector: MotionVector): MotionVector | null {
  const magnitude = vectorMagnitude(vector);

  return magnitude > 0 ? scaleVector(vector, 1 / magnitude) : null;
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
  const accelerationMagnitude = vectorMagnitude(acceleration);

  if (tracker.usesGravity === false) {
    const strongestAxisMotion = [acceleration.x, acceleration.y, acceleration.z].reduce(
      (strongest, value) => Math.abs(value) > Math.abs(strongest) ? value : strongest,
      0
    );
    const score = Math.abs(strongestAxisMotion);

    return {
      tracker: { ...tracker, lastTimestamp: timestamp },
      sample: {
        direction: score >= MOTION_THRESHOLD ? strongestAxisMotion >= 0 ? "down" : "up" : null,
        score,
        timestamp,
      },
    };
  }

  if (!tracker.gravityDirection) {
    const gravityDirection = normalizeVector(acceleration);

    return {
      tracker: {
        ...tracker,
        gravityDirection,
        gravityMagnitude: accelerationMagnitude,
        usesGravity: accelerationMagnitude >= GRAVITY_MAGNITUDE * 0.4,
        lastTimestamp: timestamp,
      },
      sample: { direction: null, score: 0, timestamp },
    };
  }

  const gravityDirection = tracker.gravityDirection;
  const projectedAcceleration = (acceleration.x * gravityDirection.x)
    + (acceleration.y * gravityDirection.y)
    + (acceleration.z * gravityDirection.z);
  const signedMotion = projectedAcceleration - tracker.gravityMagnitude;
  const perpendicularMotion = {
    x: acceleration.x - (projectedAcceleration * gravityDirection.x),
    y: acceleration.y - (projectedAcceleration * gravityDirection.y),
    z: acceleration.z - (projectedAcceleration * gravityDirection.z),
  };
  const totalMotion = Math.sqrt((signedMotion * signedMotion) + (vectorMagnitude(perpendicularMotion) ** 2));
  const verticalAlignment = totalMotion > 0 ? Math.abs(signedMotion) / totalMotion : 0;
  const magnitudeDelta = accelerationMagnitude - tracker.gravityMagnitude;
  const orientationOnlyMotion = Math.abs(magnitudeDelta) < MOTION_THRESHOLD;
  const canUseMagnitudeFallback = !orientationOnlyMotion
    && verticalAlignment >= MIN_MAGNITUDE_FALLBACK_ALIGNMENT;
  const measuredMotion = tracker.gravityMagnitude >= GRAVITY_MAGNITUDE * 0.4
    && verticalAlignment < MIN_VERTICAL_ALIGNMENT
    ? canUseMagnitudeFallback ? magnitudeDelta : 0
    : Math.abs(magnitudeDelta) > Math.abs(signedMotion) ? magnitudeDelta : signedMotion;
  const score = Math.abs(measuredMotion);
  const direction = score >= MOTION_THRESHOLD
    ? measuredMotion >= 0 ? "down" : "up"
    : null;
  const isGravityOnly = Math.abs(magnitudeDelta) <= QUIET_DRIFT_THRESHOLD;
  const measuredDirection = normalizeVector(acceleration);
  const nextGravityDirection = isGravityOnly && measuredDirection
    ? normalizeVector({
      x: gravityDirection.x * (1 - GRAVITY_DIRECTION_SMOOTHING) + measuredDirection.x * GRAVITY_DIRECTION_SMOOTHING,
      y: gravityDirection.y * (1 - GRAVITY_DIRECTION_SMOOTHING) + measuredDirection.y * GRAVITY_DIRECTION_SMOOTHING,
      z: gravityDirection.z * (1 - GRAVITY_DIRECTION_SMOOTHING) + measuredDirection.z * GRAVITY_DIRECTION_SMOOTHING,
    }) ?? gravityDirection
    : gravityDirection;
  const nextGravityMagnitude = isGravityOnly
    ? tracker.gravityMagnitude * 0.98 + accelerationMagnitude * 0.02
    : tracker.gravityMagnitude;

  return {
    tracker: {
      gravityDirection: nextGravityDirection,
      gravityMagnitude: nextGravityMagnitude,
      usesGravity: tracker.usesGravity,
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
  const settleSamples = motion.direction ? 0 : Math.min(REQUIRED_SETTLE_SAMPLES, profile.settleSamples + 1);
  const nextProfile = { ...profile, strongestScore, settleSamples };

  const isWaitingForNextRep = profile.firstDirection === null
    && (motion.timestamp < profile.cooldownUntil || profile.settleSamples < REQUIRED_SETTLE_SAMPLES);

  if (isWaitingForNextRep) {
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
    if (motion.direction !== "down") {
      return { state: "standing", stage: "steady", completedRep: false, profile: nextProfile };
    }

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
        settleSamples: 0,
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
      state: "standing",
      stage: "steady",
      completedRep: false,
      profile: {
        ...nextProfile,
        firstDirection: null,
        firstDirectionAt: null,
        outboundScore: 0,
        returnScore: 0,
        settleSamples: 0,
      },
    };
  }

  if (
    motion.direction !== firstDirection
    && elapsedMs >= MIN_DIRECTION_GAP_MS
    && outboundScore >= MIN_OUTBOUND_SCORE
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
        settleSamples: 0,
      },
    };
  }

  return {
    state: motion.direction !== firstDirection ? "rising" : currentState === "rising" ? "rising" : "down",
    stage: motion.direction !== firstDirection ? "rising" : currentState === "bottom" ? "bottom" : "descending",
    completedRep: false,
    profile: { ...nextProfile, firstDirection, firstDirectionAt, outboundScore, returnScore, settleSamples: 0 },
  };
}