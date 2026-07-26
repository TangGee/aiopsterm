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
    await page.locator('.side-rail .rail-button[data-module-key="workspace"]').click()

    await expect(page.locator('.right-assistant-panel')).toBeVisible()
    await expect(page.locator('.right-assistant-tabs')).toHaveCount(0)
    await expect(page.getByTestId('ai-project-files-toggle')).toHaveCount(0)

    await page.getByTestId('ai-more-actions-open').click()
    const moreActionsMenu = page.getByTestId('ai-more-actions-menu')
    await expect(moreActionsMenu).toBeVisible()
    const moreActionsGeometry = await moreActionsMenu.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return {
        parentIsBody: element.parentElement === document.body,
        left: bounds.left,
        right: bounds.right,
        viewportWidth: window.innerWidth
      }
    })
    expect(moreActionsGeometry.parentIsBody).toBe(true)
    expect(moreActionsGeometry.left).toBeGreaterThanOrEqual(8)
    expect(moreActionsGeometry.right).toBeLessThanOrEqual(moreActionsGeometry.viewportWidth - 8)
    await page.getByTestId('ai-more-actions-open').click()
    await expect(moreActionsMenu).toHaveCount(0)

    const restoredSessionResult = await page.evaluate(async ({ projectRoot, runId }) => {
      const api = (window as unknown as {
        aiops: {
          publishAiAgentSessionEvent: (input: Record<string, unknown>) => Promise<{ ok: boolean; errorMessage?: string }>
        }
      }).aiops
      return api.publishAiAgentSessionEvent({
        source: 'qoder',
        event: 'session_start',
        sessionId: `restored-project-files-${runId}`,
        cwd: projectRoot,
        title: 'Restored project files E2E',
        summary: 'Historical session without a live terminal',
        receivedAt: Date.now()
      })
    }, { projectRoot, runId })
    if (!restoredSessionResult.ok) {
      throw new Error(restoredSessionResult.errorMessage || 'Unable to publish restorable managed AI session.')
    }

    await page.locator('.side-rail .rail-button[title="AI 会话"]').click()
    const restoredSessionRow = page.locator('.ai-session-row').filter({
      has: page.locator('.ai-session-row-title').getByText('Restored project files E2E', { exact: true })
    })
    await expect(restoredSessionRow).toBeVisible()
    await restoredSessionRow.dblclick()
    await expect(page.locator('.terminal-pane.active .xterm-host')).toBeVisible()
    const restoredToggle = page.getByTestId('ai-project-files-toggle')
    await expect(restoredToggle).toBeVisible()
    await restoredToggle.click()
    const restoredDrawer = page.locator('.project-files-drawer')
    await expect(restoredDrawer.locator('.project-files-header-title strong')).toHaveText(path.basename(projectRoot))
    await restoredDrawer.getByTestId('project-files-close').click()

    await page.locator('.side-rail .rail-button[data-module-key="workspace"]').click()
    await page.locator('.workspace-search input').fill('127.0.0.1')
    const localRow = page.locator('.workspace-host-row').filter({ hasText: '127.0.0.1' }).first()
    await expect(localRow).toBeVisible()
    await localRow.dblclick()
    await expect(page.locator('.terminal-pane.active .xterm-host')).toBeVisible()

    const activeTerminalTab = page.locator('.terminal-tab.active')
    await expect(activeTerminalTab).toHaveAttribute('data-terminal-session-id', /.+/)
    const firstTerminal = {
      terminalSessionId: await activeTerminalTab.getAttribute('data-terminal-session-id') || '',
      panelId: await activeTerminalTab.getAttribute('data-panel-id') || ''
    }
    const firstResult = await page.evaluate(async ({ projectRoot, runId, terminal }) => {
      const api = (window as unknown as {
        aiops: {
          publishAiAgentSessionEvent: (input: Record<string, unknown>) => Promise<{ ok: boolean; errorMessage?: string }>
        }
      }).aiops
      return api.publishAiAgentSessionEvent({
        source: 'codex',
        event: 'session_start',
        sessionId: `project-files-${runId}`,
        terminalSessionId: terminal.terminalSessionId,
        panelId: terminal.panelId,
        cwd: projectRoot,
        title: 'Project files E2E',
        summary: 'Project files E2E',
        receivedAt: Date.now()
      })
    }, { projectRoot, runId, terminal: firstTerminal })
    if (!firstResult.ok) throw new Error(firstResult.errorMessage || 'Unable to publish managed AI session.')

    await page.locator('.side-rail .rail-button[title="AI 会话"]').click()
    const sessionRow = page.locator('.ai-session-row').filter({
      has: page.locator('.ai-session-row-title').getByText('Project files E2E', { exact: true })
    })
    await expect(sessionRow).toBeVisible()
    await sessionRow.click()
    await page.locator('.side-rail .rail-button[data-module-key="workspace"]').click()
    await page.locator(`.terminal-tab[data-panel-id="${firstTerminal.panelId}"]`).click()

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

    await page.locator('.side-rail .rail-button[data-module-key="assets"]').click()
    await expect(page.locator('.right-assistant-panel')).toHaveCount(0)
    await page.locator('.side-rail .rail-button[data-module-key="workspace"]').click()
    await page.locator(`.terminal-tab[data-panel-id="${firstTerminal.panelId}"]`).click()
    await expect(drawer).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    const panelBox = await page.locator('.right-assistant-panel').boundingBox()
    const aiBox = await page.locator('.ai-panel').boundingBox()
    const headerBox = await page.locator('.ai-header').boundingBox()
    const drawerBox = await drawer.boundingBox()
    expect(panelBox?.y).toBe(aiBox?.y)
    expect(drawerBox!.y).toBeGreaterThan(headerBox!.y + headerBox!.height)

    await drawer.locator('.project-files-tree-row').filter({ hasText: 'src' }).click()
    const mainFileRow = drawer.locator('.project-files-tree-row').filter({ hasText: 'main.ts' })
    await expect(mainFileRow).toBeVisible()
    await mainFileRow.click({ button: 'right' })
    const projectFileContextMenu = page.locator('.project-files-context-menu')
    await expect(projectFileContextMenu).toBeVisible()
    await expect(projectFileContextMenu.getByRole('menuitem', { name: '重命名' })).toBeVisible()
    await expect(projectFileContextMenu.getByRole('menuitem', { name: '删除' })).toBeVisible()
    await expect(projectFileContextMenu.getByRole('menuitem', { name: '复制相对路径' })).toBeVisible()
    await expect(projectFileContextMenu.getByRole('menuitem', { name: '复制绝对路径' })).toBeVisible()
    await projectFileContextMenu.getByRole('menuitem', { name: '复制相对路径' }).click()
    await expect(drawer.locator('.project-files-notice')).toHaveText('已复制相对路径')
    await expect(drawer).toBeVisible()
    const originalDrawerElement = await drawer.elementHandle()
    await mainFileRow.dblclick()

    const projectEditor = page.locator('.project-file-editor')
    const monacoEditor = projectEditor.locator('.files-monaco-editor')
    await expect(projectEditor).toBeVisible()
    expect(await originalDrawerElement!.evaluate((element) => element.isConnected)).toBe(true)
    await expect(monacoEditor).toHaveClass(/monaco-ready/)
    const projectFileTab = page.locator('.terminal-tab.active')
    await expect(projectFileTab.locator('.terminal-tab-kind')).toHaveCount(0)
    await expect(projectFileTab.locator('.terminal-tab-icon')).toHaveAttribute('data-terminal-tab-kind', 'project-file')
    const [projectFileIconBox, projectFileCloseBox] = await Promise.all([
      projectFileTab.locator('.terminal-tab-icon').boundingBox(),
      projectFileTab.locator('.terminal-tab-close').boundingBox()
    ])
    expect(projectFileIconBox!.x + projectFileIconBox!.width).toBeLessThan(projectFileCloseBox!.x)
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
    await expect(projectEditor.locator('footer')).toContainText('已保存')
    const recentMainFileRow = drawer.locator('.project-files-recent-row').filter({ hasText: 'main.ts' }).first()
    await expect(recentMainFileRow).toBeVisible()
    await recentMainFileRow.click({ button: 'right' })
    await expect(projectFileContextMenu.getByRole('menuitem', { name: '重命名' })).toBeVisible()
    await expect(projectFileContextMenu.getByRole('menuitem', { name: '删除' })).toBeVisible()
    await expect(projectFileContextMenu.getByRole('menuitem', { name: '复制相对路径' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeVisible()

    await projectEditor.locator('.view-lines').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('// local pending\n')
    await writeFile(path.join(projectRoot, 'src', 'main.ts'), 'export const agent = true\n', 'utf8')
    await expect(projectEditor.locator('.project-file-conflict')).toBeVisible()
    await expect(projectEditor.locator('footer')).toContainText('存在冲突')
    await page.waitForTimeout(1200)
    await expect.poll(() => readFile(path.join(projectRoot, 'src', 'main.ts'), 'utf8')).toBe('export const agent = true\n')
    await projectEditor.getByRole('button', { name: '从磁盘重新加载' }).click()
    await expect(projectEditor.locator('.project-file-conflict')).toHaveCount(0)

    await drawer.getByTestId('project-files-create-root').click()
    let mutationDialog = page.locator('.project-files-dialog')
    const mutationDialogBox = await mutationDialog.boundingBox()
    const viewportSize = page.viewportSize()!
    expect(mutationDialogBox!.x).toBeGreaterThanOrEqual(8)
    expect(mutationDialogBox!.y).toBeGreaterThanOrEqual(8)
    expect(mutationDialogBox!.x + mutationDialogBox!.width).toBeLessThanOrEqual(viewportSize.width - 8)
    expect(mutationDialogBox!.y + mutationDialogBox!.height).toBeLessThanOrEqual(viewportSize.height - 8)
    await mutationDialog.locator('input').fill('scratch.ts')
    await mutationDialog.getByRole('button', { name: '创建', exact: true }).click()
    await expect.poll(() => readFile(path.join(projectRoot, 'scratch.ts'), 'utf8')).toBe('')
    await expect(projectEditor.locator('header')).toContainText('scratch.ts')

    let scratchRow = drawer.locator('.project-files-tree-row').filter({ hasText: 'scratch.ts' })
    await expect(scratchRow).toBeVisible()
    await scratchRow.click({ button: 'right' })
    await projectFileContextMenu.getByRole('menuitem', { name: '重命名' }).click()
    mutationDialog = page.locator('.project-files-dialog')
    await mutationDialog.locator('input').fill('renamed.ts')
    await mutationDialog.getByRole('button', { name: '重命名', exact: true }).click()
    await expect.poll(() => readFile(path.join(projectRoot, 'renamed.ts'), 'utf8')).toBe('')

    const renamedRow = drawer.locator('.project-files-tree-row').filter({ hasText: 'renamed.ts' })
    await expect(renamedRow).toBeVisible()
    await renamedRow.click({ button: 'right' })
    await projectFileContextMenu.getByRole('menuitem', { name: '删除' }).click()
    mutationDialog = page.locator('.project-files-dialog')
    await mutationDialog.getByRole('button', { name: '删除', exact: true }).click()
    await expect.poll(async () => readFile(path.join(projectRoot, 'renamed.ts'), 'utf8').then(() => true).catch(() => false)).toBe(false)
    await expect(renamedRow).toHaveCount(0)

    const capturePath = process.env.AIOPSTERM_PROJECT_FILES_CAPTURE
    if (capturePath) await page.screenshot({ path: capturePath })

    const publishSessionSwitch = async (input: Record<string, unknown>) => {
      const result = await page.evaluate(async (eventInput) => {
        const api = (window as unknown as {
          aiops: {
            publishAiAgentSessionEvent: (input: Record<string, unknown>) => Promise<{ ok: boolean; errorMessage?: string }>
          }
        }).aiops
        return api.publishAiAgentSessionEvent(eventInput)
      }, input)
      if (!result.ok) throw new Error(result.errorMessage || 'Unable to switch the managed AI session.')
    }

    await page.locator(`.terminal-tab[data-panel-id="${firstTerminal.panelId}"]`).click()
    await publishSessionSwitch({
      source: 'codex',
      event: 'session_start',
      sessionId: `project-files-second-${runId}`,
      terminalSessionId: firstTerminal.terminalSessionId,
      panelId: firstTerminal.panelId,
      cwd: secondProjectRoot,
      title: 'Second project files E2E',
      summary: 'Second project files E2E',
      receivedAt: Date.now()
    })
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('.project-files-header-title strong')).toHaveText(path.basename(secondProjectRoot))
    await expect(drawer.locator('.project-files-tree-row').filter({ hasText: 'lib' })).toBeVisible()

    await drawer.getByTestId('project-files-close').click()
    await expect(drawer).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await toggle.click()
    await expect(drawer).toBeVisible()
    await publishSessionSwitch({
      source: 'codex',
      event: 'session_start',
      sessionId: `project-files-ineligible-${runId}`,
      terminalSessionId: firstTerminal.terminalSessionId,
      panelId: firstTerminal.panelId,
      cwd: path.join(secondProjectRoot, 'missing'),
      title: 'Ineligible project files E2E',
      summary: 'Ineligible project files E2E',
      receivedAt: Date.now()
    })
    await expect(page.getByTestId('ai-project-files-toggle')).toHaveCount(0)
    await expect(drawer).toHaveCount(0)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
    await rm(projectRoot, { recursive: true, force: true })
    await rm(secondProjectRoot, { recursive: true, force: true })
  }
})
