import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeBinarySha256 } from './native-binary-integrity.mjs'

const NODE_VERSION = '22.20.0'
const NODE_LICENSE_SHA256 = 'e991d81497a85bb24fc6bffae0a3637a6accd6c6bc5ce1f2c5698bd555cf9d49'
const REFERENCE_TREE_PREFIX = ['external-reference', ''].join('/')
const NODE_RUNTIME_PACKAGES = {
  'linux:x64': 'node-linux-x64',
  'linux:arm64': 'node-linux-arm64',
  'darwin:x64': 'node-darwin-x64',
  'darwin:arm64': 'node-bin-darwin-arm64',
  'win32:x64': 'node-win-x64',
  'win32:arm64': 'node-win-arm64'
}
const NODE_RUNTIME_INTEGRITIES = {
  'node-linux-x64': 'sha512-CWyKqAkT1fUBr1IDD/JhDAYpUrBraNmSM9ndREbhAp14QmgBqq8CmgWHITSK1YXzJj+hWTEC1+F6gOgVFLIaSg==',
  'node-linux-arm64': 'sha512-eVexvODYds5ya11f+1D0r33WVf6BGvoSvofyVYQFMFMytblCCwlgJStpOb4IdomSnfVQWLAt0tNgYE5iXxSRuA==',
  'node-darwin-x64': 'sha512-N/X9n9cQYrQb43cVeEWw3uUwTBAVYO1/RKcfzQmwUSmDJxnYvcBu9eHwwLhfpuhHFZ/1ed1HMAOtQYgpSfSalg==',
  'node-bin-darwin-arm64': 'sha512-3tuBY31BRdJlTmVSqCYBj/05j0LK8Ca/MW+VKzkdhO9KBQESNeVAemtpwMt1qVP/chGHvtlvHkguM1xNopPkcg==',
  'node-win-x64': 'sha512-XhYJs77nWcwBDQy6JaCaguvT31j2aUw3M/mGsI0CgGvsGFpYKC9cGdzLkCnAJyj1AD6pNlDYmL29xIjYe+iAbg==',
  'node-win-arm64': 'sha512-6HvEyE3kqKw7HwIo5GEAnyhbF170pJ0LztRSk/D8LSgctnsU+hYrq6/+jeYObeFVehyBsAobZ6KYExjdA8whrA=='
}
const ALLOWED_LICENSES = new Set(['Apache-2.0', 'BSD-3-Clause', 'ISC', 'MIT'])
const RESTRICTED_PACKAGE_PATTERNS = [
  /^@anthropic-ai\/claude-agent-sdk(?:-|$)/,
  /^@jerome-benoit\/sap-ai-provider$/,
  /^@sap-ai-sdk\//,
  /^@sap\//,
  /^ai-sdk-provider-claude-code$/
]
const RESTRICTED_BUNDLE_MARKERS = [
  '@anthropic-ai/claude-agent-sdk',
  '@jerome-benoit/sap-ai-provider',
  '@sap/xssec',
  'CLAUDE_AGENT_SDK_VERSION',
  'Native CLI binary for linux-x64 not found',
  'SAP DEVELOPER LICENSE AGREEMENT',
  'nodejs-xssec'
]
const PINNED_LICENSE_EVIDENCE = {
  'resources/licenses/cline-sidecar/opencode-LICENSE': '625f0f619133f89bbbb2abe37369613dfa1885eba1e50d02170deb62bb42cb6b',
  'resources/licenses/cline-sidecar/simple-git-LICENSE': '3a31277abe4e0a30eb17dad52addace2fd73580fd9d79d40590e69785fdf71d5'
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = join(root, 'build', 'cline-sidecar')
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
const bundleName = 'cline-agent-sidecar.cjs'
const nodePath = join(outputDir, nodeName)
const bundlePath = join(outputDir, bundleName)
const metafilePath = join(outputDir, 'metafile.json')
const sbomPath = join(outputDir, 'sbom.cdx.json')
const noticesPath = join(outputDir, 'THIRD-PARTY-NOTICES.txt')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const require = createRequire(import.meta.url)
const runtimePackage = NODE_RUNTIME_PACKAGES[`${process.platform}:${process.arch}`]
if (!runtimePackage) throw new Error(`Unsupported Cline sidecar Node runtime target: ${process.platform}/${process.arch}`)
const runtimePackageJsonPath = require.resolve(`${runtimePackage}/package.json`, { paths: [root] })
const runtimePackageDir = dirname(runtimePackageJsonPath)
const runtimePackageJson = JSON.parse(readFileSync(runtimePackageJsonPath, 'utf8'))
const runtimeLock = packageLock.packages?.[`node_modules/${runtimePackage}`]
const bunPath = process.platform === 'win32'
  ? join(root, 'node_modules', 'bun', 'bin', 'bun.exe')
  : join(root, 'node_modules', '.bin', 'bun')
const sourceNodePath = join(runtimePackageDir, runtimePackageJson.bin?.node || `bin/${nodeName}`)
const runtimeNodeLicense = join(runtimePackageDir, 'LICENSE')
const fallbackNodeLicense = join(root, 'resources', 'licenses', 'cline-sidecar', 'node-22.20.0-LICENSE')
const nodeLicense = existsSync(runtimeNodeLicense) ? runtimeNodeLicense : fallbackNodeLicense

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const fileSha256 = (path) => sha256(readFileSync(path))

const normalizePath = (value) => value.split(sep).join('/').replaceAll('\\', '/')

const packageRootFromInput = (inputPath) => {
  const normalized = normalizePath(inputPath)
  const marker = '/node_modules/'
  const markerIndex = normalized.lastIndexOf(marker)
  const packageStart = markerIndex >= 0
    ? markerIndex + marker.length
    : normalized.startsWith('node_modules/')
      ? 'node_modules/'.length
      : -1
  if (packageStart < 0) return null
  const parts = normalized.slice(packageStart).split('/')
  const nameParts = parts[0]?.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)
  if (!nameParts.length || nameParts.some((part) => !part)) return null
  return `${normalized.slice(0, packageStart)}${nameParts.join('/')}`
}

