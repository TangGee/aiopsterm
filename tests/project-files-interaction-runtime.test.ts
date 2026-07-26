import { describe, expect, it } from 'vitest'
import {
  invalidProjectMove,
  joinProjectRelativePath,
  projectAbsolutePath,
  projectMoveTargetPath,
  projectRelativeBasename,
  projectRelativeDirname,
  remapProjectPath
} from '@/services/files/projectFilesInteractionRuntime'
import type { ProjectDirectoryEntry } from '@shared/contracts/projectFiles'

const entry = (
  relativePath: string,
  type: ProjectDirectoryEntry['type'] = 'file'
): ProjectDirectoryEntry => ({
  name: projectRelativeBasename(relativePath),
  relativePath,
  type,
  size: 0,
  modifiedAt: 0
})

describe('project files interaction runtime', () => {
  it('builds relative and absolute project paths across platforms', () => {
    expect(projectRelativeBasename('src/nested/app.ts')).toBe('app.ts')
    expect(projectRelativeDirname('src/nested/app.ts')).toBe('src/nested')
    expect(joinProjectRelativePath('src/nested', 'app.ts')).toBe('src/nested/app.ts')
    expect(projectAbsolutePath('/work/project/', 'src/app.ts')).toBe('/work/project/src/app.ts')
    expect(projectAbsolutePath('C:\\work\\project\\', 'src/app.ts')).toBe('C:\\work\\project\\src\\app.ts')
  })

  it('derives move targets and rejects no-op and recursive directory moves', () => {
    const file = entry('src/app.ts')
    const directory = entry('src/nested', 'directory')
    expect(projectMoveTargetPath(file, 'target')).toBe('target/app.ts')
    expect(invalidProjectMove(file, 'src')).toBe(true)
    expect(invalidProjectMove(file, 'target')).toBe(false)
    expect(invalidProjectMove(directory, 'src/nested')).toBe(true)
    expect(invalidProjectMove(directory, 'src/nested/child')).toBe(true)
    expect(invalidProjectMove(directory, 'target')).toBe(false)
  })

  it('remaps open files after file and directory mutations', () => {
    expect(remapProjectPath('src/app.ts', 'src/app.ts', 'src/main.ts', 'file')).toBe('src/main.ts')
    expect(remapProjectPath('src/nested/app.ts', 'src', 'lib', 'directory')).toBe('lib/nested/app.ts')
    expect(remapProjectPath('other/app.ts', 'src', 'lib', 'directory')).toBe('other/app.ts')
  })
})
