import { describe, expect, it } from "vitest";

import {
  averageMotionVector,
  createSquatMotionProfile,
  createVerticalTravelTracker,
  evaluateSquatMotion,
  measureVerticalTravel,
  type MotionVector,
  type SquatMotionProfile,
  type SquatMotionState,
} from "@/lib/squat-motion";

function runVerticalTravelSequence(travelValues: number[]) {
  let state: SquatMotionState = "standing";
  let profile: SquatMotionProfile = createSquatMotionProfile();
  let reps = 0;

  for (const travel of travelValues) {
    const result = evaluateSquatMotion(state, travel, profile);
    state = result.state;
    profile = result.profile;

    if (result.completedRep) {
      reps += 1;
    }
  }

  return { profile, state, reps };
}

describe("evaluateSquatMotion", () => {
  it("does not count a shallow vertical dip", () => {
    const result = runVerticalTravelSequence([0, 3.2, 5.4, 4.2, 1.8, 0]);

    expect(result.reps).toBe(0);
    expect(result.state).toBe("standing");
  });

  it("counts after reaching squat depth by vertical travel and returning to standing", () => {
    const result = runVerticalTravelSequence([0, 3.2, 6, 9.2, 7.4, 4.8, 1.6, 0]);

    expect(result.reps).toBe(1);
    expect(result.state).toBe("standing");
  });

  it("adapts depth to the person's observed vertical range without counting shallow motion", () => {
    const result = runVerticalTravelSequence([0, 3.2, 6.5, 10.5, 5.8, 1.6, 0, 3.2, 5.8, 8.7, 4.8, 1.6, 0]);

    expect(result.profile.targetDepthTravel).toBeLessThan(9);
    expect(result.reps).toBe(2);
    expect(result.state).toBe("standing");
  });
});

function runVerticalSensorSequence(samples: MotionVector[]) {
  let tracker = createVerticalTravelTracker({ x: 0, y: 0, z: 9.81 });
  let timestamp = 0;
  let maxTravel = 0;

  for (const sample of samples) {
    timestamp += 80;
    const result = measureVerticalTravel(tracker, sample, timestamp);
    tracker = result.tracker;
    maxTravel = Math.max(maxTravel, result.verticalTravel);
  }

  return { maxTravel, tracker };
}

describe("measureVerticalTravel", () => {
  it("averages calibration samples into a gravity baseline", () => {
    expect(averageMotionVector([
      { x: 0.2, y: -0.1, z: 9.7 },
      { x: -0.2, y: 0.1, z: 9.9 },
    ])).toEqual({ x: 0, y: 0, z: 9.8 });
  });

  it("stays near zero while the phone is held still", () => {
    const result = runVerticalSensorSequence(Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 9.81 })));

    expect(result.maxTravel).toBeLessThan(0.1);
  });

  it("detects vertical travel from up and down phone movement", () => {
    const downwardMotion = Array.from({ length: 16 }, () => ({ x: 0, y: 0, z: 18.5 }));
    const upwardMotion = Array.from({ length: 16 }, () => ({ x: 0, y: 0, z: 1.2 }));
    const result = runVerticalSensorSequence([...downwardMotion, ...upwardMotion]);

    expect(result.maxTravel).toBeGreaterThan(7);
  });
});