const primaryLicenseFor = (name, rawLicense) => {
  if (typeof rawLicense === 'string' && rawLicense.trim()) return rawLicense.trim()
  if (name.startsWith('@cline/')) return 'Apache-2.0'
  return ''
}

const isLicenseEvidenceFile = (name) =>
  /^(licen[cs]e|copying|notice|copyright|third[-_ ]?party(?:[-_ ]?(?:licenses?|notices?))?)(\..*)?$/i.test(name)

const collectLicenseFiles = (directory, current = directory, files = []) => {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(current, entry.name)
    if (entry.isDirectory()) {
      collectLicenseFiles(directory, path, files)
      continue
    }
    if (!entry.isFile() || !isLicenseEvidenceFile(entry.name)) continue
    if (statSync(path).size > 1024 * 1024) throw new Error(`License evidence is unexpectedly large: ${path}`)
    files.push(path)
  }
  return files
}

const licenseOverridesFor = (name) => {
  if (name.startsWith('@cline/')) return [join(root, 'resources', 'licenses', 'cline', 'LICENSE')]
  if (name === '@ai-sdk/provider-utils') return [join(root, 'node_modules', '@ai-sdk', 'provider', 'LICENSE')]
  if (name.startsWith('@aws-sdk/')) return [join(root, 'node_modules', '@aws-sdk', 'core', 'LICENSE')]
  if (name === '@opencode-ai/sdk') return [join(root, 'resources', 'licenses', 'cline-sidecar', 'opencode-LICENSE')]
  if (name === 'data-uri-to-buffer') return [join(root, 'node_modules', 'data-uri-to-buffer', 'README.md')]
  if (name === 'simple-git' || name.startsWith('@simple-git/')) {
    return [join(root, 'resources', 'licenses', 'cline-sidecar', 'simple-git-LICENSE')]
  }
  return []
}

