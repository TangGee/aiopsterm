const projectPathForComparison = (value: string) => {
  const source = value.replace(/\\/g, '/')
  const windowsStyle = /^[a-zA-Z]:(?:\/|$)/.test(source) || source.startsWith('//')
  const drive = source.match(/^([a-zA-Z]:)(?:\/+|$)/)
  const prefix = drive ? `${drive[1]}/` : source.startsWith('//') ? '//' : source.startsWith('/') ? '/' : ''
  const rest = drive
    ? source.slice(drive[0].length)
    : prefix === '//'
      ? source.slice(2)
      : prefix === '/'
        ? source.slice(1)
        : source
  const segments: string[] = []
  for (const segment of rest.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length && segments.at(-1) !== '..') segments.pop()
      else if (!prefix) segments.push(segment)
      continue
    }
    segments.push(segment)
  }
  const normalized = `${prefix}${segments.join('/')}` || (prefix || '.')
  return windowsStyle ? normalized.toLocaleLowerCase('en-US') : normalized
}

export const isProjectCwdWithinRoot = (projectRoot: string, cwd: string) => {
  if (!projectRoot || !cwd) return false
  const root = projectPathForComparison(projectRoot)
  const candidate = projectPathForComparison(cwd)
  if (candidate === root) return true
  const prefix = root.endsWith('/') ? root : `${root}/`
  return candidate.startsWith(prefix)
}
