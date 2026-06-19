import { expect, test } from "@playwright/test";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Squat Coach");
  await expect(page.getByRole("heading", { name: "Squat Coach" })).toBeVisible();
  await expect(page.getByText("스쿼트 몇 개 할까요?")).toBeVisible();
  await expect(page.getByLabel("목표 개수")).toHaveValue("100");
  await expect(page.getByRole("button", { name: /시작하기/ })).toBeVisible();
  await expect(page.getByText("100")).toBeVisible();
});

test("start flow shows countdown before workout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /시작하기/ }).click();
  await expect(page.getByText("자세를 잡아주세요")).toBeVisible();
  await expect(page.getByText("곧 시작합니다")).toBeVisible();
  await expect(page.getByRole("button", { name: "바로 시작" })).toBeVisible();
});
