import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

test('project files uses a contextual drawer inside the persistent AI panel', async () => {
  test.setTimeout(120_000)
  const runId = Date.now()
  const userDataDir = path.join(os.tmpdir(), `aiopsterm-e2e-project-files-user-${runId}`)
  const projectRoot = path.join(os.tmpdir(), `aiopsterm-e2e-project-files-root-${runId}`)
  const secondProjectRoot = path.join(os.tmpdir(), `aiopsterm-e2e-project-files-second-${runId}`)
  await mkdir(path.join(projectRoot, 'src'), { recursive: true })
  await mkdir(path.join(secondProjectRoot, 'lib'), { recursive: true })
  await writeFile(path.join(projectRoot, 'src', 'main.ts'), 'export const ready = true\n', 'utf8')
  await writeFile(path.join(secondProjectRoot, 'lib', 'index.ts'), 'export const second = true\n', 'utf8')

  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AIOPSTERM_USER_DATA_DIR: userDataDir,
      AIOPSTERM_WORKSPACE_PREFERENCES_ENABLE_SEED: '1',
      AIOPSTERM_MODEL_SETTINGS_ENABLE_SEED: '1',
      AIOPSTERM_MCP_DISCOVERY_DISABLE: '1',
      AIOPSTERM_AI_CHAT_BACKEND_DOUBLE: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    }
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.addStyleTag({
      content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }'
    })

    await page.locator('.side-rail .rail-button[title="设置"]').click()
    await expect(page.locator('.settings-bg-tile.preset').first()).toBeVisible()
    await page.locator('.settings-bg-tile.preset').nth(1).click()
    await expect(page.locator('.app-shell')).toHaveClass(/has-app-background/)
    await page.locator('.side-rail .rail-button[title="工作区"]').click()

    await expect(page.locator('.right-assistant-panel')).toBeVisible()
    await expect(page.locator('.right-assistant-tabs')).toHaveCount(0)
    await expect(page.getByTestId('ai-project-files-toggle')).toHaveCount(0)

    await page.evaluate(async ({ projectRoot, secondProjectRoot, missingProjectRoot, runId }) => {
      const api = (window as unknown as {
        aiops: {
          createTerminal: (input: Record<string, unknown>) => Promise<{ id: string }>
          publishAiAgentSessionEvent: (input: Record<string, unknown>) => Promise<{ ok: boolean; errorMessage?: string }>
        }
      }).aiops
      const terminal = await api.createTerminal({
        kind: 'local',
        cwd: projectRoot,
        title: 'Project files E2E'
      })
      const result = await api.publishAiAgentSessionEvent({
        source: 'codex',
        event: 'session_start',
        sessionId: `project-files-${runId}`,
        terminalSessionId: terminal.id,
        cwd: projectRoot,
        title: 'Project files E2E',
        summary: 'Project files E2E',
        receivedAt: Date.now()
      })
      if (!result.ok) throw new Error(result.errorMessage || 'Unable to publish managed AI session.')
      const secondTerminal = await api.createTerminal({
        kind: 'local',
        cwd: secondProjectRoot,
        title: 'Second project files E2E'
      })
      for (const input of [
        {
          source: 'codex',
          event: 'session_start',
          sessionId: `project-files-second-${runId}`,
          terminalSessionId: secondTerminal.id,
          cwd: secondProjectRoot,
          title: 'Second project files E2E',
          summary: 'Second project files E2E',
          receivedAt: Date.now()
        },
        {
          source: 'codex',
          event: 'session_start',
          sessionId: `project-files-ineligible-${runId}`,
          terminalSessionId: secondTerminal.id,
          cwd: missingProjectRoot,
          title: 'Ineligible project files E2E',
          summary: 'Ineligible project files E2E',
          receivedAt: Date.now()
        }
      ]) {
        const published = await api.publishAiAgentSessionEvent(input)
        if (!published.ok) throw new Error(published.errorMessage || 'Unable to publish managed AI session.')
      }
    }, { projectRoot, secondProjectRoot, missingProjectRoot: path.join(secondProjectRoot, 'missing'), runId })

    await page.locator('.side-rail .rail-button[title="AI 会话"]').click()
    const sessionRow = page.locator('.ai-session-row').filter({
      has: page.locator('.ai-session-row-title').getByText('Project files E2E', { exact: true })
    })
    await expect(sessionRow).toBeVisible()
    await sessionRow.click()

    const toggle = page.getByTestId('ai-project-files-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    const drawer = page.locator('.project-files-drawer')
    await expect(drawer).toBeVisible()
    const drawerSurface = await drawer.evaluate((element) => {
      const color = getComputedStyle(element).backgroundColor
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')
      if (!context) return { color, alpha: 0 }
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return {
        color,
        alpha: context.getImageData(0, 0, 1, 1).data[3] / 255
      }
    })
    expect(drawerSurface.alpha).toBe(1)
    await expect(page.locator('.ai-header')).toBeVisible()
    await expect(drawer.locator('.project-files-header-title strong')).toHaveText(path.basename(projectRoot))
    await expect(drawer.locator('.project-files-tree-row').filter({ hasText: 'src' })).toBeVisible()

    const panelBox = await page.locator('.right-assistant-panel').boundingBox()
    const aiBox = await page.locator('.ai-panel').boundingBox()
    const headerBox = await page.locator('.ai-header').boundingBox()
    const drawerBox = await drawer.boundingBox()
    expect(panelBox?.y).toBe(aiBox?.y)
    expect(drawerBox!.y).toBeGreaterThan(headerBox!.y + headerBox!.height)

    const capturePath = process.env.AIOPSTERM_PROJECT_FILES_CAPTURE
    if (capturePath) await page.screenshot({ path: capturePath })

    const secondSessionRow = page.locator('.ai-session-row').filter({
      has: page.locator('.ai-session-row-title').getByText('Second project files E2E', { exact: true })
    })
    await secondSessionRow.click()
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('.project-files-header-title strong')).toHaveText(path.basename(secondProjectRoot))
    await expect(drawer.locator('.project-files-tree-row').filter({ hasText: 'lib' })).toBeVisible()

    await drawer.getByTestId('project-files-close').click()
    await expect(drawer).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await toggle.click()
    await expect(drawer).toBeVisible()
    const ineligibleSessionRow = page.locator('.ai-session-row').filter({
      has: page.locator('.ai-session-row-title').getByText('Ineligible project files E2E', { exact: true })
    })
    await ineligibleSessionRow.click()
    await expect(page.getByTestId('ai-project-files-toggle')).toHaveCount(0)
    await expect(drawer).toHaveCount(0)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
    await rm(projectRoot, { recursive: true, force: true })
    await rm(secondProjectRoot, { recursive: true, force: true })
  }
})
