export const ubuntu20RuntimeBaseline = { GLIBC: '2.31', GLIBCXX: '3.4.28', CXXABI: '1.3.12' }

const compareVersions = (left, right) => {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0)
    if (difference) return difference
  }
  return 0
}

export const incompatibleLinuxRuntimeVersions = (versionInfo) => {
  const required = versionInfo.split(/Version needs section[^\n]*\n/).slice(1).join('\n')
  const newest = new Map()
  for (const [, family, version] of required.matchAll(/\bName: (GLIBC|GLIBCXX|CXXABI)_(\d+(?:\.\d+)+)\b/g)) {
    if (!newest.has(family) || compareVersions(version, newest.get(family)) > 0) newest.set(family, version)
  }
  return [...newest].filter(([family, version]) => compareVersions(version, ubuntu20RuntimeBaseline[family]) > 0)
    .map(([family, version]) => `${family}_${version}`)
}
