import { describe, expect, it } from "vitest";

import { createSquatMotionProfile, evaluateSquatMotion, type SquatMotionProfile, type SquatMotionState } from "@/lib/squat-motion";

function runTiltSequence(tilts: number[]) {
  let state: SquatMotionState = "standing";
  let profile: SquatMotionProfile = createSquatMotionProfile();
  let reps = 0;

  for (const tilt of tilts) {
    const result = evaluateSquatMotion(state, tilt, profile);
    state = result.state;
    profile = result.profile;

    if (result.completedRep) {
      reps += 1;
    }
  }

  return { profile, state, reps };
}

describe("evaluateSquatMotion", () => {
  it("does not count a shallow dip", () => {
    const result = runTiltSequence([0, 11, 15, 12, 6, 0]);

    expect(result.reps).toBe(0);
    expect(result.state).toBe("standing");
  });

  it("counts after reaching squat depth and returning to standing", () => {
    const result = runTiltSequence([0, 11, 18, 25, 22, 13, 7, 0]);

    expect(result.reps).toBe(1);
    expect(result.state).toBe("standing");
  });

  it("adapts depth to the person's observed range without counting shallow motion", () => {
    const result = runTiltSequence([0, 11, 20, 27, 16, 7, 0, 11, 19, 22.2, 13, 7, 0]);

    expect(result.profile.targetDepthTiltDelta).toBeLessThan(24);
    expect(result.reps).toBe(2);
    expect(result.state).toBe("standing");
  });
});