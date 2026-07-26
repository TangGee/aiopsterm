import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

test('project files uses a contextual drawer inside the persistent AI panel', async () => {
  test.setTimeout(120_000)
  const runId = Date.now()
  const userDataDir = path.join(os.tmpdir(), `aiopsterm-e2e-project-files-user-${runId}`)
  const projectRoot = path.join(os.tmpdir(), `aiopsterm-e2e-project-files-root-${runId}`)
  const secondProjectRoot = path.join(os.tmpdir(), `aiopsterm-e2e-project-files-second-${runId}`)
  await mkdir(path.join(projectRoot, 'src'), { recursive: true })
  await mkdir(path.join(projectRoot, 'move-target'), { recursive: true })
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

    await drawer.locator('.project-files-tree-row').filter({ hasText: 'src' }).click()
    const mainFileRow = drawer.locator('.project-files-tree-row').filter({ hasText: 'main.ts' })
    await expect(mainFileRow).toBeVisible()
    await mainFileRow.click()

    const projectEditor = page.locator('.project-file-editor')
    const monacoEditor = projectEditor.locator('.files-monaco-editor')
    await expect(projectEditor).toBeVisible()
    await expect(monacoEditor).toHaveClass(/monaco-ready/)
    const editorGeometry = await Promise.all([
      projectEditor.boundingBox(),
      projectEditor.locator('header').boundingBox(),
      monacoEditor.boundingBox(),
      projectEditor.locator('footer').boundingBox()
    ])
    const [projectEditorBox, projectEditorHeaderBox, monacoEditorBox, projectEditorFooterBox] = editorGeometry
    expect(monacoEditorBox!.height).toBeGreaterThan(projectEditorBox!.height * 0.7)
    expect(monacoEditorBox!.y).toBeGreaterThanOrEqual(projectEditorHeaderBox!.y + projectEditorHeaderBox!.height - 1)
    expect(projectEditorFooterBox!.y + projectEditorFooterBox!.height).toBeGreaterThanOrEqual(
      projectEditorBox!.y + projectEditorBox!.height - 1
    )
    await expect(projectEditor.locator('.minimap')).toBeHidden()

    await projectEditor.locator('.view-lines').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('export const autosaved = true\n')
    await expect.poll(() => readFile(path.join(projectRoot, 'src', 'main.ts'), 'utf8')).toBe('export const autosaved = true\n')
    await expect(projectEditor.locator('footer')).toContainText('Saved')

    await projectEditor.locator('.view-lines').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('// local pending\n')
    await writeFile(path.join(projectRoot, 'src', 'main.ts'), 'export const agent = true\n', 'utf8')
    await expect(projectEditor.locator('.project-file-conflict')).toBeVisible()
    await expect(projectEditor.locator('footer')).toContainText('Conflict')
    await page.waitForTimeout(1200)
    await expect.poll(() => readFile(path.join(projectRoot, 'src', 'main.ts'), 'utf8')).toBe('export const agent = true\n')
    await projectEditor.getByRole('button', { name: 'Reload from disk' }).click()
    await expect(projectEditor.locator('.project-file-conflict')).toHaveCount(0)

    const treeScroll = drawer.locator('.project-files-tree-scroll')
    await treeScroll.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      element.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 120,
        clientY: rect.bottom - 24
      }))
    })
    let contextMenu = page.locator('.project-files-context-menu')
    await contextMenu.getByRole('button', { name: 'New file' }).click()
    let mutationDialog = page.locator('.project-files-dialog')
    await mutationDialog.locator('input').fill('scratch.ts')
    await mutationDialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.poll(() => readFile(path.join(projectRoot, 'scratch.ts'), 'utf8')).toBe('')
    await expect(projectEditor.locator('header')).toContainText('scratch.ts')

    let scratchRow = drawer.locator('.project-files-tree-row').filter({ hasText: 'scratch.ts' })
    await expect(scratchRow).toBeVisible()
    await scratchRow.click({ button: 'right' })
    await contextMenu.getByRole('button', { name: 'Copy relative path' }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('scratch.ts')

    await scratchRow.click({ button: 'right' })
    await contextMenu.getByRole('button', { name: 'Copy absolute path' }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(path.join(projectRoot, 'scratch.ts'))

    await scratchRow.click({ button: 'right' })
    await contextMenu.getByRole('button', { name: 'Rename' }).click()
    mutationDialog = page.locator('.project-files-dialog')
    await mutationDialog.locator('input').fill('renamed.ts')
    await mutationDialog.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect.poll(() => readFile(path.join(projectRoot, 'renamed.ts'), 'utf8')).toBe('')
    await expect(projectEditor.locator('header')).toContainText('renamed.ts')

    const renamedRow = drawer.locator('.project-files-tree-row').filter({ hasText: 'renamed.ts' })
    const moveTargetRow = drawer.locator('.project-files-tree-row').filter({ hasText: 'move-target' })
    await expect(renamedRow).toBeVisible()
    await expect(moveTargetRow).toBeVisible()
    await renamedRow.dragTo(moveTargetRow)
    await expect.poll(() => readFile(path.join(projectRoot, 'move-target', 'renamed.ts'), 'utf8')).toBe('')
    await expect(projectEditor.locator('header')).toContainText('move-target/renamed.ts')

    await moveTargetRow.click()
    const movedRow = drawer.locator('.project-files-tree-row').filter({ hasText: 'renamed.ts' })
    await expect(movedRow).toBeVisible()
    await movedRow.click({ button: 'right' })
    await contextMenu.getByRole('button', { name: 'Delete' }).click()
    mutationDialog = page.locator('.project-files-dialog')
    await mutationDialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(async () => {
      try {
        await readFile(path.join(projectRoot, 'move-target', 'renamed.ts'), 'utf8')
        return false
      } catch {
        return true
      }
    }).toBe(true)

    const capturePath = process.env.AIOPSTERM_PROJECT_FILES_CAPTURE
    if (capturePath) await page.screenshot({ path: capturePath })

    await page.locator('.side-rail .rail-button[title="AI 会话"]').click()
    const secondSessionRow = page.locator('.ai-session-row').filter({
      has: page.locator('.ai-session-row-title').getByText('Second project files E2E', { exact: true })
    })
    await expect(secondSessionRow).toBeVisible()
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