const packageRepository = (name, value) => {
  const raw = typeof value === 'string'
    ? value.trim()
    : value && typeof value === 'object' && typeof value.url === 'string'
      ? value.url.trim()
      : ''
  if (!raw) return name === '@opencode-ai/sdk' ? 'https://github.com/anomalyco/opencode' : undefined
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) return `https://github.com/${raw}`
  const sshMatch = raw.match(/^git@([^:]+):(.+)$/)
  if (sshMatch) return `ssh://git@${sshMatch[1]}/${sshMatch[2]}`
  const normalized = raw.startsWith('git+') ? raw.slice(4) : raw
  try {
    return new URL(normalized).toString()
  } catch {
    return undefined
  }
}

const createBundleInventory = (metafile) => {
  const packagesByCoordinate = new Map()
  for (const [inputPath, input] of Object.entries(metafile.inputs || {})) {
    const packageRoot = packageRootFromInput(inputPath)
    if (!packageRoot) continue
    const packageJsonPath = join(root, packageRoot, 'package.json')
    if (!existsSync(packageJsonPath)) throw new Error(`Bundled package metadata is missing: ${packageJsonPath}`)
    const metadata = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    const name = String(metadata.name || '').trim()
    const version = String(metadata.version || '').replace(/^v(?=\d)/, '').trim()
    if (!name || !version) throw new Error(`Bundled package has incomplete metadata: ${packageJsonPath}`)
    if (RESTRICTED_PACKAGE_PATTERNS.some((pattern) => pattern.test(name))) {
      throw new Error(`Restricted provider dependency entered the Cline sidecar bundle: ${name}@${version}`)
    }
    const license = primaryLicenseFor(name, metadata.license)
    if (!ALLOWED_LICENSES.has(license)) {
      throw new Error(`Bundled package requires license review: ${name}@${version} (${license || 'missing license'})`)
    }
    const key = `${name}@${version}`
    let component = packagesByCoordinate.get(key)
    if (!component) {
      component = {
        name,
        version,
        license,
        repository: packageRepository(name, metadata.repository),
        roots: new Set(),
        inputFiles: 0,
        inputBytes: 0,
        evidence: new Map()
      }
      packagesByCoordinate.set(key, component)
    }
    component.roots.add(packageRoot)
    component.inputFiles += 1
    component.inputBytes += Number(input?.bytes || 0)
  }

  for (const component of packagesByCoordinate.values()) {
    const evidencePaths = new Set()
    for (const packageRoot of component.roots) {
      for (const path of collectLicenseFiles(join(root, packageRoot))) evidencePaths.add(path)
    }
    for (const path of licenseOverridesFor(component.name)) evidencePaths.add(path)
    if (!evidencePaths.size) {
      throw new Error(`Bundled package has no distributable license evidence: ${component.name}@${component.version}`)
    }
    for (const path of evidencePaths) {
      if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`License evidence is missing: ${path}`)
      const relativePath = normalizePath(relative(root, path))
      const expectedHash = PINNED_LICENSE_EVIDENCE[relativePath]
      if (expectedHash && fileSha256(path) !== expectedHash) {
        throw new Error(`Pinned license evidence changed without review: ${relativePath}`)
      }
      const contents = readFileSync(path, 'utf8').trim()
      if (!contents) throw new Error(`License evidence is empty: ${path}`)
      component.evidence.set(relativePath, contents)
    }
  }
  return [...packagesByCoordinate.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
  )
}

const npmPurl = (name, version) => `pkg:npm/${encodeURIComponent(name).replace('%2F', '/')}@${encodeURIComponent(version)}`

