"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIcon,
  CheckIcon,
  MedalIcon,
  RotateCcwIcon,
  Share2Icon,
  SmartphoneIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type WorkoutPhase = "setup" | "countdown" | "active" | "complete";
type SensorStatus = "idle" | "listening" | "unsupported" | "blocked";
type MotionStage = "steady" | "descending" | "bottom" | "rising";
type SquatMotionState = "standing" | "down" | "rising";

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

function BunnyCoach({ pose }: { pose: "ready" | "squat" | "cheer" }) {
  return (
    <div className={cn("bunny-stage", pose === "squat" && "is-squat", pose === "cheer" && "is-cheer")}>
      <div className="bunny-floor-line" />
      <div className="bunny-shadow" />
      <div className="bunny-ear bunny-ear-left" />
      <div className="bunny-ear bunny-ear-right" />
      <div className="bunny-head">
        <div className="bunny-brow bunny-brow-left" />
        <div className="bunny-brow bunny-brow-right" />
        <div className="bunny-eye bunny-eye-left" />
        <div className="bunny-eye bunny-eye-right" />
        <div className="bunny-nose" />
        <div className="bunny-mouth" />
      </div>
      <div className="bunny-body">
        <div className="bunny-vest-panel" />
        <div className="bunny-core-line" />
      </div>
      <div className="bunny-arm bunny-arm-left" />
      <div className="bunny-arm bunny-arm-right" />
      <div className="bunny-leg bunny-leg-left" />
      <div className="bunny-leg bunny-leg-right" />
    </div>
  );
}

