import { readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const collectSourceFiles = (directory) => {
  const files = []
  for (const name of readdirSync(directory)) {
    const file = `${directory}/${name}`
    if (statSync(file).isDirectory()) files.push(...collectSourceFiles(file))
    else if (/\.(ts|vue)$/.test(file)) files.push(file)
  }
  return files
}

let sourceFiles
try {
  sourceFiles = execFileSync('git', ['ls-files', 'src/renderer/src', 'src/main', 'src/shared'], { encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\.(ts|vue)$/.test(file))
} catch {
  sourceFiles = ['src/renderer/src', 'src/main', 'src/shared'].flatMap(collectSourceFiles)
}

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
  'extensionDetailTab',
  'k8sClusterNotice',
  'k8sAddModalOpen',
  'k8sEditModalOpen',
  'k8sAddMode',
  'k8sTestResult'
]
const protectedWorkspacePattern = protectedWorkspaceFields.join('|')
const directWorkspaceWrite = new RegExp(`\\bworkspace\\.(${protectedWorkspacePattern})\\s*=(?!=)`)
const directWorkspaceModel = new RegExp(`v-model(?:\\:[^=]+)?=["']workspace\\.(${protectedWorkspacePattern})["']`)
const directActivePanelRefWrite = /\bactivePanelId\.value\s*=(?!=)/
const directKubernetesStoreWrite = /\bstore\.(k8sClusterNotice|k8sAddModalOpen|k8sEditModalOpen|k8sAddMode|k8sTestResult)\s*=(?!=)/
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
      if (!file.endsWith('src/stores/workspace.ts') && directKubernetesStoreWrite.test(line)) {
        findings.push(`${file}:${index + 1}: direct Kubernetes store state write`)
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
