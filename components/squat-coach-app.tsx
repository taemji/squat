"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIcon,
  CalendarCheckIcon,
  CheckIcon,
  FlameIcon,
  RotateCcwIcon,
  Share2Icon,
  UserRoundIcon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  averageMotionVector,
  createPhoneMotionTracker,
  createSquatMotionProfile,
  evaluateSquatMotion,
  measurePhoneMotion,
  type MotionStage,
  type MotionVector,
  type PhoneMotionTracker,
  type SquatMotionProfile,
  type SquatMotionState,
} from "@/lib/squat-motion";
import { SQUAT_USERS, getSquatUserName, isSquatUserId, type SquatUserId } from "@/lib/squat-users";
import { generateShareImage } from "@/lib/share-image";
import { getLocalIsoDate, getMonthCalendarDays } from "@/lib/workout-summary";

type WorkoutPhase = "setup" | "countdown" | "active" | "complete";
type SensorStatus = "idle" | "probing" | "listening" | "unsupported" | "blocked" | "unavailable";
type SummaryStatus = "idle" | "loading" | "ready" | "error";
type UserTotalsStatus = "idle" | "loading" | "ready" | "error";
type SaveStatus = "idle" | "saving" | "saved" | "error";

interface WorkoutSummary {
  completionDates: string[];
  currentStreak: number;
  todayCompleted: boolean;
  totalDays: number;
  totalReps: number;
}

interface UserTotalSummary {
  userId: SquatUserId;
  userName: string;
  totalReps: number;
}

const squatUserStorageKey = "squatUserId";
const sensorProbeTimeoutMs = 1800;

const emptyWorkoutSummary: WorkoutSummary = {
  completionDates: [],
  currentStreak: 0,
  todayCompleted: false,
  totalDays: 0,
  totalReps: 0,
};

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

function getSensorButtonLabel(status: SensorStatus) {
  if (status === "listening") {
    return "센서 연결됨";
  }

  if (status === "probing") {
    return "센서 확인 중";
  }

  if (status === "blocked") {
    return "센서 권한 필요";
  }

  if (status === "unsupported") {
    return "센서 미지원";
  }

  return "센서 켜기";
}

function getSensorAlertTitle(status: SensorStatus) {
  if (status === "unsupported") {
    return "센서를 사용할 수 없어요";
  }

  if (status === "unavailable") {
    return "센서 신호가 없어요";
  }

  return "센서 권한이 필요해요";
}

function getSensorAlertDescription(status: SensorStatus) {
  if (status === "unsupported") {
    return "이 브라우저나 기기에서는 모션 센서를 지원하지 않습니다. 수동 +1 버튼으로 기록해 주세요.";
  }

  if (status === "unavailable") {
    return "센서 권한은 요청했지만 실제 모션 신호가 들어오지 않았습니다. 휴대폰에서 HTTPS 주소로 접속했는지 확인한 뒤 다시 확인해 주세요.";
  }

  return "권한 요청을 취소하거나 거부하면 브라우저가 거부 상태를 저장할 수 있습니다. 브라우저의 사이트 설정에서 모션 센서 권한을 허용하거나 권한을 초기화한 뒤 다시 접속해 주세요.";
}

