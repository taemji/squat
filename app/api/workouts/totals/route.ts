import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

import { SQUAT_USERS } from "@/lib/squat-users";
import { sumWorkoutReps } from "@/lib/workout-summary";

function getRedisClient() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Upstash Redis environment variables are not configured.");
  }

  return new Redis({ url, token });
}

function getWorkoutCompletionKey(userId: string) {
  return `squat:workout-completions:${userId}`;
}

export async function GET() {
  try {
    const redis = getRedisClient();
    const userTotals = await Promise.all(
      SQUAT_USERS.map(async (user) => {
        const records = await redis.hgetall<Record<string, unknown>>(getWorkoutCompletionKey(user.id)) ?? {};

        return {
          userId: user.id,
          userName: user.name,
          totalReps: sumWorkoutReps(records),
        };
      })
    );

    return NextResponse.json({ userTotals });
  } catch (error) {
    console.error("Failed to load workout totals:", error);

    return NextResponse.json({ error: "Workout database is not configured yet." }, { status: 503 });
  }
}