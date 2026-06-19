"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIcon,
  CheckIcon,
  RotateCcwIcon,
  Share2Icon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createSquatMotionProfile, evaluateSquatMotion, type MotionStage, type SquatMotionProfile, type SquatMotionState } from "@/lib/squat-motion";

type WorkoutPhase = "setup" | "countdown" | "active" | "complete";
type SensorStatus = "idle" | "listening" | "unsupported" | "blocked";

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function playCountSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(620, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(920, audioContext.currentTime + 0.08);
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.14, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.16);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.18);
};

function speakText(phrase: string) {
  if (!("speechSynthesis" in window)) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(phrase);
  utterance.lang = "ko-KR";
  utterance.rate = 1.04;
  utterance.pitch = 1.1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function speakMilestone(count: number, goal: number) {
  const remaining = goal - count;

  if (count >= goal) {
    speakText(`목표 달성, ${goal}개 완료!`);
    return;
  }

  if (remaining === 10) {
    speakText("목표까지 10개 남았어요.");
    return;
  }

  if (count > 0 && count % 10 === 0) {
    speakText(`${count}개 완료!`);
  }
}

export function SquatCoachApp() {
  const [goal, setGoal] = useState(100);
  const [goalInput, setGoalInput] = useState("100");
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<WorkoutPhase>("setup");
  const [, setLastMove] = useState<"ready" | "squat" | "cheer">("ready");
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>("idle");
  const [, setMotionLevel] = useState(0);
  const [, setMotionStage] = useState<MotionStage>("steady");
  const [, setIsCalibrating] = useState(false);
  const [, setCalibrationProgress] = useState(0);
  const [countdownValue, setCountdownValue] = useState<3 | 2 | 1 | 0>(3);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const baselineRef = useRef<number | null>(null);
  const orientationBaselineRef = useRef<{ beta: number; gamma: number } | null>(null);
  const orientationRef = useRef<{ beta: number | null; gamma: number | null }>({ beta: null, gamma: null });
  const calibrationSamplesRef = useRef<number[]>([]);
  const calibrationUntilRef = useRef(0);
  const isCalibratingRef = useRef(false);
  const activeGoalRef = useRef(goal);
  const motionStateRef = useRef<SquatMotionState>("standing");
  const motionProfileRef = useRef<SquatMotionProfile>(createSquatMotionProfile());
  const listenerAttachedRef = useRef(false);
  const workoutStartedAtRef = useRef<number | null>(null);

  const progress = Math.min(100, Math.round((count / goal) * 100));
  const elapsedTimeText = formatDuration(elapsedSeconds);
  const normalizedGoal = Number(goalInput);
  const isGoalValid = Number.isInteger(normalizedGoal) && normalizedGoal >= 1 && normalizedGoal <= 999;
  const resultText = useMemo(
    () => `오늘 스쿼트 ${count}개 완료! 목표 ${goal}개 중 ${progress}% 달성했어요. 운동 시간 ${elapsedTimeText}.`,
    [count, elapsedTimeText, goal, progress]
  );

  const addSquat = useCallback((source: "manual" | "sensor" = "manual") => {
    setLastMove("squat");

    window.setTimeout(() => {
      setLastMove("cheer");
    }, source === "sensor" ? 120 : 160);

    setCount((currentCount) => {
      const currentGoal = activeGoalRef.current;
      const nextCount = Math.min(currentCount + 1, currentGoal);
      playCountSound();

      speakMilestone(nextCount, currentGoal);

      if (nextCount >= currentGoal) {
        window.setTimeout(() => {
          setPhase("complete");
          setLastMove("cheer");
          setMotionStage("steady");
        }, 450);
      }

      return nextCount;
    });
  }, []);

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    orientationRef.current = {
      beta: event.beta,
      gamma: event.gamma,
    };

    if (!orientationBaselineRef.current && event.beta !== null && event.gamma !== null) {
      orientationBaselineRef.current = { beta: event.beta, gamma: event.gamma };
    }
  }, []);

  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    const acceleration = event.accelerationIncludingGravity ?? event.acceleration;

    if (!acceleration) {
      return;
    }

    const x = acceleration.x ?? 0;
    const y = acceleration.y ?? 0;
    const z = acceleration.z ?? 0;
    const magnitude = Math.sqrt(x * x + y * y + z * z);

    if (isCalibratingRef.current || (calibrationUntilRef.current > 0 && calibrationUntilRef.current > event.timeStamp)) {
      if (calibrationUntilRef.current <= 0) {
        calibrationUntilRef.current = event.timeStamp + 2500;
      }

      calibrationSamplesRef.current.push(magnitude);
      const remainingMs = Math.max(calibrationUntilRef.current - event.timeStamp, 0);
      setCalibrationProgress(Math.min(100, Math.round(((2500 - remainingMs) / 2500) * 100)));

      if (remainingMs === 0) {
        const samples = calibrationSamplesRef.current;
        baselineRef.current = samples.reduce((sum, sample) => sum + sample, 0) / Math.max(samples.length, 1);
        isCalibratingRef.current = false;
        setIsCalibrating(false);
        setCalibrationProgress(100);
        setMotionStage("steady");
        speakText("기준 자세 측정 완료. 시작하세요.");
      }

      return;
    }

    if (!baselineRef.current) {
      baselineRef.current = magnitude;
    }

    baselineRef.current = baselineRef.current * 0.96 + magnitude * 0.04;
    const movement = Math.abs(magnitude - baselineRef.current);
    const beta = orientationRef.current.beta;
    const gamma = orientationRef.current.gamma;
    const orientationBaseline = orientationBaselineRef.current;
    const tiltDelta = beta !== null && gamma !== null && orientationBaseline
      ? Math.abs(beta - orientationBaseline.beta) + Math.abs(gamma - orientationBaseline.gamma)
      : 0;
    const motionScore = movement + tiltDelta / 24;
    setMotionLevel(Math.min(100, Math.round(motionScore * 20)));

    const nextMotion = evaluateSquatMotion(motionStateRef.current, tiltDelta, motionProfileRef.current);

    if (nextMotion.state !== motionStateRef.current && nextMotion.state === "down") {
      setLastMove("squat");
    }

    motionStateRef.current = nextMotion.state;
    motionProfileRef.current = nextMotion.profile;
    setMotionStage(nextMotion.stage);

    if (nextMotion.completedRep) {
      addSquat("sensor");
    }
  }, [addSquat]);

  const connectMotionSensor = useCallback(async () => {
    if (!("DeviceMotionEvent" in window)) {
      setSensorStatus("unsupported");
      return;
    }

    try {
      const DeviceMotion = window.DeviceMotionEvent as DeviceMotionEventConstructorWithPermission;

      if (typeof DeviceMotion.requestPermission === "function") {
        const permission = await DeviceMotion.requestPermission();

        if (permission !== "granted") {
          setSensorStatus("blocked");
          return;
        }
      }

      const DeviceOrientation = window.DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission | undefined;

      if (typeof DeviceOrientation?.requestPermission === "function") {
        const permission = await DeviceOrientation.requestPermission();

        if (permission !== "granted") {
          setSensorStatus("blocked");
          return;
        }
      }

      if (!listenerAttachedRef.current) {
        window.addEventListener("devicemotion", handleMotion, { passive: true });
        window.addEventListener("deviceorientation", handleOrientation, { passive: true });
        listenerAttachedRef.current = true;
      }

      setSensorStatus("listening");
    } catch {
      setSensorStatus("blocked");
    }
  }, [handleMotion, handleOrientation]);

  const startWorkout = useCallback(async () => {
    if (!isGoalValid) {
      return;
    }

    setGoal(normalizedGoal);
    activeGoalRef.current = normalizedGoal;
    setCount(0);
    setPhase("countdown");
    setLastMove("ready");
    setMotionStage("steady");
    setMotionLevel(0);
    baselineRef.current = null;
    orientationBaselineRef.current = null;
    calibrationSamplesRef.current = [];
    calibrationUntilRef.current = 0;
    isCalibratingRef.current = true;
    motionStateRef.current = "standing";
    motionProfileRef.current = createSquatMotionProfile();
    workoutStartedAtRef.current = null;
    setIsCalibrating(true);
    setCalibrationProgress(0);
    setCountdownValue(3);
    setElapsedSeconds(0);
    await connectMotionSensor();
  }, [connectMotionSensor, isGoalValid, normalizedGoal]);

  useEffect(() => {
    if (phase !== "countdown") {
      return;
    }

    const countdownSteps: Array<3 | 2 | 1 | 0> = [3, 2, 1, 0];
    let currentStepIndex = 0;

    speakText("3");

    const timerId = window.setInterval(() => {
      currentStepIndex += 1;
      const nextStep = countdownSteps[currentStepIndex];

      if (nextStep === undefined) {
        window.clearInterval(timerId);
        setPhase("active");
        setLastMove("ready");
        return;
      }

      setCountdownValue(nextStep);
      speakText(nextStep === 0 ? "시작" : `${nextStep}`);
    }, 900);

    return () => {
      window.clearInterval(timerId);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "active") {
      return;
    }

    workoutStartedAtRef.current = performance.now();

    const timerId = window.setInterval(() => {
      const startedAt = workoutStartedAtRef.current;

      if (startedAt === null) {
        return;
      }

      setElapsedSeconds(Math.floor((performance.now() - startedAt) / 1000));
    }, 500);

    return () => {
      window.clearInterval(timerId);
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      window.removeEventListener("devicemotion", handleMotion);
      window.removeEventListener("deviceorientation", handleOrientation);
    };
  }, [handleMotion, handleOrientation]);

  async function shareResult() {
    if (navigator.share) {
      await navigator.share({ title: "Squat Coach 기록", text: resultText });
      return;
    }

    await navigator.clipboard.writeText(resultText);
  }

  return (
    <main className="coach-shell min-h-svh overflow-hidden text-foreground">
      <section className="mx-auto flex min-h-svh w-full max-w-[430px] flex-col px-5 py-5">
        <header className="flex justify-center pb-5 pt-1 text-center">
          <h1 className="coach-wordmark" aria-label="Squat Coach">
            <span aria-hidden="true" className="coach-wordmark-main">Squat</span>
            <span aria-hidden="true" className="coach-wordmark-accent">Coach</span>
          </h1>
        </header>

        <div className="flex flex-1 items-stretch pb-3">
          <section className="coach-card flex w-full flex-col overflow-hidden rounded-[2rem] border border-[var(--coach-line)] bg-[var(--coach-panel)]">
            {phase === "setup" && (
              <div className="flex min-h-[calc(100svh-8rem)] flex-col justify-between gap-8 p-6">
                <div className="flex flex-col gap-7">
                  <div className="flex flex-col gap-3 pt-2">
                    <p className="max-w-[11ch] text-[2.15rem] font-semibold leading-[1.05] text-[var(--coach-ink)]">스쿼트 몇 개 할까요?</p>
                    <div className="h-1 w-12 rounded-full bg-[var(--coach-accent)]" aria-hidden="true" />
                  </div>

                  <div className="coach-target-panel flex min-h-[228px] flex-col items-center justify-center rounded-[1.5rem] px-6 text-center">
                    <div className="flex items-end justify-center gap-2 text-[7.75rem] font-semibold leading-none text-[var(--coach-ink)]">
                      {isGoalValid ? normalizedGoal : "--"}
                      <span className="pb-4 text-2xl font-semibold text-[var(--coach-soft-ink)]">회</span>
                    </div>
                  </div>

                  <FieldGroup>
                    <Field data-invalid={!isGoalValid}>
                      <FieldLabel htmlFor="squat-goal">목표 개수</FieldLabel>
                      <Input
                        id="squat-goal"
                        className="h-14 rounded-2xl text-lg"
                        inputMode="numeric"
                        min={1}
                        max={999}
                        pattern="[0-9]*"
                        type="number"
                        value={goalInput}
                        aria-invalid={!isGoalValid}
                        onChange={(event) => setGoalInput(event.target.value)}
                      />
                    </Field>
                  </FieldGroup>
                </div>

                <Button type="button" size="lg" className="h-14 rounded-full" onClick={startWorkout} disabled={!isGoalValid}>
                  시작하기
                  <CheckIcon data-icon="inline-end" />
                </Button>
              </div>
            )}

            {phase === "countdown" && (
              <div className="relative flex min-h-[calc(100svh-8rem)] flex-col justify-between gap-6 p-6">
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" onClick={() => setPhase("setup")}>
                    취소
                  </Button>
                </div>

                <div className="flex flex-1 flex-col items-center justify-center gap-9 text-center">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Get Ready</p>
                    <h2 className="mt-3 text-3xl font-semibold leading-tight text-[var(--coach-ink)]">자세를 잡아주세요</h2>
                  </div>

                  <div className="grid aspect-square w-full max-w-[300px] place-items-center rounded-full bg-[var(--coach-surface)]" aria-live="assertive">
                    <div className="countdown-pulse grid size-[78%] place-items-center rounded-full border border-[var(--coach-line)] bg-[var(--coach-panel)]">
                      <p className="text-[5.5rem] font-semibold leading-none text-[var(--coach-ink)]">{countdownValue === 0 ? "Go" : countdownValue}</p>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm font-medium text-[var(--coach-ink)]">곧 시작합니다</p>
                    <p className="max-w-xs text-sm text-muted-foreground">폰을 가슴 앞에 들고 발을 어깨너비로 맞춰주세요.</p>
                  </div>
                </div>

                <Button type="button" variant="outline" className="h-14 rounded-full" onClick={() => setPhase("active")}>
                  바로 시작
                </Button>
              </div>
            )}

            {phase === "active" && (
              <div className="flex min-h-[calc(100svh-8rem)] flex-col justify-between gap-6 p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-2xl font-semibold leading-none text-[var(--coach-ink)]">스쿼트 수행</p>
                  </div>
                  <Badge variant="secondary">{elapsedTimeText}</Badge>
                </div>

                <div className="flex flex-1 flex-col items-center justify-center gap-7">
                  <div
                    className="progress-ring grid aspect-square w-full max-w-[300px] place-items-center rounded-full"
                    style={{ "--progress": `${progress}%` } as React.CSSProperties}
                  >
                    <div className="grid size-[78%] place-items-center rounded-full bg-[var(--coach-panel)] text-center">
                      <div>
                        <p className="text-[6rem] font-semibold leading-none text-[var(--coach-ink)]">{count}</p>
                        <p className="mt-2 text-sm text-muted-foreground">/ {goal} reps</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-2xl bg-[var(--coach-surface)] p-4">
                    <p className="text-xs text-muted-foreground">목표</p>
                    <p className="mt-1 text-xl font-semibold text-[var(--coach-ink)]">{goal}</p>
                  </div>
                  <div className="rounded-2xl bg-[var(--coach-surface)] p-4">
                    <p className="text-xs text-muted-foreground">진행</p>
                    <p className="mt-1 text-xl font-semibold text-[var(--coach-ink)]">{progress}%</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button type="button" variant="outline" className="rounded-full" onClick={connectMotionSensor} disabled={sensorStatus === "listening" || count >= goal}>
                    <ActivityIcon data-icon="inline-start" />
                    센서
                  </Button>
                  <Button type="button" className="rounded-full" onClick={() => addSquat()} disabled={count >= goal}>
                    수동 +1
                  </Button>
                  <Button type="button" variant="ghost" className="rounded-full" onClick={() => setPhase("setup")}>
                    목표 변경
                  </Button>
                  <Button type="button" variant="outline" className="rounded-full" onClick={() => setPhase("complete")}>
                    종료
                  </Button>
                </div>
              </div>
            )}

            {phase === "complete" && (
              <div className="flex min-h-[calc(100svh-8rem)] flex-col justify-between gap-7 p-6">
                <div className="flex flex-1 flex-col items-center justify-center gap-7 text-center">
                  <div
                    className="progress-ring grid aspect-square w-full max-w-[280px] place-items-center rounded-full"
                    style={{ "--progress": `${progress}%` } as React.CSSProperties}
                  >
                    <div className="grid size-[78%] place-items-center rounded-full bg-[var(--coach-panel)]">
                      <CheckIcon className="size-16 text-[var(--coach-accent)]" aria-hidden="true" />
                    </div>
                  </div>
                  <div>
                    <h2 className="text-5xl font-semibold leading-none text-[var(--coach-ink)]">{count}개 완료</h2>
                    <p className="mt-3 text-sm text-muted-foreground">목표 {goal}개 중 {progress}% 달성했어요.</p>
                  </div>
                </div>

                <div className="rounded-2xl bg-[var(--coach-surface)] p-5">
                  <p className="text-4xl font-semibold text-[var(--coach-ink)]">{count} / {goal}</p>
                  <p className="mt-2 text-sm text-muted-foreground">달성률 {progress}% · 운동 시간 {elapsedTimeText}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button type="button" variant="outline" className="rounded-full" onClick={startWorkout}>
                    <RotateCcwIcon data-icon="inline-start" />
                    다시 하기
                  </Button>
                  <Button type="button" className="rounded-full" onClick={shareResult}>
                    <Share2Icon data-icon="inline-start" />
                    공유
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

interface DeviceMotionEventConstructorWithPermission {
  new (type: string, eventInitDict?: DeviceMotionEventInit): DeviceMotionEvent;
  requestPermission?: () => Promise<"granted" | "denied">;
}

interface DeviceOrientationEventConstructorWithPermission {
  new (type: string, eventInitDict?: DeviceOrientationEventInit): DeviceOrientationEvent;
  requestPermission?: () => Promise<"granted" | "denied">;
}