function normalizeAccelerationValue(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function canRetrySensorFromAlert(status: SensorStatus) {
  return status === "unavailable";
}

function getSensorRetryLabel(status: SensorStatus) {
  return status === "unavailable" ? "다시 확인" : "다시 요청";
}

function getSensorButtonClass(status: SensorStatus) {
  if (status === "listening") {
    return "border-emerald-500 text-emerald-700 shadow-[0_0_0_3px_rgba(16,185,129,0.16)] motion-safe:animate-pulse";
  }

  return "border-destructive/60 text-destructive";
}

export function SquatCoachApp() {
  const [selectedUserId, setSelectedUserId] = useState<SquatUserId>("jooyoung");
  const [workoutSummary, setWorkoutSummary] = useState<WorkoutSummary>(emptyWorkoutSummary);
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatus>("idle");
  const [userTotals, setUserTotals] = useState<UserTotalSummary[]>([]);
  const [userTotalsStatus, setUserTotalsStatus] = useState<UserTotalsStatus>("idle");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [goal, setGoal] = useState(100);
  const [goalInput, setGoalInput] = useState("100");
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<WorkoutPhase>("setup");
  const [, setLastMove] = useState<"ready" | "squat" | "cheer">("ready");
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>("idle");
  const [sensorAlertOpen, setSensorAlertOpen] = useState(false);
  const [, setMotionLevel] = useState(0);
  const [, setMotionStage] = useState<MotionStage>("steady");
  const [, setIsCalibrating] = useState(false);
  const [, setCalibrationProgress] = useState(0);
  const [countdownValue, setCountdownValue] = useState<3 | 2 | 1 | 0>(3);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const gravityBaselineRef = useRef<MotionVector | null>(null);
  const calibrationSamplesRef = useRef<MotionVector[]>([]);
  const calibrationUntilRef = useRef(0);
  const isCalibratingRef = useRef(false);
  const phoneMotionTrackerRef = useRef<PhoneMotionTracker>(createPhoneMotionTracker());
  const activeGoalRef = useRef(goal);
  const motionStateRef = useRef<SquatMotionState>("standing");
  const motionProfileRef = useRef<SquatMotionProfile>(createSquatMotionProfile());
  const listenerAttachedRef = useRef(false);
  const sensorProbeTimeoutRef = useRef<number | null>(null);
  const hasReceivedMotionSampleRef = useRef(false);
  const workoutStartedAtRef = useRef<number | null>(null);
  const lastSavedCompletionRef = useRef<string | null>(null);

  const todayIsoDate = useMemo(() => getLocalIsoDate(), []);
  const calendarDays = useMemo(() => getMonthCalendarDays(todayIsoDate.slice(0, 7)), [todayIsoDate]);
  const completedDateSet = useMemo(() => new Set(workoutSummary.completionDates), [workoutSummary.completionDates]);
  const userTotalById = useMemo(() => new Map(userTotals.map((userTotal) => [userTotal.userId, userTotal])), [userTotals]);
  const maxUserTotalReps = useMemo(() => Math.max(1, ...userTotals.map((userTotal) => userTotal.totalReps)), [userTotals]);
  const selectedUserName = getSquatUserName(selectedUserId);
  const currentMonthLabel = `${Number(todayIsoDate.slice(5, 7))}월`;
  const progress = Math.min(100, Math.round((count / goal) * 100));
  const elapsedTimeText = formatDuration(elapsedSeconds);
  const normalizedGoal = Number(goalInput);
  const isGoalValid = Number.isInteger(normalizedGoal) && normalizedGoal >= 1 && normalizedGoal <= 999;
  const resultText = useMemo(
    () => `오늘 스쿼트 ${count}개 완료! 목표 ${goal}개 중 ${progress}% 달성했어요. 운동 시간 ${elapsedTimeText}.`,
    [count, elapsedTimeText, goal, progress]
  );

  const loadWorkoutSummary = useCallback(async (userId: SquatUserId) => {
    setSummaryStatus("loading");

    try {
      const response = await fetch(`/api/workouts/summary?userId=${userId}&today=${todayIsoDate}`);

      if (!response.ok) {
        throw new Error("Failed to load workout summary.");
      }

      const summary = await response.json() as WorkoutSummary;
      setWorkoutSummary({ ...emptyWorkoutSummary, ...summary });
      setSummaryStatus("ready");
    } catch {
      setWorkoutSummary(emptyWorkoutSummary);
      setSummaryStatus("error");
    }
  }, [todayIsoDate]);

  const loadUserTotals = useCallback(async () => {
    setUserTotalsStatus("loading");

    try {
      const response = await fetch("/api/workouts/totals");

      if (!response.ok) {
        throw new Error("Failed to load workout totals.");
      }

      const summary = await response.json() as { userTotals?: UserTotalSummary[] };
      setUserTotals(summary.userTotals ?? []);
      setUserTotalsStatus("ready");
    } catch {
      setUserTotals([]);
      setUserTotalsStatus("error");
    }
  }, []);

  const saveWorkoutCompletion = useCallback(async () => {
    setSaveStatus("saving");

    try {
      const response = await fetch("/api/workouts/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserId,
          workoutDate: todayIsoDate,
          goal,
          count,
          elapsedSeconds,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save workout completion.");
      }

      const summary = await response.json() as Partial<WorkoutSummary>;
      setWorkoutSummary((currentSummary) => ({ ...currentSummary, ...summary, todayCompleted: true }));
      setSaveStatus("saved");
      await loadWorkoutSummary(selectedUserId);
      await loadUserTotals();
    } catch {
      setSaveStatus("error");
    }
  }, [count, elapsedSeconds, goal, loadUserTotals, loadWorkoutSummary, selectedUserId, todayIsoDate]);

  useEffect(() => {
    void loadUserTotals();
  }, [loadUserTotals]);

  useEffect(() => {
    const storedUserId = window.localStorage.getItem(squatUserStorageKey);

    if (isSquatUserId(storedUserId)) {
      setSelectedUserId(storedUserId);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(squatUserStorageKey, selectedUserId);
    setSaveStatus("idle");
    void loadWorkoutSummary(selectedUserId);
  }, [loadWorkoutSummary, selectedUserId]);

  useEffect(() => {
    if (phase !== "complete" || count <= 0) {
      return;
    }

    const completionKey = `${selectedUserId}:${todayIsoDate}:${goal}:${count}:${elapsedSeconds}`;

    if (lastSavedCompletionRef.current === completionKey) {
      return;
    }

    lastSavedCompletionRef.current = completionKey;
    void saveWorkoutCompletion();
  }, [count, elapsedSeconds, goal, phase, saveWorkoutCompletion, selectedUserId, todayIsoDate]);

  const clearSensorProbeTimeout = useCallback(() => {
    if (sensorProbeTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(sensorProbeTimeoutRef.current);
    sensorProbeTimeoutRef.current = null;
  }, []);

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

  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    const acceleration = event.accelerationIncludingGravity ?? event.acceleration;

    if (!acceleration) {
      return;
    }

    const hasAccelerationValue = [acceleration.x, acceleration.y, acceleration.z].some(
      (value) => typeof value === "number" && Number.isFinite(value)
    );

    if (!hasAccelerationValue) {
      return;
    }

    if (!hasReceivedMotionSampleRef.current) {
      hasReceivedMotionSampleRef.current = true;
      clearSensorProbeTimeout();
      setSensorStatus("listening");
    }

    const x = normalizeAccelerationValue(acceleration.x);
    const y = normalizeAccelerationValue(acceleration.y);
    const z = normalizeAccelerationValue(acceleration.z);
    const vector = { x, y, z };

    if (isCalibratingRef.current || (calibrationUntilRef.current > 0 && calibrationUntilRef.current > event.timeStamp)) {
      if (calibrationUntilRef.current <= 0) {
        calibrationUntilRef.current = event.timeStamp + 2500;
      }

      calibrationSamplesRef.current.push(vector);
      const remainingMs = Math.max(calibrationUntilRef.current - event.timeStamp, 0);
      setCalibrationProgress(Math.min(100, Math.round(((2500 - remainingMs) / 2500) * 100)));

      if (remainingMs === 0) {
        const samples = calibrationSamplesRef.current;
        gravityBaselineRef.current = averageMotionVector(samples);
        phoneMotionTrackerRef.current = createPhoneMotionTracker(gravityBaselineRef.current);
        isCalibratingRef.current = false;
        setIsCalibrating(false);
        setCalibrationProgress(100);
        setMotionStage("steady");
        speakText("기준 자세 측정 완료. 시작하세요.");
      }

      return;
    }

    if (!gravityBaselineRef.current) {
      gravityBaselineRef.current = vector;
      phoneMotionTrackerRef.current = createPhoneMotionTracker(vector);
      return;
    }

    const measuredMotion = measurePhoneMotion(phoneMotionTrackerRef.current, vector, event.timeStamp);
    phoneMotionTrackerRef.current = measuredMotion.tracker;

    setMotionLevel(Math.min(100, Math.round(measuredMotion.sample.score * 28)));

    const nextMotion = evaluateSquatMotion(motionStateRef.current, measuredMotion.sample, motionProfileRef.current);

    if (nextMotion.state !== motionStateRef.current && nextMotion.state === "down") {
      setLastMove("squat");
    }

    motionStateRef.current = nextMotion.state;
    motionProfileRef.current = nextMotion.profile;
    setMotionStage(nextMotion.stage);

    if (nextMotion.completedRep) {
      addSquat("sensor");
    }
  }, [addSquat, clearSensorProbeTimeout]);

  const connectMotionSensor = useCallback(async (showSignalAlert = false) => {
    clearSensorProbeTimeout();
    hasReceivedMotionSampleRef.current = false;

    if (!("DeviceMotionEvent" in window)) {
      setSensorStatus("unsupported");
      setSensorAlertOpen(true);
      return;
    }

    try {
      const DeviceMotion = window.DeviceMotionEvent as DeviceMotionEventConstructorWithPermission;

      if (typeof DeviceMotion.requestPermission === "function") {
        const permission = await DeviceMotion.requestPermission();

        if (permission !== "granted") {
          setSensorStatus("blocked");
          setSensorAlertOpen(true);
          return;
        }
      }

      if (!listenerAttachedRef.current) {
        window.addEventListener("devicemotion", handleMotion, { passive: true });
        listenerAttachedRef.current = true;
      }

      setSensorStatus("probing");
      sensorProbeTimeoutRef.current = window.setTimeout(() => {
        sensorProbeTimeoutRef.current = null;

        if (hasReceivedMotionSampleRef.current) {
          return;
        }

        setSensorStatus("unavailable");

        if (showSignalAlert) {
          setSensorAlertOpen(true);
        }
      }, sensorProbeTimeoutMs);
    } catch {
      setSensorStatus("blocked");
      setSensorAlertOpen(true);
    }
  }, [clearSensorProbeTimeout, handleMotion]);

  const handleSensorButtonClick = useCallback(async () => {
    if (sensorStatus === "listening") {
      return;
    }

    if (sensorStatus === "unsupported") {
      setSensorAlertOpen(true);
      return;
    }

    await connectMotionSensor(true);
  }, [connectMotionSensor, sensorStatus]);

  const handleSensorAlertRetry = useCallback(() => {
    setSensorAlertOpen(false);
    void connectMotionSensor(true);
  }, [connectMotionSensor]);

  const startWorkout = useCallback(async () => {
    if (!isGoalValid) {
      return;
    }

    setGoal(normalizedGoal);
    activeGoalRef.current = normalizedGoal;
    setCount(0);
    setSaveStatus("idle");
    lastSavedCompletionRef.current = null;
    setPhase("countdown");
    setLastMove("ready");
    setMotionStage("steady");
    setMotionLevel(0);
    gravityBaselineRef.current = null;
    calibrationSamplesRef.current = [];
    calibrationUntilRef.current = 0;
    isCalibratingRef.current = true;
    phoneMotionTrackerRef.current = createPhoneMotionTracker();
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
      clearSensorProbeTimeout();
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [clearSensorProbeTimeout, handleMotion]);

  async function shareResult() {
    try {
      // 칼로리 계산 (반복수 × 0.6 kcal)
      const calories = Math.round(count * 0.6 * 10) / 10;

      // 공유 이미지 생성
      const shareImageBlob = await generateShareImage({
        todayReps: count,
        todayTime: elapsedSeconds,
        calories: calories,
        totalDays: workoutSummary.totalDays,
        totalReps: workoutSummary.totalReps,
      });

      const shareImageFile = new File([shareImageBlob], "squat-coach-record.png", {
        type: shareImageBlob.type || "image/png",
      });

      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [shareImageFile] }))) {
        await navigator.share({
          title: "Squat Coach 기록",
          files: [shareImageFile],
        });
        return;
      }

      if (navigator.share) {
        await navigator.share({ title: "Squat Coach 기록", text: resultText });
        return;
      }

      // Web Share API 없으면 다운로드
      const url = URL.createObjectURL(shareImageBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `squat-coach-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Share failed:", error);
    }
  }

  return (
    <main className="coach-shell min-h-svh text-foreground">
      <section className="mx-auto flex min-h-svh w-full max-w-[430px] flex-col px-5 py-5">
        <header className="flex justify-center pb-5 pt-1 text-center">
          <div className="flex flex-col items-center gap-2">
            <h1 className="coach-wordmark" aria-label="Squat Coach">
              <span aria-hidden="true" className="coach-wordmark-main">Squat</span>
              <span aria-hidden="true" className="coach-wordmark-accent">Coach</span>
            </h1>
            <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1">
              <UserRoundIcon className="size-3.5" aria-hidden="true" />
              {selectedUserName}
            </Badge>
          </div>
        </header>

        <div className="pb-3">
          <section className="coach-card flex w-full flex-col rounded-[2rem] border border-[var(--coach-line)] bg-[var(--coach-panel)]">
            {phase === "setup" && (
              <div className="flex flex-col gap-8 p-6">
                <div className="flex flex-col gap-7">
                  <div className="flex flex-col gap-3 pt-2">
                    <p className="max-w-[11ch] text-[2.15rem] font-semibold leading-[1.05] text-[var(--coach-ink)]">스쿼트 몇 개 할까요?</p>
                    <div className="h-1 w-12 rounded-full bg-[var(--coach-accent)]" aria-hidden="true" />
                  </div>

                  <div className="grid grid-cols-3 gap-2" aria-label="사용자 선택">
                    {SQUAT_USERS.map((user) => (
                      <Button
                        key={user.id}
                        type="button"
                        variant={selectedUserId === user.id ? "default" : "outline"}
                        className="h-11 rounded-full px-2"
                        onClick={() => setSelectedUserId(user.id)}
                      >
                        {user.name}
                      </Button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-2xl bg-[var(--coach-surface)] p-4">
                      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarCheckIcon className="size-3.5" aria-hidden="true" />
                        오늘
                      </div>
                      <p className="mt-1 text-lg font-semibold text-[var(--coach-ink)]">
                        {workoutSummary.todayCompleted ? "완료" : "아직"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[var(--coach-surface)] p-4">
                      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                        <FlameIcon className="size-3.5" aria-hidden="true" />
                        연속
                      </div>
                      <p className="mt-1 text-lg font-semibold text-[var(--coach-ink)]">{workoutSummary.currentStreak}일</p>
                    </div>
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

                  <div className="rounded-2xl bg-[var(--coach-surface)] p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-[var(--coach-ink)]">{currentMonthLabel} 완료</p>
                      <p className="text-xs text-muted-foreground">
                        {summaryStatus === "loading" ? "불러오는 중" : `${workoutSummary.totalDays}일`}
                      </p>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-[0.68rem] font-medium text-muted-foreground">
                      {["일", "월", "화", "수", "목", "금", "토"].map((weekday) => (
                        <span key={weekday}>{weekday}</span>
                      ))}
                    </div>
                    <div className="mt-2 grid grid-cols-7 gap-1">
                      {calendarDays.map((day, index) => {
                        const isCompleted = day !== null && completedDateSet.has(day);
                        const isToday = day === todayIsoDate;

                        return (
                          <div
                            key={day ?? `empty-${index}`}
                            className={`grid aspect-square place-items-center rounded-full text-xs font-semibold ${
                              isCompleted
                                ? "bg-[var(--coach-accent)] text-white"
                                : isToday
                                  ? "border border-[var(--coach-accent)] text-[var(--coach-ink)]"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {day ? Number(day.slice(8, 10)) : ""}
                          </div>
                        );
                      })}
                    </div>
                    {summaryStatus === "error" && (
                      <p className="mt-3 text-xs text-muted-foreground">Vercel DB 환경변수를 연결하면 기록이 저장됩니다.</p>
                    )}
                  </div>

                  <div className="rounded-2xl bg-[var(--coach-surface)] p-4" aria-label="누적기록 차트">
                    <div className="mb-4 flex items-center justify-between">
                      <p className="text-sm font-semibold text-[var(--coach-ink)]">누적기록 차트</p>
                      <p className="text-xs text-muted-foreground">
                        {userTotalsStatus === "loading" ? "불러오는 중" : "전체"}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3">
                      {SQUAT_USERS.map((user) => {
                        const userTotal = userTotalById.get(user.id);
                        const totalReps = userTotal?.totalReps ?? 0;
                        const totalProgress = Math.round((totalReps / maxUserTotalReps) * 100);

                        return (
                          <div key={user.id} className="grid grid-cols-[3.25rem_1fr_3rem] items-center gap-2">
                            <p className="truncate text-sm font-semibold text-[var(--coach-ink)]">{user.name}</p>
                            <div className="h-4 overflow-hidden rounded-full bg-[var(--coach-panel)]" aria-label={`${user.name} 누적 ${totalReps}개`}>
                              <div className="h-full rounded-full bg-[var(--coach-accent)]" style={{ width: `${totalProgress}%` }} />
                            </div>
                            <p className="text-right text-sm font-semibold text-[var(--coach-ink)]">{totalReps}</p>
                          </div>
                        );
                      })}
                    </div>
                    {userTotalsStatus === "error" && (
                      <p className="mt-3 text-xs text-muted-foreground">DB 연결 후 유저별 누적 차트를 볼 수 있어요.</p>
                    )}
                  </div>
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
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className={`rounded-full ${getSensorButtonClass(sensorStatus)}`}
                      onClick={handleSensorButtonClick}
                      disabled={count >= goal}
                      aria-label={getSensorButtonLabel(sensorStatus)}
                      aria-pressed={sensorStatus === "listening"}
                    >
                      <ActivityIcon aria-hidden="true" />
                    </Button>
                    <Badge variant="secondary" className="h-8! min-w-14 rounded-full! px-3! text-sm! leading-none">
                      {elapsedTimeText}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-1 flex-col items-center justify-center gap-7">
                  <div
                    className="progress-ring grid aspect-square w-full max-w-[300px] place-items-center rounded-full"
                    style={{ "--progress": `${progress}%` } as React.CSSProperties}
                  >
                    <div className="grid size-[78%] place-items-center rounded-full bg-[var(--coach-panel)] text-center">
                      <div>
                        <p className="text-[6rem] font-semibold leading-none text-[var(--coach-ink)]">{count}</p>
                        <p className="mt-2 text-sm text-muted-foreground">{goal} reps</p>
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

                <div className="grid grid-cols-3 gap-3">
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

            <AlertDialog open={sensorAlertOpen} onOpenChange={setSensorAlertOpen}>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogMedia>
                    <ActivityIcon aria-hidden="true" />
                  </AlertDialogMedia>
                  <AlertDialogTitle>{getSensorAlertTitle(sensorStatus)}</AlertDialogTitle>
                  <AlertDialogDescription>{getSensorAlertDescription(sensorStatus)}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className={canRetrySensorFromAlert(sensorStatus) ? undefined : "group-data-[size=sm]/alert-dialog-content:grid-cols-1"}>
                  {canRetrySensorFromAlert(sensorStatus) ? (
                    <>
                      <AlertDialogCancel>닫기</AlertDialogCancel>
                      <Button type="button" onClick={handleSensorAlertRetry}>
                        {getSensorRetryLabel(sensorStatus)}
                      </Button>
                    </>
                  ) : (
                    <AlertDialogAction>확인</AlertDialogAction>
                  )}
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

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
                  <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-2xl bg-[var(--coach-panel)] p-3">
                      <p className="text-xs text-muted-foreground">연속 운동</p>
                      <p className="mt-1 text-xl font-semibold text-[var(--coach-ink)]">{workoutSummary.currentStreak}일</p>
                    </div>
                    <div className="rounded-2xl bg-[var(--coach-panel)] p-3">
                      <p className="text-xs text-muted-foreground">누적 완료</p>
                      <p className="mt-1 text-xl font-semibold text-[var(--coach-ink)]">{workoutSummary.totalDays}일</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {saveStatus === "saving" && "오늘 기록 저장 중"}
                    {saveStatus === "saved" && `${selectedUserName}님의 오늘 완료 기록을 저장했어요.`}
                    {saveStatus === "error" && "DB 연결 후 오늘 기록을 저장할 수 있어요."}
                  </p>
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
