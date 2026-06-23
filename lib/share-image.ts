/**
 * Canvas API를 사용해 공유용 이미지 생성
 * workout-bg-mark.png 기준의 정사각형 레이아웃 위에 기록 텍스트를 얹은 PNG를 생성
 */

interface ShareImageProps {
  todayReps: number;
  todayTime: number; // seconds
  calories: number;
  totalDays?: number;
  totalReps?: number;
}

const CANVAS_SIZE = 1920;

function loadBackgroundImage() {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const backgroundImg = new Image();
    backgroundImg.onload = () => resolve(backgroundImg);
    backgroundImg.onerror = reject;
    backgroundImg.src = `/workout-bg.png?v=${Date.now()}`;
  });
}

function getCanvasFontFamily() {
  const cssFontFamily = getComputedStyle(document.body).getPropertyValue("--font-sans").trim();

  return cssFontFamily || "'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}

export async function generateShareImage(props: ShareImageProps): Promise<Blob> {
  const { todayReps, todayTime, calories, totalDays = -1, totalReps = -1 } = props;

  let backgroundImg: HTMLImageElement | null = null;
  const canvas = document.createElement("canvas");

  try {
    backgroundImg = await loadBackgroundImage();
  } catch {
    backgroundImg = null;
  }

  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  if (backgroundImg) {
    ctx.drawImage(backgroundImg, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#9b6bb8");
    gradient.addColorStop(0.5, "#8b5fbf");
    gradient.addColorStop(1, "#7b3fbf");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const fontFamily = getCanvasFontFamily();
  const font = (weight: number, size: number) => `${weight} ${size}px ${fontFamily}`;
  const white = "rgba(255, 255, 255, 0.96)";
  const mutedWhite = "rgba(255, 255, 255, 0.78)";

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = white;

  ctx.font = font(800, 78);
  ctx.textAlign = "left";
  ctx.fillText("Squat Coach", 220, 188);

  ctx.beginPath();
  ctx.arc(140, 152, 44, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  ctx.fill();
  ctx.fillStyle = white;
  ctx.font = font(900, 58);
  ctx.fillText("S", 122, 173);

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replace(/\. /g, ".").replace(/\.$/, "");

  ctx.textAlign = "right";
  ctx.fillStyle = mutedWhite;
  ctx.font = font(500, 36);
  ctx.fillText("TODAY", 1830, 164);
  ctx.fillStyle = white;
  ctx.font = font(700, 52);
  ctx.fillText(today, 1830, 230);

  ctx.textAlign = "left";
  ctx.fillStyle = white;
  ctx.font = font(900, 380);
  ctx.fillText(String(todayReps), 92, 870);

  ctx.font = font(800, 76);
  ctx.fillText("개", 650, 850);

  ctx.fillStyle = mutedWhite;
  ctx.font = font(600, 44);
  ctx.fillText("오늘의 스쿼트", 98, 980);

  const minutes = Math.floor(todayTime / 60);
  const seconds = todayTime % 60;
  const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const totalDaysText = totalDays < 0 ? "TBD" : `${totalDays}일`;
  const totalRepsText = totalReps < 0 ? "TBD" : `${totalReps}개`;
  const stats = [
    { value: timeStr, label: "시간" },
    { value: totalDaysText, label: "총 운동일" },
    { value: `${calories.toFixed(1)}kcal`, label: "활동 칼로리" },
    { value: totalRepsText, label: "전체" },
  ];

  ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
  ctx.lineWidth = 3;
  for (const dividerX of [520, 920, 1392]) {
    ctx.beginPath();
    ctx.moveTo(dividerX, 1644);
    ctx.lineTo(dividerX, 1854);
    ctx.stroke();
  }

  for (const [index, stat] of stats.entries()) {
    const center = [320, 720, 1156, 1624][index];
    ctx.textAlign = "center";
    ctx.fillStyle = white;
    ctx.font = font(800, 82);
    ctx.fillText(stat.value, center, 1698);
    ctx.fillStyle = mutedWhite;
    ctx.font = font(600, 40);
    ctx.fillText(stat.label, center, 1794);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to generate canvas blob"));
        }
      },
      "image/png",
      0.95
    );
  });
}
