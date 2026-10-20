import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './support/desktop'

test('sparse file lists accept drops throughout the remaining panel @files', async ({ desktop }, info) => {
  const destination = join(desktop.root, 'dropped-file-folder')
  await mkdir(destination)
  const droppedPath = join(destination, 'dropped.txt')
  await writeFile(droppedPath, 'drop target probe')
  await desktop.page.locator('[data-module-key="files"]').click()
  const browser = desktop.page.locator('.files-transfer-side').nth(1).locator('.file-browser')
  const pathInput = browser.locator('.file-path-input')
  await expect(pathInput).toBeVisible()

  for (const count of [0, 2]) {
    const directory = join(desktop.root, `entries-${count}`)
    await mkdir(directory)
    for (let index = 0; index < count; index++) {
      await writeFile(join(directory, `entry-${index}.txt`), 'fixture')
    }
    await pathInput.fill(directory)
    await pathInput.press('Enter')
    // Include the parent directory row, and wait for the actual filesystem result.
    await expect(browser.locator('tbody tr[data-path]')).toHaveCount(count + 1)
    await expect(browser.locator('.file-error')).toHaveCount(0)
    await expect(browser.locator('.file-browser-notice')).toHaveCount(0)

    const geometry = await browser.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const zone = element.querySelector('.file-drop-zone')!
      const table = element.querySelector('.file-table')!.getBoundingClientRect()
      const point = { x: bounds.left + bounds.width / 2, y: bounds.bottom - 24 }
      return {
        point,
        belowTable: point.y > table.bottom,
        insideDropZone: zone.contains(document.elementFromPoint(point.x, point.y))
      }
    })
    await info.attach(`entries-${count}`, { body: await browser.screenshot(), contentType: 'image/png' })
    expect(geometry.belowTable).toBe(true)
    expect(geometry.insideDropZone, 'Blank space below the rows must accept file drops').toBe(true)

    // Dispatch at the hit-tested blank space, not directly at the drop listener.
    await desktop.page.evaluate(({ point, droppedPath }) => {
      const target = document.elementFromPoint(point.x, point.y)!
      const dataTransfer = new DataTransfer()
      const file = new File(['drop target probe'], 'dropped.txt')
      Object.defineProperty(file, 'path', { value: droppedPath })
      dataTransfer.items.add(file)
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, dataTransfer, clientX: point.x, clientY: point.y
        }))
      }
    }, { point: geometry.point, droppedPath })
    // Local OS drops open the source directory through the real filesystem backend.
    await expect(pathInput).toHaveValue(destination)
    await expect(browser.locator('tbody')).toContainText('dropped.txt')
  }
})