const createThirdPartyNotices = (components) => {
  const evidenceByHash = new Map()
  for (const component of components) {
    for (const [source, contents] of component.evidence) {
      const hash = sha256(contents)
      const evidence = evidenceByHash.get(hash) || { contents, components: new Set(), sources: new Set() }
      evidence.components.add(`${component.name}@${component.version}`)
      evidence.sources.add(source)
      evidenceByHash.set(hash, evidence)
    }
  }
  const lines = [
    'aiopsterm Cline Agent Sidecar - Third-Party Notices',
    '',
    `Generated from the Bun metafile for @cline/sdk ${packageJson.devDependencies?.['@cline/sdk']}.`,
    'The build fails when a bundled npm component has an unknown or non-allowlisted license.',
    'The separately shipped Node runtime license and its complete upstream third-party notices are in NODE-LICENSE.',
    '',
    'Bundled JavaScript Components',
    ''
  ]
  for (const component of components) {
    lines.push(`- ${component.name}@${component.version} | ${component.license}${component.repository ? ` | ${component.repository}` : ''}`)
  }
  for (const [hash, evidence] of [...evidenceByHash].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(
      '',
      '='.repeat(80),
      `License evidence SHA-256: ${hash}`,
      `Components: ${[...evidence.components].sort().join(', ')}`,
      `Sources: ${[...evidence.sources].sort().join(', ')}`,
      '='.repeat(80),
      '',
      evidence.contents,
      ''
    )
  }
  return `${lines.join('\n').trimEnd()}\n`
}

const createSbom = ({ components, builtAt, bundleHash, nodeHash }) => {
  const appRef = 'pkg:generic/aiopsterm-cline-agent-sidecar@0.1.0'
  const nodeRef = npmPurl(runtimePackage, NODE_VERSION)
  const packageComponents = components.map((component) => {
    const purl = npmPurl(component.name, component.version)
    return {
      type: 'library',
      'bom-ref': purl,
      name: component.name,
      version: component.version,
      purl,
      licenses: [{ license: { id: component.license } }],
      ...(component.repository ? { externalReferences: [{ type: 'vcs', url: component.repository }] } : {}),
      properties: [
        { name: 'aiopsterm:bundle:inputFiles', value: String(component.inputFiles) },
        { name: 'aiopsterm:bundle:inputBytes', value: String(component.inputBytes) },
        { name: 'aiopsterm:bundle:packageRoots', value: [...component.roots].sort().join(',') },
        { name: 'aiopsterm:license:evidence', value: [...component.evidence.keys()].sort().join(',') }
      ]
    }
  })
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: builtAt,
      tools: { components: [{ type: 'application', name: 'Bun bundler', version: packageJson.devDependencies?.bun }] },
      component: {
        type: 'application',
        'bom-ref': appRef,
        name: 'aiopsterm-cline-agent-sidecar',
        version: packageJson.version,
        hashes: [{ alg: 'SHA-256', content: bundleHash }]
      }
    },
    components: [
      {
        type: 'framework',
        'bom-ref': nodeRef,
        name: 'Node.js',
        version: NODE_VERSION,
        purl: nodeRef,
        hashes: [{ alg: 'SHA-256', content: nodeHash }],
        licenses: [{ license: { id: 'MIT' } }],
        properties: [
          { name: 'aiopsterm:license:evidence', value: 'NODE-LICENSE' },
          { name: 'aiopsterm:runtime:npmPackage', value: runtimePackage },
          { name: 'aiopsterm:runtime:npmIntegrity', value: runtimeLock.integrity }
        ]
      },
      ...packageComponents
    ],
    dependencies: [{ ref: appRef, dependsOn: [nodeRef, ...packageComponents.map((component) => component['bom-ref'])] }]
  }
}

