import { test, expect } from './support/desktop'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('native Linux chooser imports extensionless private keys from the hidden SSH directory @core', async ({ desktop }, info) => {
  test.skip(process.platform !== 'linux', 'Exercises the Linux native GTK file chooser through X11.')
  const directory = join(desktop.root, 'home', '.ssh')
  await mkdir(directory, { recursive: true })
  const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\ntest-only-private-fixture\n-----END OPENSSH PRIVATE KEY-----'
  for (const name of ['id_ed25519', 'id_rsa', '.hidden_key']) {
    await writeFile(join(directory, name), privateKey, { mode: 0o600 })
  }
  await writeFile(join(directory, 'id_ed25519.pub'), 'ssh-ed25519 test-only-public-fixture', { mode: 0o644 })
  await desktop.restart({
    AIOPSTERM_E2E_DIALOG_FIXTURES: '0',
    // Use GTK in the isolated X11 display, without opening a portal window
    // on the developer's real desktop or depending on a CI desktop service.
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + join(desktop.root, 'missing-session-bus')
  })
  await desktop.page.locator('[data-module-key="assets"]').click()
  await desktop.page.locator('.asset-workspace-tab').filter({ hasText: '密钥管理' }).click()
  for (const name of ['id_ed25519', 'id_rsa', '.hidden_key']) {
    await desktop.page.getByTestId('key-new-button').click()
    await desktop.page.locator('.key-drop-area').click()
    await desktop.page.waitForTimeout(700)
    const image = await desktop.app.evaluate(async ({ desktopCapturer }) => {
      const [screen] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 1024 } })
      return screen.thumbnail.toPNG().toString('base64')
    })
    await info.attach('native-chooser-' + name, { body: Buffer.from(image, 'base64'), contentType: 'image/png' })
    await promisify(execFile)('python3', [resolve('tests/regression/support/native-keyboard.py'), name], { timeout: 5000 })
    const form = desktop.page.getByTestId('asset-key-form-dialog')
    await expect(form.locator('label').filter({ hasText: '私钥' }).locator('textarea')).toHaveValue(privateKey)
    await expect(form.locator('label').filter({ hasText: '公钥' }).locator('textarea')).toHaveValue('')
    await expect(form).toContainText('已导入 ' + name)
    await form.getByRole('button', { name: '取消', exact: true }).click()
  }
  expect(desktop.errors).toEqual([])
})
