import type { ProjectDirectoryEntry } from '@shared/contracts/projectFiles'

const normalizedParts = (value: string) => value.replaceAll('\\', '/').split('/').filter(Boolean)

export const projectRelativeBasename = (relativePath: string) => normalizedParts(relativePath).at(-1) || ''

export const projectRelativeDirname = (relativePath: string) => normalizedParts(relativePath).slice(0, -1).join('/')

export const joinProjectRelativePath = (directory: string, name: string) =>
  [...normalizedParts(directory), ...normalizedParts(name)].join('/')

export const projectAbsolutePath = (projectRoot: string, relativePath: string) => {
  const windowsStyle = projectRoot.includes('\\')
  const separator = windowsStyle ? '\\' : '/'
  const windowsDriveRoot = windowsStyle && /^[A-Za-z]:\\+$/.test(projectRoot)
  const root = windowsDriveRoot
    ? `${projectRoot.slice(0, 2)}\\`
    : windowsStyle
      ? projectRoot.replace(/\\+$/, '') || projectRoot
      : projectRoot === '/' ? '/' : projectRoot.replace(/\/+$/, '') || '/'
  const relative = normalizedParts(relativePath).join(separator)
  if (!relative) return root
  const rootSeparator = root.endsWith(separator) ? '' : separator
  return `${root}${rootSeparator}${relative}`
}

export const projectMoveTargetPath = (entry: ProjectDirectoryEntry, targetDirectory: string) =>
  joinProjectRelativePath(targetDirectory, entry.name)

export const invalidProjectMove = (entry: ProjectDirectoryEntry, targetDirectory: string) => {
  const sourceDirectory = projectRelativeDirname(entry.relativePath)
  if (sourceDirectory === targetDirectory) return true
  if (entry.type !== 'directory') return false
  return targetDirectory === entry.relativePath || targetDirectory.startsWith(`${entry.relativePath}/`)
}

export const remapProjectPath = (
  currentPath: string,
  previousPath: string,
  nextPath: string,
  entryType: ProjectDirectoryEntry['type']
) => {
  if (currentPath === previousPath) return nextPath
  if (entryType !== 'directory' || !currentPath.startsWith(`${previousPath}/`)) return currentPath
  return `${nextPath}${currentPath.slice(previousPath.length)}`
}
