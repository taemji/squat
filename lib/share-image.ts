/**
 * Canvas API를 사용해 공유용 이미지 생성
 * 1080x1920px PNG 포맷 with background image
 */

interface ShareImageProps {
  todayReps: number;
  todayTime: number; // seconds
  calories: number;
  totalDays?: number;
  totalReps?: number;
}

export async function generateShareImage(props: ShareImageProps): Promise<Blob> {
  const { todayReps, todayTime, calories, totalDays = -1, totalReps = -1 } = props;

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }

  // 1. 배경 이미지 로드 및 그리기
  try {
    const backgroundImg = new Image();
    backgroundImg.crossOrigin = "anonymous";
    backgroundImg.src = "/workout-bg.png";
    
    await new Promise((resolve, reject) => {
      backgroundImg.onload = () => {
        ctx.drawImage(backgroundImg, 0, 0, canvas.width, canvas.height);
        resolve(null);
      };
      backgroundImg.onerror = reject;
    });
  } catch (error) {
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

  // 3. 텍스트 색상
  ctx.fillStyle = "white";

  // ====== 좌상단 ======
  // 로고/타이틀
  ctx.font = "bold 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
  ctx.textAlign = "left";
  ctx.fillText("🏋️ Squat Coach", 60, 100);

  // 날짜
  ctx.font = "18px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
  const today = new Date().toLocaleDateString("ko-KR").replace(/\./g, ".").slice(0, -1);
  ctx.fillText(today, 60, 140);

  // ====== 중앙 (큰 숫자) ======
  ctx.font = "bold 120px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
  ctx.textAlign = "center";
  ctx.fillText(`${todayReps}개`, canvas.width / 2, 600);

  // ====== 좌하단 ======
  ctx.textAlign = "left";
  
  // 운동 시간
  ctx.font = "22px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
  const minutes = Math.floor(todayTime / 60);
  const seconds = todayTime % 60;
  const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  ctx.fillText(timeStr, 60, 1450);

  ctx.font = "16px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillText("시간", 60, 1480);

  // 총 운동일
  ctx.fillStyle = "white";
  ctx.font = "22px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
  const totalDaysText = totalDays < 0 ? "TBD" : `${totalDays}일`;
  ctx.fillText(totalDaysText, 60, 1600);

  ctx.font = "16px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillText("총 운동일", 60, 1630);

  // ====== 우하단 ======
  ctx.textAlign = "right";

  // 칼로리
  ctx.fillStyle = "white";
  ctx.font = "22px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
  ctx.fillText(`${calories.toFixed(1)}kcal`, canvas.width - 60, 1450);

  ctx.font = "16px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillText("활동 칼로리", canvas.width - 60, 1480);

  // 누적 반복수
  ctx.fillStyle = "white";
  ctx.font = "22px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
  const totalRepsText = totalReps < 0 ? "TBD" : `${totalReps}개`;
  ctx.fillText(totalRepsText, canvas.width - 60, 1600);

  ctx.font = "16px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto";
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillText("전체", canvas.width - 60, 1630);

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
