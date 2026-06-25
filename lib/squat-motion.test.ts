import { describe, expect, it } from "vitest";

import {
  averageMotionVector,
  createPhoneMotionTracker,
  createSquatMotionProfile,
  evaluateSquatMotion,
  measurePhoneMotion,
  type MotionVector,
  type SquatMotionProfile,
  type SquatMotionState,
} from "@/lib/squat-motion";

function runMotionSequence(motions: Array<{ direction: "down" | "up" | null; score?: number }>) {
  let state: SquatMotionState = "standing";
  let profile: SquatMotionProfile = createSquatMotionProfile();
  let reps = 0;
  let timestamp = 0;

  for (const motion of motions) {
    timestamp += 160;
    const result = evaluateSquatMotion(state, { direction: motion.direction, score: motion.score ?? (motion.direction ? 1.5 : 0), timestamp }, profile);
    state = result.state;
    profile = result.profile;

    if (result.completedRep) {
      reps += 1;
    }
  }

  return { profile, state, reps };
}

function runDirectionSequence(directions: Array<"down" | "up" | null>) {
  return runMotionSequence(directions.map((direction) => ({ direction })));
}

describe("evaluateSquatMotion", () => {
  it("does not count movement in only one direction", () => {
    const result = runDirectionSequence([null, "down", "down", null, null]);

    expect(result.reps).toBe(0);
  });

  it("counts after the phone moves down and then back up", () => {
    const result = runMotionSequence([
      { direction: null },
      { direction: "down", score: 2.0 },
      { direction: null },
      { direction: "up", score: 1.9 },
      { direction: null },
    ]);

    expect(result.reps).toBe(1);
    expect(result.state).toBe("standing");
  });

  it("does not count until the return motion is close to the outbound motion", () => {
    const result = runMotionSequence([
      { direction: null },
      { direction: "down", score: 2.4 },
      { direction: null },
      { direction: "up", score: 1.8 },
      { direction: null },
    ]);

    expect(result.reps).toBe(0);
    expect(result.state).toBe("rising");
  });

  it("does not count a tiny down-up flick", () => {
    const result = runMotionSequence([
      { direction: null },
      { direction: "down", score: 0.8 },
      { direction: "up", score: 0.8 },
      { direction: null },
    ]);

    expect(result.reps).toBe(0);
  });

  it("counts after multiple return samples reach near the start position", () => {
    const result = runMotionSequence([
      { direction: null },
      { direction: "down", score: 2.4 },
      { direction: null },
      { direction: "up", score: 1.0 },
      { direction: "up", score: 1.2 },
      { direction: null },
    ]);

    expect(result.reps).toBe(1);
    expect(result.state).toBe("standing");
  });

  it("also counts when the first strong motion is upward and then downward", () => {
    const result = runMotionSequence([
      { direction: null },
      { direction: "up", score: 2.0 },
      { direction: null },
      { direction: "down", score: 1.9 },
      { direction: null },
    ]);

    expect(result.reps).toBe(1);
    expect(result.state).toBe("standing");
  });
});

function runPhoneMotionSequence(baseline: MotionVector, samples: MotionVector[]) {
  let tracker = createPhoneMotionTracker(baseline);
  let timestamp = 0;
  const directions: Array<"down" | "up" | null> = [];

  for (const sample of samples) {
    timestamp += 80;
    const result = measurePhoneMotion(tracker, sample, timestamp);
    tracker = result.tracker;
    directions.push(result.sample.direction);
  }

  return { directions, tracker };
}

describe("measurePhoneMotion", () => {
  it("averages calibration samples into a gravity baseline", () => {
    expect(averageMotionVector([
      { x: 0.2, y: -0.1, z: 9.7 },
      { x: -0.2, y: 0.1, z: 9.9 },
    ])).toEqual({ x: 0, y: 0, z: 9.8 });
  });

  it("stays quiet while the phone is held still", () => {
    const result = runPhoneMotionSequence({ x: 0, y: 0, z: 9.81 }, Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 9.81 })));

    expect(result.directions.every((direction) => direction === null)).toBe(true);
  });

  it("detects down then up movement when the phone is held flat", () => {
    const result = runPhoneMotionSequence({ x: 0, y: 0, z: 9.81 }, [
      { x: 0, y: 0, z: 11.4 },
      { x: 0, y: 0, z: 9.81 },
      { x: 0, y: 0, z: 8.2 },
    ]);

    expect(result.directions).toEqual(["down", null, "up"]);
  });

  it("detects down then up movement when the phone is held sideways", () => {
    const result = runPhoneMotionSequence({ x: 9.81, y: 0, z: 0 }, [
      { x: 11.4, y: 0, z: 0 },
      { x: 9.81, y: 0, z: 0 },
      { x: 8.2, y: 0, z: 0 },
    ]);

    expect(result.directions).toEqual(["down", null, "up"]);
  });

  it("ignores sideways shaking in landscape grip", () => {
    const result = runPhoneMotionSequence({ x: 9.81, y: 0, z: 0 }, [
      { x: 9.81, y: 0.8, z: 0.1 },
      { x: 9.81, y: 0, z: 0 },
      { x: 9.81, y: -0.8, z: 0.1 },
    ]);

    expect(result.directions).toEqual([null, null, null]);
  });

  it("falls back to the strongest axis when gravity is not included", () => {
    const result = runPhoneMotionSequence({ x: 0, y: 0, z: 0 }, [
      { x: 0, y: 1.7, z: 0.2 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: -1.7, z: 0.2 },
    ]);

    expect(result.directions).toEqual(["down", null, "up"]);
  });
});