if (packageJson.optionalDependencies?.[runtimePackage] !== NODE_VERSION) {
  throw new Error(`The sidecar runtime package ${runtimePackage} must stay exact-pinned to ${NODE_VERSION}.`)
}
if (
  String(runtimePackageJson.version || '').replace(/^v(?=\d)/, '') !== NODE_VERSION ||
  runtimeLock?.version !== NODE_VERSION ||
  runtimeLock?.optional !== true ||
  runtimeLock?.integrity !== NODE_RUNTIME_INTEGRITIES[runtimePackage]
) {
  throw new Error(`The sidecar runtime package ${runtimePackage} is not reproducibly locked.`)
}
if (!existsSync(sourceNodePath)) throw new Error(`Pinned Node runtime is missing: ${sourceNodePath}`)
if (!existsSync(nodeLicense) || !readFileSync(nodeLicense, 'utf8').startsWith('Node.js is licensed for use as follows:')) {
  throw new Error(`The Node runtime license and third-party notices are missing from ${runtimePackage}.`)
}
if (nodeLicense === fallbackNodeLicense && fileSha256(nodeLicense) !== NODE_LICENSE_SHA256) {
  throw new Error('The pinned Node runtime license fallback changed without review.')
}
const nodeVersionResult = spawnSync(sourceNodePath, ['--version'], { encoding: 'utf8', shell: false })
if (nodeVersionResult.status !== 0 || nodeVersionResult.stdout.trim() !== `v${NODE_VERSION}`) {
  throw new Error(`Unexpected sidecar Node runtime: ${nodeVersionResult.stdout || nodeVersionResult.stderr}`)
}

rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })

const bundleResult = spawnSync(
  bunPath,
  [
    join(root, 'scripts', 'bundle-cline-sidecar.mjs'),
    join(root, 'src', 'sidecar', 'clineAgentSidecar.ts'),
    bundlePath,
    metafilePath
  ],
  {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, NODE_ENV: 'production' }
  }
)
if (bundleResult.error) throw bundleResult.error
if (bundleResult.status !== 0) throw new Error(`Cline Agent sidecar bundle failed with exit code ${bundleResult.status}`)

const metafile = JSON.parse(readFileSync(metafilePath, 'utf8'))
const inputPaths = Object.keys(metafile.inputs || {}).map(normalizePath)
if (inputPaths.some((path) => path.includes(REFERENCE_TREE_PREFIX))) {
  throw new Error('The Cline sidecar bundle imported the reference-only source tree.')
}
const components = createBundleInventory(metafile)
const bundleText = readFileSync(bundlePath, 'utf8')
for (const marker of RESTRICTED_BUNDLE_MARKERS) {
  if (bundleText.includes(marker)) throw new Error(`Restricted provider implementation marker entered the bundle: ${marker}`)
}

copyFileSync(sourceNodePath, nodePath)
if (process.platform !== 'win32') chmodSync(nodePath, 0o755)
copyFileSync(nodeLicense, join(outputDir, 'NODE-LICENSE'))
copyFileSync(join(root, 'resources', 'licenses', 'cline', 'LICENSE'), join(outputDir, 'CLINE-LICENSE'))
copyFileSync(join(root, 'resources', 'licenses', 'cline', 'ATTRIBUTION.txt'), join(outputDir, 'CLINE-ATTRIBUTION.txt'))
writeFileSync(noticesPath, createThirdPartyNotices(components), 'utf8')

const builtAt = new Date().toISOString()
const bundleHash = fileSha256(bundlePath)
const nodeHash = nativeBinarySha256(nodePath)
const sbom = createSbom({ components, builtAt, bundleHash, nodeHash })
writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8')

const manifest = {
  protocolVersion: 1,
  sdkVersion: packageJson.devDependencies?.['@cline/sdk'],
  nodeVersion: NODE_VERSION,
  runtimePackage,
  runtimePackageIntegrity: runtimeLock.integrity,
  bunBundlerVersion: packageJson.devDependencies?.bun,
  platform: process.platform,
  arch: process.arch,
  runtime: nodeName,
  bundle: bundleName,
  bundleSha256: bundleHash,
  runtimeSha256: nodeHash,
  componentCount: components.length + 1,
  sbom: basename(sbomPath),
  thirdPartyNotices: basename(noticesPath),
  excludedProviders: ['claude-code', 'sapaicore'],
  distributionReady: true,
  builtAt
}
writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(JSON.stringify({ ok: true, outputDir, manifest }))