export function SquatCoachApp() {
  const [goal, setGoal] = useState(30);
  const [goalInput, setGoalInput] = useState("30");
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<WorkoutPhase>("setup");
  const [lastMove, setLastMove] = useState<"ready" | "squat" | "cheer">("ready");
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>("idle");
  const [motionLevel, setMotionLevel] = useState(0);
  const [motionStage, setMotionStage] = useState<MotionStage>("steady");
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
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
  const lastRepAtRef = useRef(0);
  const listenerAttachedRef = useRef(false);
  const workoutStartedAtRef = useRef<number | null>(null);

  const progress = Math.min(100, Math.round((count / goal) * 100));
  const remaining = Math.max(goal - count, 0);
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

    const now = event.timeStamp;

    if (motionStateRef.current === "standing" && motionScore > 2.4) {
      motionStateRef.current = "down";
      setMotionStage("descending");
      setLastMove("squat");
      return;
    }

    if (motionStateRef.current === "down" && motionScore > 3.2) {
      setMotionStage("bottom");
      return;
    }

    if (motionStateRef.current === "down" && motionScore < 1.6) {
      motionStateRef.current = "rising";
      setMotionStage("rising");
      return;
    }

    if (motionStateRef.current === "rising" && motionScore < 0.95 && now - lastRepAtRef.current > 900) {
      motionStateRef.current = "standing";
      setMotionStage("steady");
      lastRepAtRef.current = now;
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
    lastRepAtRef.current = 0;
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

  const phaseLabel = phase === "setup" ? "목표 설정" : phase === "countdown" ? "준비" : phase === "active" ? "운동 중" : "결과";
  const sensorMessage = sensorStatus === "listening"
    ? "센서 감지 준비 완료"
    : sensorStatus === "unsupported"
      ? "이 브라우저는 움직임 센서를 지원하지 않아요."
      : sensorStatus === "blocked"
        ? "센서 권한이 거부됐어요. 브라우저 설정에서 모션 권한을 확인해주세요."
        : "기기 센서 연결 전";
  const motionStageLabel = motionStage === "steady"
    ? "안정 자세"
    : motionStage === "descending"
      ? "내려가는 중"
      : motionStage === "bottom"
        ? "앉은 자세"
        : "올라오는 중";

  return (
    <main className="min-h-svh overflow-hidden bg-[var(--coach-bg)] text-foreground">
      <section className="mx-auto flex min-h-svh w-full max-w-md flex-col px-4 py-4 sm:py-6">
        <header className="flex items-center justify-between gap-3 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--coach-ink)] text-primary-foreground shadow-sm">
              <MedalIcon aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Squat Coach</h1>
            </div>
          </div>
          <Badge variant="secondary">{phaseLabel}</Badge>
        </header>

        <div className="flex flex-1 items-stretch pb-4">
          <section className="app-screen relative flex w-full flex-col overflow-hidden rounded-lg border border-[var(--coach-line)] bg-[var(--coach-panel)] shadow-sm">
            {phase === "setup" && (
              <div className="flex min-h-[calc(100svh-7.5rem)] flex-col justify-between gap-8 p-5 sm:p-6">
                <div className="flex flex-col gap-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-2">
                      <Badge variant="outline">STEP 1</Badge>
                      <p className="text-4xl font-black leading-[1.02] text-[var(--coach-ink)]">오늘 몇 개 할까요?</p>
                    </div>
                    <Badge variant="secondary">
                      <SmartphoneIcon aria-hidden="true" />
                      앱 모드
                    </Badge>
                  </div>

                  <div className="relative flex min-h-[240px] items-end justify-center rounded-lg bg-muted/60 pt-6">
                    <BunnyCoach pose="ready" />
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle>목표 설정</CardTitle>
                      <CardDescription>1개부터 999개까지 직접 입력할 수 있어요.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <Field data-invalid={!isGoalValid}>
                          <FieldLabel htmlFor="squat-goal">목표 개수</FieldLabel>
                          <Input
                            id="squat-goal"
                            inputMode="numeric"
                            min={1}
                            max={999}
                            pattern="[0-9]*"
                            type="number"
                            value={goalInput}
                            aria-invalid={!isGoalValid}
                            onChange={(event) => setGoalInput(event.target.value)}
                          />
                          <FieldDescription>목표를 정하면 바로 3-2-1 카운트다운이 시작돼요.</FieldDescription>
                        </Field>
                      </FieldGroup>
                    </CardContent>
                  </Card>
                </div>

                <Button type="button" size="lg" onClick={startWorkout} disabled={!isGoalValid}>
                  시작하기
                  <CheckIcon data-icon="inline-end" />
                </Button>
              </div>
            )}

            {phase === "countdown" && (
              <div className="relative flex min-h-[calc(100svh-7.5rem)] flex-col justify-between gap-6 p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline">STEP 2</Badge>
                  <Button type="button" variant="ghost" onClick={() => setPhase("setup")}>
                    취소
                  </Button>
                </div>

                <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Get Ready</p>
                    <h2 className="mt-3 text-4xl font-black leading-none text-[var(--coach-ink)]">자세를 잡아주세요</h2>
                  </div>

                  <div className="relative flex min-h-[280px] w-full items-end justify-center rounded-lg bg-muted/60">
                    <BunnyCoach pose="ready" />
                    <div className="countdown-overlay" aria-live="assertive">
                      <p className="countdown-label">곧 시작합니다</p>
                      <p className="countdown-number">{countdownValue === 0 ? "START" : countdownValue}</p>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-3">
                    <Badge variant={sensorStatus === "listening" ? "secondary" : "outline"}>{sensorMessage}</Badge>
                    <p className="max-w-xs text-sm text-muted-foreground">폰을 가슴 앞에 들고, 발은 어깨너비로 둔 상태에서 시작해요.</p>
                  </div>
                </div>

                <Button type="button" variant="outline" onClick={() => setPhase("active")}>
                  바로 시작
                </Button>
              </div>
            )}

            {phase === "active" && (
              <div className="flex min-h-[calc(100svh-7.5rem)] flex-col justify-between gap-5 p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-2">
                    <Badge variant="outline">STEP 3</Badge>
                    <p className="text-3xl font-black leading-none text-[var(--coach-ink)]">스쿼트 수행</p>
                  </div>
                  <div className="rounded-lg border border-[var(--coach-line)] bg-background px-4 py-3 text-right">
                    <p className="text-xs font-semibold text-muted-foreground">COUNT</p>
                    <p className="text-5xl font-black text-[var(--coach-accent)]">{count}</p>
                  </div>
                </div>

                <div className="relative flex min-h-[250px] flex-1 items-end justify-center rounded-lg bg-muted/60">
                  <BunnyCoach pose={lastMove} />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-[var(--coach-line)] bg-background p-3">
                    <p className="text-xs font-semibold text-muted-foreground">목표</p>
                    <p className="text-2xl font-black">{goal}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--coach-line)] bg-background p-3">
                    <p className="text-xs font-semibold text-muted-foreground">남음</p>
                    <p className="text-2xl font-black">{remaining}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--coach-line)] bg-background p-3">
                    <p className="text-xs font-semibold text-muted-foreground">시간</p>
                    <p className="text-2xl font-black">{elapsedTimeText}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 rounded-lg bg-muted p-4">
                  <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                    <span>{isCalibrating ? "기준 자세 측정" : motionStageLabel}</span>
                    <Badge variant="secondary">{isCalibrating ? `${calibrationProgress}%` : `${motionLevel}%`}</Badge>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-background/70">
                    <div
                      className="h-full rounded-full bg-[var(--coach-accent)] transition-all duration-200"
                      style={{ width: `${isCalibrating ? calibrationProgress : motionLevel}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">{sensorMessage}</p>
                </div>

                <div className="h-3 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-[var(--coach-accent)] transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button type="button" variant="outline" onClick={connectMotionSensor} disabled={sensorStatus === "listening" || count >= goal}>
                    <ActivityIcon data-icon="inline-start" />
                    센서
                  </Button>
                  <Button type="button" onClick={() => addSquat()} disabled={count >= goal}>
                    수동 +1
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setPhase("setup")}>
                    목표 변경
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setPhase("complete")}>
                    종료
                  </Button>
                </div>
              </div>
            )}

            {phase === "complete" && (
              <div className="flex min-h-[calc(100svh-7.5rem)] flex-col justify-between gap-7 p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline">STEP 4</Badge>
                  <Badge variant="secondary">목표 {progress >= 100 ? "달성" : "기록 저장"}</Badge>
                </div>

                <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
                  <div className="relative flex min-h-[250px] w-full items-end justify-center rounded-lg bg-muted/60">
                    <BunnyCoach pose="cheer" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Result</p>
                    <h2 className="mt-3 text-5xl font-black leading-none text-[var(--coach-ink)]">{count}개 완료</h2>
                    <p className="mt-3 text-sm text-muted-foreground">목표 {goal}개 중 {progress}% 달성했어요.</p>
                  </div>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>오늘의 기록</CardTitle>
                    <CardDescription>운동 시간 {elapsedTimeText} · 남은 개수 {remaining}개</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-lg bg-[var(--coach-ink)] p-5 text-primary-foreground">
                      <p className="text-sm opacity-80">Squat Coach Result</p>
                      <p className="mt-3 text-4xl font-black">{count} / {goal}</p>
                      <p className="mt-2 text-sm opacity-80">달성률 {progress}% · 운동 시간 {elapsedTimeText}</p>
                    </div>
                  </CardContent>
                  <CardFooter className="grid grid-cols-2 gap-3">
                    <Button type="button" variant="outline" onClick={startWorkout}>
                      <RotateCcwIcon data-icon="inline-start" />
                      다시 하기
                    </Button>
                    <Button type="button" onClick={shareResult}>
                      <Share2Icon data-icon="inline-start" />
                      공유
                    </Button>
                  </CardFooter>
                </Card>
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