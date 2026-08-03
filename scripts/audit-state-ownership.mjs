import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const sourceFiles = execFileSync('git', ['ls-files', 'src/renderer/src', 'src/main', 'src/shared'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => /\.(ts|vue)$/.test(file))

const protectedWorkspaceFields = [
  'activePanelId',
  'panels',
  'mode',
  'activeModule',
  'leftPanelOpen',
  'rightPanelOpen',
  'selectedContexts',
  'selectedManagedAiSessionKey',
  'selectedSnippetGroupUuid',
  'snippetSearchQuery',
  'kbExpandedKeys',
  'kbSelectedKeys',
  'kbSearchQuery',
  'extensionDetailTab'
]
const protectedWorkspacePattern = protectedWorkspaceFields.join('|')
const directWorkspaceWrite = new RegExp(`\\bworkspace\\.(${protectedWorkspacePattern})\\s*=(?!=)`)
const directWorkspaceModel = new RegExp(`v-model(?:\\:[^=]+)?=["']workspace\\.(${protectedWorkspacePattern})["']`)
const directActivePanelRefWrite = /\bactivePanelId\.value\s*=(?!=)/
const activePanelOwner = 'src/renderer/src/services/workspace/workspacePanelNavigationRuntime.ts'
const exportedMutableContainer = /^\s*export\s+(?:const|let|var)\s+\w+(?![^=]*Readonly(?:Map|Set))[^=]*=\s*new\s+(?:Map|Set|WeakMap|WeakSet)\b/
const exportedMutableBinding = /^\s*export\s+(?:let|var)\s+\w+/

const findings = []
for (const file of sourceFiles) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (file.startsWith('src/renderer/src/')) {
      if (directWorkspaceWrite.test(line)) findings.push(`${file}:${index + 1}: direct workspace state write`)
      if (directWorkspaceModel.test(line)) findings.push(`${file}:${index + 1}: direct workspace v-model binding`)
      if (file !== activePanelOwner && directActivePanelRefWrite.test(line)) {
        findings.push(`${file}:${index + 1}: activePanelId writer outside navigation owner`)
      }
    }
    if ((file.startsWith('src/main/') || file.startsWith('src/shared/')) && exportedMutableContainer.test(line)) {
      findings.push(`${file}:${index + 1}: exported mutable container`)
    }
    if ((file.startsWith('src/main/') || file.startsWith('src/shared/')) && exportedMutableBinding.test(line)) {
      findings.push(`${file}:${index + 1}: exported mutable binding`)
    }
  })
}

if (findings.length) {
  console.error('State ownership audit failed:')
  console.error(findings.join('\n'))
  process.exit(1)
}

console.log(`State ownership audit passed (${sourceFiles.length} files checked).`)
