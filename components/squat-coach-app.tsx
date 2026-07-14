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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { generateShareImage, type ShareImageBackground } from "@/lib/share-image";
import { getLocalIsoDate, getMonthCalendarDays } from "@/lib/workout-summary";

type WorkoutPhase = "setup" | "countdown" | "active" | "rest" | "complete";
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
const maxWorkoutSets = 20;
const maxRepsPerSet = 999;
const maxTotalGoal = 999;
const maxRestSeconds = 3600;

const shareBackgroundOptions: Array<{
  id: ShareImageBackground;
  label: string;
  imageSrc: string;
}> = [
  { id: "workout-bg", label: "workout-bg", imageSrc: "/workout-bg.png" },
  { id: "workout-bg2", label: "workout-bg2", imageSrc: "/workout-bg2" },
];

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

function speakMilestone(count: number, totalGoal: number) {
  const remaining = totalGoal - count;

  if (count >= totalGoal) {
    speakText(`목표 달성, ${totalGoal}개 완료!`);
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
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [setCountInput, setSetCountInput] = useState("4");
  const [repsPerSetInput, setRepsPerSetInput] = useState("30");
  const [restSecondsInput, setRestSecondsInput] = useState("60");
  const [workoutSetCount, setWorkoutSetCount] = useState(4);
  const [workoutRepsPerSet, setWorkoutRepsPerSet] = useState(30);
  const [workoutRestSeconds, setWorkoutRestSeconds] = useState(0);
  const [currentSet, setCurrentSet] = useState(1);
  const [setRepCount, setSetRepCount] = useState(0);
  const [restRemainingSeconds, setRestRemainingSeconds] = useState(0);
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<WorkoutPhase>("setup");
  const [, setLastMove] = useState<"ready" | "squat" | "cheer">("ready");
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>("idle");
  const [sensorAlertOpen, setSensorAlertOpen] = useState(false);
  const [motionLevel, setMotionLevel] = useState(0);
  const [motionStage, setMotionStage] = useState<MotionStage>("steady");
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [countdownValue, setCountdownValue] = useState<3 | 2 | 1 | 0>(3);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const gravityBaselineRef = useRef<MotionVector | null>(null);
  const calibrationSamplesRef = useRef<MotionVector[]>([]);
  const calibrationUntilRef = useRef(0);
  const isCalibratingRef = useRef(false);
  const phoneMotionTrackerRef = useRef<PhoneMotionTracker>(createPhoneMotionTracker());
  const activeGoalRef = useRef(120);
  const phaseRef = useRef<WorkoutPhase>("setup");
  const countRef = useRef(0);
  const workoutSetCountRef = useRef(4);
  const workoutRepsPerSetRef = useRef(30);
  const workoutRestSecondsRef = useRef(0);
  const currentSetRef = useRef(1);
  const setRepCountRef = useRef(0);
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
  const workoutGoal = workoutSetCount * workoutRepsPerSet;
  const progress = Math.min(100, Math.round((count / workoutGoal) * 100));
  const restProgress = workoutRestSeconds > 0
    ? Math.min(100, Math.round(((workoutRestSeconds - restRemainingSeconds) / workoutRestSeconds) * 100))
    : 100;
  const elapsedTimeText = formatDuration(elapsedSeconds);
  const restRemainingTimeText = formatDuration(restRemainingSeconds);
  const workoutRestTimeText = workoutRestSeconds > 0 ? formatDuration(workoutRestSeconds) : "없음";
  const normalizedSetCount = Number(setCountInput);
  const normalizedRepsPerSet = Number(repsPerSetInput);
  const normalizedRestSeconds = Number(restSecondsInput);
  const isSetCountValid = Number.isInteger(normalizedSetCount) && normalizedSetCount >= 1 && normalizedSetCount <= maxWorkoutSets;
  const isRepsPerSetValid = Number.isInteger(normalizedRepsPerSet) && normalizedRepsPerSet >= 1 && normalizedRepsPerSet <= maxRepsPerSet;
  const hasRestBetweenSets = isSetCountValid && normalizedSetCount > 1;
  const isRestSecondsValid = !hasRestBetweenSets || (Number.isInteger(normalizedRestSeconds) && normalizedRestSeconds >= 0 && normalizedRestSeconds <= maxRestSeconds);
  const normalizedGoal = normalizedSetCount * normalizedRepsPerSet;
  const isGoalValid = isSetCountValid && isRepsPerSetValid && isRestSecondsValid && normalizedGoal <= maxTotalGoal;
  const restSecondsDisplayValue = hasRestBetweenSets ? restSecondsInput : "0";
  const restTimeText = hasRestBetweenSets ? `휴식 ${normalizedRestSeconds}초` : "휴식 없음";
  const workoutPlanText = isGoalValid
    ? `${normalizedSetCount}세트 x ${normalizedRepsPerSet}개 · ${restTimeText}`
    : "입력을 확인해 주세요";
  const motionStageText = isCalibrating
    ? `기준 자세 측정 ${calibrationProgress}%`
    : sensorStatus === "listening"
      ? motionStage === "descending"
        ? "내려가는 중"
        : motionStage === "bottom"
          ? "바닥 확인"
          : motionStage === "rising"
            ? "올라오는 중"
            : "선 자세에서 시작하세요"
      : getSensorButtonLabel(sensorStatus);
  const resultText = useMemo(
    () => `오늘 스쿼트 ${count}개 완료! 목표 ${workoutGoal}개 중 ${progress}% 달성했어요. 운동 시간 ${elapsedTimeText}.`,
    [count, elapsedTimeText, progress, workoutGoal]
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
          setCount: workoutSetCount,
          repsPerSet: workoutRepsPerSet,
          restSeconds: workoutRestSeconds,
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
  }, [
    count,
    elapsedSeconds,
    loadUserTotals,
    loadWorkoutSummary,
    selectedUserId,
    todayIsoDate,
    workoutRepsPerSet,
    workoutRestSeconds,
    workoutSetCount,
  ]);

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
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    countRef.current = count;
  }, [count]);

  useEffect(() => {
    workoutSetCountRef.current = workoutSetCount;
  }, [workoutSetCount]);

  useEffect(() => {
    workoutRepsPerSetRef.current = workoutRepsPerSet;
  }, [workoutRepsPerSet]);

  useEffect(() => {
    workoutRestSecondsRef.current = workoutRestSeconds;
  }, [workoutRestSeconds]);

  useEffect(() => {
    currentSetRef.current = currentSet;
  }, [currentSet]);

  useEffect(() => {
    setRepCountRef.current = setRepCount;
  }, [setRepCount]);

  useEffect(() => {
    if (phase !== "complete" || count <= 0) {
      return;
    }

    const completionKey = `${selectedUserId}:${todayIsoDate}:${workoutGoal}:${count}:${elapsedSeconds}`;

    if (lastSavedCompletionRef.current === completionKey) {
      return;
    }

    lastSavedCompletionRef.current = completionKey;
    void saveWorkoutCompletion();
  }, [count, elapsedSeconds, phase, saveWorkoutCompletion, selectedUserId, todayIsoDate, workoutGoal]);

  const clearSensorProbeTimeout = useCallback(() => {
    if (sensorProbeTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(sensorProbeTimeoutRef.current);
    sensorProbeTimeoutRef.current = null;
  }, []);

  const addSquat = useCallback((source: "manual" | "sensor" = "manual") => {
    if (phaseRef.current !== "active") {
      return;
    }

    const currentGoal = activeGoalRef.current;
    const currentCount = countRef.current;
    const repsPerSet = workoutRepsPerSetRef.current;
    const totalSets = workoutSetCountRef.current;
    const restSeconds = workoutRestSecondsRef.current;
    const currentSetNumber = currentSetRef.current;
    const currentSetReps = setRepCountRef.current;

    if (currentCount >= currentGoal || currentSetReps >= repsPerSet) {
      return;
    }

    const nextCount = Math.min(currentCount + 1, currentGoal);
    const nextSetRepCount = Math.min(currentSetReps + 1, repsPerSet);

    countRef.current = nextCount;
    setRepCountRef.current = nextSetRepCount;

    setLastMove("squat");

    window.setTimeout(() => {
      setLastMove("cheer");
    }, source === "sensor" ? 120 : 160);

    setCount(nextCount);
    setSetRepCount(nextSetRepCount);
    playCountSound();
    speakMilestone(nextCount, currentGoal);

    if (nextSetRepCount >= repsPerSet) {
      window.setTimeout(() => {
        if (phaseRef.current !== "active") {
          return;
        }

        setLastMove("cheer");
        setMotionStage("steady");

        if (currentSetNumber >= totalSets || nextCount >= currentGoal) {
          phaseRef.current = "complete";
          setPhase("complete");
          return;
        }

        const nextSet = currentSetNumber + 1;
        currentSetRef.current = nextSet;
        setRepCountRef.current = 0;
        setCurrentSet(nextSet);
        setSetRepCount(0);

        if (restSeconds > 0) {
          phaseRef.current = "rest";
          setRestRemainingSeconds(restSeconds);
          setPhase("rest");
          speakText(`${currentSetNumber}세트 완료. 휴식하세요.`);
          return;
        }

        phaseRef.current = "active";
        setRestRemainingSeconds(0);
        setPhase("active");
        speakText(`${nextSet}세트 시작`);
      }, 450);
    }
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

    if (phaseRef.current !== "active") {
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
      isCalibratingRef.current = false;
      setIsCalibrating(false);
      setSensorStatus("unsupported");
      setSensorAlertOpen(true);
      return;
    }

    try {
      const DeviceMotion = window.DeviceMotionEvent as DeviceMotionEventConstructorWithPermission;

      if (typeof DeviceMotion.requestPermission === "function") {
        const permission = await DeviceMotion.requestPermission();

        if (permission !== "granted") {
          isCalibratingRef.current = false;
          setIsCalibrating(false);
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

        isCalibratingRef.current = false;
        setIsCalibrating(false);
        setSensorStatus("unavailable");

        if (showSignalAlert) {
          setSensorAlertOpen(true);
        }
      }, sensorProbeTimeoutMs);
    } catch {
      isCalibratingRef.current = false;
      setIsCalibrating(false);
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

    const nextGoal = normalizedGoal;
    const nextSetCount = normalizedSetCount;
    const nextRepsPerSet = normalizedRepsPerSet;
    const nextRestSeconds = hasRestBetweenSets ? normalizedRestSeconds : 0;

    setWorkoutSetCount(nextSetCount);
    setWorkoutRepsPerSet(nextRepsPerSet);
    setWorkoutRestSeconds(nextRestSeconds);
    setCurrentSet(1);
    setSetRepCount(0);
    setRestRemainingSeconds(0);
    activeGoalRef.current = nextGoal;
    countRef.current = 0;
    workoutSetCountRef.current = nextSetCount;
    workoutRepsPerSetRef.current = nextRepsPerSet;
    workoutRestSecondsRef.current = nextRestSeconds;
    currentSetRef.current = 1;
    setRepCountRef.current = 0;
    setCount(0);
    setSaveStatus("idle");
    lastSavedCompletionRef.current = null;
    phaseRef.current = "countdown";
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
  }, [connectMotionSensor, hasRestBetweenSets, isGoalValid, normalizedGoal, normalizedRepsPerSet, normalizedRestSeconds, normalizedSetCount]);

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
        phaseRef.current = "active";
        setPhase("active");
        setLastMove("ready");
        return;
      }

      setCountdownValue(nextStep);
      speakText(nextStep === 0 ? `${currentSetRef.current}세트 시작` : `${nextStep}`);
    }, 900);

    return () => {
      window.clearInterval(timerId);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "active" && phase !== "rest") {
      return;
    }

    if (workoutStartedAtRef.current === null) {
      workoutStartedAtRef.current = performance.now();
    }

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
    if (phase !== "rest") {
      return;
    }

    const timerId = window.setInterval(() => {
      setRestRemainingSeconds((currentSeconds) => {
        if (currentSeconds <= 1) {
          window.clearInterval(timerId);
          phaseRef.current = "active";
          setPhase("active");
          setLastMove("ready");
          speakText(`${currentSetRef.current}세트 시작`);
          return 0;
        }

        const nextSeconds = currentSeconds - 1;

        if (nextSeconds <= 3) {
          speakText(`${nextSeconds}`);
        }

        return nextSeconds;
      });
    }, 1000);

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

  async function shareResult(background: ShareImageBackground) {
    setShareDialogOpen(false);
    setIsSharing(true);

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
        background,
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
    } finally {
      setIsSharing(false);
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
                    <p className="max-w-[11ch] text-[2.15rem] font-semibold leading-[1.05] text-[var(--coach-ink)]">오늘 루틴을 설정해요</p>
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

                  <div className="coach-target-panel flex min-h-[228px] flex-col items-center justify-center gap-3 rounded-[1.5rem] px-6 text-center">
                    <div className="flex items-end justify-center gap-2 text-[6.75rem] font-semibold leading-none text-[var(--coach-ink)]">
                      {isGoalValid ? normalizedGoal : "--"}
                      <span className="pb-4 text-2xl font-semibold text-[var(--coach-soft-ink)]">회</span>
                    </div>
                    <p className="text-sm font-medium text-[var(--coach-soft-ink)]">{workoutPlanText}</p>
                  </div>

                  <FieldGroup className="grid grid-cols-3 gap-3">
                    <Field data-invalid={!isSetCountValid}>
                      <FieldLabel htmlFor="squat-set-count">세트 수</FieldLabel>
                      <Input
                        id="squat-set-count"
                        className="h-14 rounded-2xl text-lg"
                        inputMode="numeric"
                        min={1}
                        max={maxWorkoutSets}
                        pattern="[0-9]*"
                        type="number"
                        value={setCountInput}
                        aria-invalid={!isSetCountValid}
                        onChange={(event) => setSetCountInput(event.target.value)}
                      />
                    </Field>
                    <Field data-invalid={!isRepsPerSetValid || (isSetCountValid && normalizedGoal > maxTotalGoal)}>
                      <FieldLabel htmlFor="squat-reps-per-set">세트당 개수</FieldLabel>
                      <Input
                        id="squat-reps-per-set"
                        className="h-14 rounded-2xl text-lg"
                        inputMode="numeric"
                        min={1}
                        max={maxRepsPerSet}
                        pattern="[0-9]*"
                        type="number"
                        value={repsPerSetInput}
                        aria-invalid={!isRepsPerSetValid || (isSetCountValid && normalizedGoal > maxTotalGoal)}
                        onChange={(event) => setRepsPerSetInput(event.target.value)}
                      />
                    </Field>
                    <Field data-invalid={!isRestSecondsValid} data-disabled={!hasRestBetweenSets}>
                      <FieldLabel htmlFor="squat-rest-seconds">휴식 시간(초)</FieldLabel>
                      <Input
                        id="squat-rest-seconds"
                        className="h-14 rounded-2xl text-lg"
                        inputMode="numeric"
                        min={0}
                        max={maxRestSeconds}
                        pattern="[0-9]*"
                        type="number"
                        value={restSecondsDisplayValue}
                        aria-invalid={!isRestSecondsValid}
                        disabled={!hasRestBetweenSets}
                        onChange={(event) => setRestSecondsInput(event.target.value)}
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
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      phaseRef.current = "setup";
                      setPhase("setup");
                    }}
                  >
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
                    <p className="max-w-xs text-sm text-muted-foreground">폰을 가슴 앞에 세워 두 손으로 고정하고, 카운트다운 동안 선 자세를 유지해 주세요.</p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="h-14 rounded-full"
                  onClick={() => {
                    phaseRef.current = "active";
                    setPhase("active");
                    speakText(`${currentSetRef.current}세트 시작`);
                  }}
                >
                  바로 시작
                </Button>
              </div>
            )}

            {phase === "active" && (
              <div className="flex min-h-[calc(100svh-8rem)] flex-col justify-between gap-6 p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-2xl font-semibold leading-none text-[var(--coach-ink)]">스쿼트 수행</p>
                    <p className="text-sm font-medium text-muted-foreground">{currentSet}/{workoutSetCount} 세트</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className={`rounded-full ${getSensorButtonClass(sensorStatus)}`}
                      onClick={handleSensorButtonClick}
                      disabled={count >= workoutGoal || setRepCount >= workoutRepsPerSet}
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
                        <p className="text-[6rem] font-semibold leading-none text-[var(--coach-ink)]">{setRepCount}</p>
                        <p className="mt-2 text-sm text-muted-foreground">{workoutRepsPerSet} reps</p>
                        <p className="mt-1 text-xs text-muted-foreground">누적 {count}/{workoutGoal}</p>
                      </div>
                    </div>
                  </div>
                  <div className="w-full rounded-2xl bg-[var(--coach-surface)] px-4 py-3" aria-live="polite">
                    <div className="flex items-center justify-between gap-3 text-xs font-medium">
                      <span className="text-[var(--coach-ink)]">{motionStageText}</span>
                      <span className="text-muted-foreground">감도 {motionLevel}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--coach-panel)]" aria-hidden="true">
                      <div
                        className="h-full rounded-full bg-[var(--coach-accent)] transition-[width] duration-100"
                        style={{ width: `${isCalibrating ? calibrationProgress : motionLevel}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="rounded-2xl bg-[var(--coach-surface)] p-4">
                    <p className="text-xs text-muted-foreground">세트 수</p>
                    <p className="mt-1 text-xl font-semibold text-[var(--coach-ink)]">{currentSet}/{workoutSetCount}</p>
                  </div>
                  <div className="rounded-2xl bg-[var(--coach-surface)] p-4">
                    <p className="text-xs text-muted-foreground">세트당 개수</p>
                    <p className="mt-1 text-xl font-semibold text-[var(--coach-ink)]">{setRepCount}/{workoutRepsPerSet}</p>
                  </div>
                  <div className="rounded-2xl bg-[var(--coach-surface)] p-4">
                    <p className="text-xs text-muted-foreground">전체 진행</p>
                    <p className="mt-1 text-xl font-semibold text-[var(--coach-ink)]">{progress}%</p>
                  </div>
                  <div className="rounded-2xl bg-[var(--coach-surface)] p-4">
                    <p className="text-xs text-muted-foreground">휴식</p>
                    <p className="mt-1 text-xl font-semibold text-[var(--coach-ink)]">{workoutRestTimeText}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <Button type="button" className="rounded-full" onClick={() => addSquat()} disabled={count >= workoutGoal || setRepCount >= workoutRepsPerSet}>
                    수동 +1
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-full"
                    onClick={() => {
                      phaseRef.current = "setup";
                      setPhase("setup");
                    }}
                  >
                    목표 변경
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      phaseRef.current = "complete";
                      setPhase("complete");
                    }}
                  >
                    종료
                  </Button>
                </div>
              </div>
            )}

            {phase === "rest" && (
              <div className="flex min-h-[calc(100svh-8rem)] flex-col justify-between gap-6 p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-2xl font-semibold leading-none text-[var(--coach-ink)]">휴식 중</p>
                    <p className="text-sm font-medium text-muted-foreground">다음 {currentSet}/{workoutSetCount} 세트</p>
                  </div>
                  <Badge variant="secondary" className="h-8! min-w-14 rounded-full! px-3! text-sm! leading-none">
                    {elapsedTimeText}
                  </Badge>
                </div>

                <div className="flex flex-1 flex-col items-center justify-center gap-7 text-center">
                  <div
                    className="progress-ring grid aspect-square w-full max-w-[300px] place-items-center rounded-full"
                    style={{ "--progress": `${restProgress}%` } as React.CSSProperties}
                  >
                    <div className="grid size-[78%] place-items-center rounded-full bg-[var(--coach-panel)]">
                      <div>
                        <p className="text-[4.25rem] font-semibold leading-none text-[var(--coach-ink)]">{restRemainingTimeText}</p>
                        <p className="mt-3 text-sm text-muted-foreground">휴식 후 {workoutRepsPerSet}개</p>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">완료 {count}/{workoutGoal}개 · {progress}%</p>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <Button
                    type="button"
                    className="rounded-full"
                    onClick={() => {
                      phaseRef.current = "active";
                      setRestRemainingSeconds(0);
                      setLastMove("ready");
                      setPhase("active");
                      speakText(`${currentSetRef.current}세트 시작`);
                    }}
                  >
                    다음 세트
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-full"
                    onClick={() => {
                      phaseRef.current = "setup";
                      setPhase("setup");
                    }}
                  >
                    목표 변경
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      phaseRef.current = "complete";
                      setPhase("complete");
                    }}
                  >
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

            <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>공유 배경 선택</DialogTitle>
                  <DialogDescription>공유할 이미지 배경을 골라주세요.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  {shareBackgroundOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-background p-2 text-left outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                      onClick={() => void shareResult(option.id)}
                      disabled={isSharing}
                    >
                      <span
                        aria-hidden="true"
                        className="aspect-square rounded-lg bg-cover bg-center"
                        style={{ backgroundImage: `url(${option.imageSrc})` }}
                      />
                      <span className="text-center text-sm font-medium text-foreground">{option.label}</span>
                    </button>
                  ))}
                </div>
              </DialogContent>
            </Dialog>

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
                    <p className="mt-3 text-sm text-muted-foreground">{workoutSetCount}세트 x {workoutRepsPerSet}개 중 {progress}% 달성했어요.</p>
                  </div>
                </div>

                <div className="rounded-2xl bg-[var(--coach-surface)] p-5">
                  <p className="text-4xl font-semibold text-[var(--coach-ink)]">{count} / {workoutGoal}</p>
                  <p className="mt-2 text-sm text-muted-foreground">달성률 {progress}% · 운동 시간 {elapsedTimeText} · 휴식 {workoutRestTimeText}</p>
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
                  <Button type="button" className="rounded-full" onClick={() => setShareDialogOpen(true)} disabled={isSharing}>
                    <Share2Icon data-icon="inline-start" />
                    {isSharing ? "공유 중" : "공유"}
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
