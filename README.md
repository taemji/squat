# Squat Coach

휴대폰 모션 센서로 스쿼트 개수를 세는 모바일 우선 운동 카운터입니다. 수동 카운트도 지원하며, 목표 개수, 운동 시간, 완료 기록, 연속 운동일, 공유용 운동 결과 이미지를 제공합니다.

## 주요 기능

- `DeviceMotionEvent` 기반 스쿼트 자동 카운트
- 센서가 막히거나 데스크톱에서 테스트할 때 사용할 수 있는 수동 `+1` 카운트
- 목표 개수 설정, 카운트다운, 진행률, 완료 화면
- 좁은 휴대폰 화면에 맞춘 한국어 모바일 UI
- 사용자별 운동 완료 기록, 달력, 연속 운동일 표시
- 완료 기록 공유 이미지 생성
- Redis 설정이 없어도 카운트 기능은 계속 동작하는 graceful fallback

## 기술 스택

- **Framework**: Next.js 16 App Router
- **UI**: React 19, Tailwind CSS 4, shadcn/ui, Radix UI, Base UI
- **Icons**: Lucide React
- **Persistence**: Upstash Redis REST API
- **Testing**: Vitest, Testing Library, Playwright
- **Package manager**: Bun

## 시작하기

의존성을 설치하고 기본 HTTP 개발 서버를 실행합니다.

```bash
bun install
bun dev
```

[http://localhost:3000](http://localhost:3000)에서 확인할 수 있습니다.

HTTP 서버는 데스크톱 UI 작업이나 수동 카운트 테스트에는 충분합니다. 다른 휴대폰에서 실제 모션 센서를 테스트하려면 HTTPS 개발 서버를 사용해야 합니다.

## 휴대폰 센서 테스트

모바일 브라우저에서 모션 센서 접근은 보안 컨텍스트가 필요할 수 있습니다. 실제 휴대폰에서 자동 카운트를 테스트할 때는 HTTPS 개발 서버를 실행합니다.

```bash
bun run dev:https
```

스크립트는 현재 LAN IP를 감지하고, 해당 IP에 맞는 임시 self-signed 인증서를 만든 뒤 Next.js를 HTTPS로 실행합니다. 출력되는 LAN 주소를 휴대폰 브라우저에서 엽니다.

```text
https://192.168.1.167:3000
```

처음 접속할 때 브라우저가 self-signed 인증서 경고를 표시할 수 있습니다. 로컬 테스트 목적이면 경고를 통과해서 접속합니다.

LAN IP 자동 감지가 잘못되면 직접 지정할 수 있습니다.

```bash
LAN_IP=192.168.1.167 bun run dev:https
```

Windows PowerShell에서는 다음처럼 지정합니다.

```powershell
$env:LAN_IP="192.168.1.167"; bun run dev:https
```

브라우저에 따라 모션 센서 권한 요청이 표시될 수 있습니다. 시작 버튼을 누른 뒤 권한 팝업이 뜨면 허용해야 자동 카운트가 동작합니다.

## 스쿼트 카운트 방식

이 앱은 카메라 포즈 인식을 사용하지 않습니다. 휴대폰 가속도 데이터를 사용합니다.

1. 운동 시작 시 약 2.5초 동안 기준 자세의 중력 방향을 측정합니다.
2. 이후 들어오는 센서 샘플을 기준 중력 방향에 투영해 수직 이동량을 추정합니다.
3. `standing -> down -> bottom -> rising -> standing` 상태 머신으로 움직임을 추적합니다.
4. 충분한 깊이에 도달한 뒤 다시 선 자세 근처로 돌아오면 1회로 카운트합니다.

모션 판정 로직은 [lib/squat-motion.ts](./lib/squat-motion.ts)에 있고, 관련 테스트는 [lib/squat-motion.test.ts](./lib/squat-motion.test.ts)에 있습니다.

## 기록 저장

운동 요약은 Upstash Redis에 저장합니다. Vercel KV 형식의 환경변수를 사용할 수 있습니다.

```bash
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
```

또는 Upstash REST 환경변수를 사용할 수 있습니다.

```bash
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

환경변수가 없어도 앱은 실행되고 카운트 기능도 동작합니다. 이 경우 요약 조회와 완료 저장 API는 `503`을 반환하며, UI에는 비차단 안내 메시지가 표시됩니다.

## 스크립트

| 명령어 | 설명 |
|---|---|
| `bun dev` | 기본 HTTP 개발 서버 실행 |
| `bun run dev:https` | 휴대폰 센서 테스트용 HTTPS LAN 개발 서버 실행 |
| `bun run build` | 프로덕션 빌드 |
| `bun start` | 프로덕션 서버 실행 |
| `bun run lint` | ESLint 실행 |
| `bun run test` | Vitest 실행 |
| `bun run test:watch` | Vitest watch 모드 실행 |
| `bun run test:e2e` | Playwright E2E 테스트 실행 |

새 환경에서 E2E 테스트를 처음 실행하기 전에는 Chromium을 설치합니다.

```bash
bunx playwright install chromium
```

## 프로젝트 구조

- [app/page.tsx](./app/page.tsx): 앱 진입점
- [components/squat-coach-app.tsx](./components/squat-coach-app.tsx): 클라이언트 운동 플로우
- [lib/squat-motion.ts](./lib/squat-motion.ts): 스쿼트 모션 판정 로직
- [lib/workout-summary.ts](./lib/workout-summary.ts): 날짜, 달력, 연속 운동일 계산
- [lib/share-image.ts](./lib/share-image.ts): 공유 이미지 생성
- [CLAUDE.md](./CLAUDE.md), [AGENTS.md](./AGENTS.md): 저장소 작업 규칙과 아키텍처 지침
