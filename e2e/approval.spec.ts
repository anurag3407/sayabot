import type { Page } from "@playwright/test"
import { expect, openRoom, signIn, state, test } from "./fixtures"

/** A resolved step sits folded inside its reply's step group, so open the group first. */
async function openSteps(page: Page, toolCallId: string) {
  const toggle = page
    .locator('[data-testid="worked-group"]')
    .filter({ has: page.locator(`[data-tool-call-id="${toolCallId}"]`) })
    .first()
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
}

test("an admin approves one tool call and rejects another", async ({ page }) => {
  await signIn(page, state().emailA)
  await openRoom(page, state().generalRoomId)

  const approveCard = page.locator(
    `[data-testid="approval-card"][data-tool-call-id="${state().approveToolCallId}"]`,
  )
  await expect(approveCard).toBeVisible({ timeout: 30_000 })
  await approveCard.getByTestId("approve-tool").click()
  await expect(approveCard).toBeHidden({ timeout: 30_000 })
  await openSteps(page, state().approveToolCallId)
  await expect(
    page.locator(
      `[data-testid="tool-call"][data-tool-call-id="${state().approveToolCallId}"][data-status="approved"]`,
    ),
  ).toBeVisible({ timeout: 30_000 })

  const rejectCard = page.locator(
    `[data-testid="approval-card"][data-tool-call-id="${state().rejectToolCallId}"]`,
  )
  await expect(rejectCard).toBeVisible()
  await rejectCard.getByTestId("reject-tool").click()
  await expect(rejectCard).toBeHidden({ timeout: 30_000 })
  await openSteps(page, state().rejectToolCallId)
  await expect(
    page.locator(
      `[data-testid="tool-call"][data-tool-call-id="${state().rejectToolCallId}"][data-status="rejected"]`,
    ),
  ).toBeVisible({ timeout: 30_000 })
})
