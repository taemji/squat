export const SQUAT_USERS = [
  { id: "minji", name: "민지" },
  { id: "jooyoung", name: "주영" },
  { id: "donghun", name: "동훈" },
] as const;

export type SquatUserId = (typeof SQUAT_USERS)[number]["id"];

const squatUserIds = new Set<string>(SQUAT_USERS.map((user) => user.id));

export function isSquatUserId(value: unknown): value is SquatUserId {
  return typeof value === "string" && squatUserIds.has(value);
}

export function getSquatUserName(userId: SquatUserId) {
  return SQUAT_USERS.find((user) => user.id === userId)?.name ?? userId;
}