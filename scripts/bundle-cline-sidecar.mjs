const [, , entry, bundlePath, metafilePath] = Bun.argv

if (!entry || !bundlePath || !metafilePath) {
  throw new Error('Usage: bun bundle-cline-sidecar.mjs <entry> <bundle> <metafile>')
}

const disabledProviderModules = new Map([
  [
    'ai-sdk-provider-claude-code',
    'export const createClaudeCode = () => { throw new Error("The Claude Code provider is not included in aiopsterm.") }'
  ],
  [
    '@jerome-benoit/sap-ai-provider',
    'export const createSAPAIProvider = () => { throw new Error("The SAP AI Core provider is not included in aiopsterm.") }'
  ]
])

const providerBoundaryPlugin = {
  name: 'aiopsterm-cline-provider-boundary',
  setup(build) {
    build.onResolve(
      { filter: /^(ai-sdk-provider-claude-code|@jerome-benoit\/sap-ai-provider)$/ },
      ({ path }) => ({ path, namespace: 'aiopsterm-disabled-provider' })
    )
    build.onLoad(
      { filter: /.*/, namespace: 'aiopsterm-disabled-provider' },
      ({ path }) => {
        const contents = disabledProviderModules.get(path)
        if (!contents) throw new Error(`Unexpected disabled provider module: ${path}`)
        return { contents, loader: 'js' }
      }
    )
  }
}

const result = await Bun.build({
  entrypoints: [entry],
  target: 'node',
  format: 'cjs',
  minify: true,
  metafile: true,
  packages: 'bundle',
  define: { 'import.meta.main': 'true' },
  plugins: [providerBoundaryPlugin]
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const entryOutput = result.outputs.find((output) => output.kind === 'entry-point')
if (!entryOutput) throw new Error('Cline sidecar bundle did not produce an entry point.')

await Bun.write(bundlePath, entryOutput)
await Bun.write(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`)
