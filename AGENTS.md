# AGENTS.md

## Scope

These instructions apply to the entire repository. Project-specific instructions here take precedence over global agent defaults.

## Project Snapshot

This is a mobile-first Squat Coach app built with Next.js 16 App Router, React 19, Tailwind CSS 4, shadcn/ui, Radix/Base UI, Lucide icons, Upstash Redis, Vitest, Testing Library, and Playwright. The package manager is Bun.

`README.md` is the user-facing project overview. The current product is a Korean-language squat counter that tracks reps from phone motion, supports manual counting, saves workout completions, shows streak/calendar summaries, and generates shareable workout images.

## Start Here

- Read `CLAUDE.md` before significant work. It defines the spec-driven workflow, testing expectations, package manager, commit convention, and dependency direction.
- Check `git status --short` before editing. Preserve user changes and ignore unrelated dirty files.
- Use `rg` / `rg --files` for repository search.
- Use Bun commands from `package.json`; do not introduce another package manager or replace `bun.lock`.
- For third-party library, framework, SDK, CLI, or config changes, resolve the pinned version from `package.json`/`bun.lock` first and consult Context7 before writing code.

## Product And UX Conventions

- User-facing UI copy is Korean and should stay natural Korean unless a task explicitly changes language.
- The app is designed for a narrow mobile viewport (`max-w-[430px]`) with a native-app feel. Verify mobile layout carefully when touching UI.
- Follow the existing visual system in `app/globals.css`: `--coach-*` tokens, Noto Sans KR, rounded mobile panels, green accent, and compact dashboard-like surfaces.
- Prefer Lucide icons for actions and existing shadcn/ui components for controls.
- Preserve accessibility affordances already present: semantic headings, labels, `aria-live` where useful, and role/name-friendly controls for Playwright tests.
- Device motion and Web Share are browser/device capabilities. Keep permission-denied, unsupported, and fallback paths working.

## Architecture Map

- `app/page.tsx` should remain a thin App Router entry that renders `SquatCoachApp`.
- `app/layout.tsx` owns metadata, icons, Korean HTML language, Noto Sans KR, and the theme provider.
- `components/squat-coach-app.tsx` owns the client workout flow: setup, countdown, active counting, completion, sensor permission, audio/speech feedback, persistence calls, and sharing.
- `components/ui/*` contains shadcn-generated primitives. Do not edit these directly unless the task is explicitly about the primitive itself; prefer variants, semantic tokens, CSS variables, or wrapper composition.
- `lib/squat-motion.ts` is the motion algorithm boundary. Any changes to squat detection, calibration, vertical travel, or rep counting need focused tests in `lib/squat-motion.test.ts`.
- `lib/workout-summary.ts` owns date formatting, monthly calendar days, and streak calculation. Date/streak changes need tests in `lib/workout-summary.test.ts`.
- `lib/share-image.ts` owns canvas-based PNG generation and depends on `/public/workout-bg.png`. Keep text positioning, Korean units, and fallback rendering in mind.
- `lib/squat-users.ts` is the user allowlist. API routes and UI selection should continue to validate against it.
- `app/api/workouts/*` are the server persistence boundary using Upstash Redis. Validate all request/query input at the route edge.
- `public/*` contains app icons and share/background assets. If icon assets change, check `app/layout.tsx` and `app/manifest.ts` together.

Respect the dependency direction in `CLAUDE.md`: lower-level modules should not import higher-level modules. In this repo, `lib` must not depend on `components` or `app`; shared logic belongs in `lib`.

## Data And Runtime Notes

- Workout records are stored in Redis hashes under `squat:workout-completions:${userId}`.
- Redis environment variables may be either Vercel KV names (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) or Upstash names (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`).
- Missing Redis configuration is handled as a 503 and the UI shows a non-blocking message. Keep this graceful degradation.
- Completion saves are idempotent by date and keep the max observed `count` and `elapsedSeconds`.
- Do not commit secrets or real credentials. Avoid logging full request payloads.

## Commands

- Install dependencies: `bun install`
- Development server: `bun dev`
- HTTPS LAN development server for physical phone sensor testing: `bun run dev:https`
  - If LAN IP auto-detection picks the wrong interface, set `LAN_IP=<address>` before running the command.
- Lint: `bun run lint`
- Unit/integration tests: `bun run test`
- Watch tests: `bun run test:watch`
- E2E tests: `bun run test:e2e`
- Production build: `bun run build`
- Production server: `bun start`

Before running E2E for the first time in a fresh environment, install Chromium with `bunx playwright install chromium`.

## Testing Expectations

- Every behavioral change needs measurable acceptance criteria and the lowest useful test boundary.
- Keep Vitest tests colocated as `<file>.test.ts` / `<file>.test.tsx`.
- Keep Playwright specs in `e2e/*.spec.ts`.
- Motion algorithm changes should cover shallow dips, valid depth, adaptive depth, calibration/baseline behavior, and noisy or boundary travel sequences when relevant.
- Date/streak changes should cover missed days, invalid dates, month padding, and local-date behavior.
- API route changes should cover validation failures, missing Redis configuration, and persistence summaries when practical.
- UI flow changes should update Playwright assertions for visible Korean copy, labels, and primary controls.
- For doc-only changes, tests are usually unnecessary; say that explicitly in the final response.

## Spec-Driven Workflow

This repository carries a Claude/Harness workflow:

1. Ideate: optional `artifacts/<feature>/idea.md`
2. Specify: `artifacts/<feature>/spec.md`
3. Sketch: optional `artifacts/<feature>/wireframe.html`
4. Plan: `artifacts/<feature>/plan.md`
5. Build: implementation plus `artifacts/<feature>/learnings.md`
6. Compound: promote repeated patterns only after user approval

When a feature artifact exists, treat `artifacts/<feature>/spec.md` as the behavioral contract. Derive tests from Success Criteria. If implementation and spec conflict, fix the implementation or ask the user to change the spec.

## Commit Style

Recent history mostly follows Conventional Commit style, especially:

- `feat: add squat coach app flow`
- `fix: detect squat reps from vertical phone motion`
- `style: refine squat coach interface`

Some older asset-only commits are plain imperative messages such as `update app icon` or `change background, icon image`, but new commits should prefer Conventional Commits: `feat:`, `fix:`, `style:`, `test:`, `docs:`, `refactor:`, or `chore:`.

Keep commits feature-scoped. When following a plan, prefer one meaningful commit per completed task if the user asks for commits.

## Documentation Rules

- Write source code in English unless the user explicitly requests another language.
- Engineering docs default to English. Product-facing docs may be Korean when matching the app/user context; `README.md` is currently Korean.
- Korean is appropriate for product UI copy and user-visible text because the current app is Korean.
- Do not add inline editorial/status annotations to documents. Use commits or separate decision records instead.
- Keep this `AGENTS.md` updated when workflow, commands, architecture boundaries, or test strategy materially change.
