import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

import { isSquatUserId } from "@/lib/squat-users";
import { calculateCurrentStreak, isIsoDate, sumWorkoutReps } from "@/lib/workout-summary";

class MissingRedisConfigError extends Error {
  constructor() {
    super("Upstash Redis environment variables are not configured.");
    this.name = "MissingRedisConfigError";
  }
}

function getRedisClient() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new MissingRedisConfigError();
  }

  return new Redis({ url, token });
}

function getWorkoutCompletionKey(userId: string) {
  return `squat:workout-completions:${userId}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const today = searchParams.get("today");

  if (!isSquatUserId(userId) || !isIsoDate(today)) {
    return NextResponse.json({ error: "Invalid workout summary request." }, { status: 400 });
  }

  try {
    const redis = getRedisClient();
    const records = await redis.hgetall<Record<string, unknown>>(getWorkoutCompletionKey(userId)) ?? {};
    const completionDates = Object.keys(records).sort();
    const totalReps = sumWorkoutReps(records);

    return NextResponse.json({
      completionDates,
      currentStreak: calculateCurrentStreak(completionDates, today),
      todayCompleted: completionDates.includes(today),
      totalDays: completionDates.length,
      totalReps,
    });
  } catch (error) {
    if (!(error instanceof MissingRedisConfigError)) {
      console.error("Failed to load workout summary:", error);
    }

    return NextResponse.json({ error: "Workout database is not configured yet." }, { status: 503 });
  }
}
