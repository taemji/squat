/**
 * Canvas API를 사용해 공유용 이미지 생성
 * 배경 이미지 원본 크기 위에 텍스트를 얹은 PNG를 생성
 */

interface ShareImageProps {
  todayReps: number;
  todayTime: number; // seconds
  calories: number;
  totalDays?: number;
  totalReps?: number;
}

function loadBackgroundImage() {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const backgroundImg = new Image();
    backgroundImg.onload = () => resolve(backgroundImg);
    backgroundImg.onerror = reject;
    backgroundImg.src = `/workout-bg.png?v=${Date.now()}`;
  });
}

export async function generateShareImage(props: ShareImageProps): Promise<Blob> {
  const { todayReps, todayTime, calories, totalDays = -1, totalReps = -1 } = props;

  let backgroundImg: HTMLImageElement | null = null;
  const canvas = document.createElement("canvas");

  try {
    backgroundImg = await loadBackgroundImage();
    canvas.width = backgroundImg.naturalWidth;
    canvas.height = backgroundImg.naturalHeight;
  } catch {
    canvas.width = 1080;
    canvas.height = 1920;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  // 1. 배경 이미지 로드 및 그리기
  if (backgroundImg) {
    ctx.drawImage(backgroundImg, 0, 0);
  } else {
    // 배경 이미지 로드 실패 시 그라디언트 폴백
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#9b6bb8");
    gradient.addColorStop(0.5, "#8b5fbf");
    gradient.addColorStop(1, "#7b3fbf");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // 2. 반투명 오버레이 (텍스트 가독성)
  ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const scaleX = canvas.width / 1080;
  const scaleY = canvas.height / 1920;
  const scale = Math.min(scaleX, scaleY);
  const x = (value: number) => value * scaleX;
  const y = (value: number) => value * scaleY;
  const font = (weight: "bold" | "normal", size: number) => `${weight} ${Math.round(size * scale)}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto`;

  // 3. 텍스트 색상
  ctx.fillStyle = "white";

  // ====== 좌상단 ======
  // 로고/타이틀
  ctx.font = font("bold", 28);
  ctx.textAlign = "left";
  ctx.fillText("🏋️ Squat Coach", x(60), y(100));

  // 날짜
  ctx.font = font("normal", 18);
  const today = new Date().toLocaleDateString("ko-KR").replace(/\./g, ".").slice(0, -1);
  ctx.fillText(today, x(60), y(140));

  // ====== 중앙 (큰 숫자) ======
  ctx.font = font("bold", 120);
  ctx.textAlign = "center";
  ctx.fillText(`${todayReps}개`, canvas.width / 2, y(600));

  // ====== 좌하단 ======
  ctx.textAlign = "left";
  
  // 운동 시간
  ctx.font = font("normal", 22);
  const minutes = Math.floor(todayTime / 60);
  const seconds = todayTime % 60;
  const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  ctx.fillText(timeStr, x(60), y(1450));

  ctx.font = font("normal", 16);
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillText("시간", x(60), y(1480));

  // 총 운동일
  ctx.fillStyle = "white";
  ctx.font = font("normal", 22);
  const totalDaysText = totalDays < 0 ? "TBD" : `${totalDays}일`;
  ctx.fillText(totalDaysText, x(60), y(1600));

  ctx.font = font("normal", 16);
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillText("총 운동일", x(60), y(1630));

  // ====== 우하단 ======
  ctx.textAlign = "right";

  // 칼로리
  ctx.fillStyle = "white";
  ctx.font = font("normal", 22);
  ctx.fillText(`${calories.toFixed(1)}kcal`, canvas.width - x(60), y(1450));

  ctx.font = font("normal", 16);
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillText("활동 칼로리", canvas.width - x(60), y(1480));

  // 누적 반복수
  ctx.fillStyle = "white";
  ctx.font = font("normal", 22);
  const totalRepsText = totalReps < 0 ? "TBD" : `${totalReps}개`;
  ctx.fillText(totalRepsText, canvas.width - x(60), y(1600));

  ctx.font = font("normal", 16);
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillText("전체", canvas.width - x(60), y(1630));

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
