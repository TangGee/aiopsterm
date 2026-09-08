import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAssetKeyEditorRuntime } from '@/services/assets/assetKeyEditorRuntime'
import type { AiopsKeychainRecord } from '@shared/contracts/assets'

const OPENSSH_PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----'
const OPENSSH_PUBLIC_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI docs@example.com'
const PPK_PRIVATE_KEY = 'PuTTY-User-Key-File-2: ssh-rsa\nEncryption: none\nComment: imported\nPublic-Lines: 2\nAAAA\nPrivate-Lines: 4\nBBBB'

const createRuntime = () => {
  const keychains = ref<AiopsKeychainRecord[]>([])
  const serviceNotice = ref('')
  const runtime = createAssetKeyEditorRuntime({
    keychains,
    serviceNotice,
    refreshKeychains: vi.fn(async () => {})
  })
  runtime.openNewKeyPanel()
  return runtime
}

const installBridge = (bridge: Record<string, unknown>) => {
  ;(window as unknown as { aiops: Record<string, unknown> }).aiops = bridge
}

afterEach(() => {
  ;(window as unknown as { aiops: Record<string, unknown> }).aiops = {}
  vi.restoreAllMocks()
})

describe('assetKeyEditorRuntime key import', () => {
  it('defaults the import dialog to All Files so extensionless OpenSSH keys stay selectable', async () => {
    const showOpenDialog = vi.fn(async (_options?: { filters?: Array<{ name: string }> }) => ({ canceled: true }))
    installBridge({ showOpenDialog })
    const runtime = createRuntime()

    await runtime.openKeyImportDialog()

    const options = showOpenDialog.mock.calls[0]?.[0]
    expect(options?.filters?.[0]?.name).toBe('All Files')
    expect(options?.filters?.some((filter) => filter.name === 'Key Files')).toBe(true)
  })

  it('routes an extensionless OpenSSH private key into the private key field', async () => {
    installBridge({
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/Users/ops/.ssh/id_ed25519'] })),
      readLocalFile: vi.fn(async () => ({ content: OPENSSH_PRIVATE_KEY, mtimeMs: 0, size: OPENSSH_PRIVATE_KEY.length }))
    })
    const runtime = createRuntime()

    await runtime.openKeyImportDialog()

    expect(runtime.keyForm.privateKey).toBe(OPENSSH_PRIVATE_KEY)
    expect(runtime.keyForm.publicKey).toBe('')
    expect(runtime.keyForm.name).toBe('id_ed25519')
    expect(runtime.keyImportNotice.value).toContain('已导入 id_ed25519')
  })

  it('routes a .pub file into the public key field', async () => {
    installBridge({
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/Users/ops/.ssh/id_ed25519.pub'] })),
      readLocalFile: vi.fn(async () => ({ content: OPENSSH_PUBLIC_KEY, mtimeMs: 0, size: OPENSSH_PUBLIC_KEY.length }))
    })
    const runtime = createRuntime()

    await runtime.openKeyImportDialog()

    expect(runtime.keyForm.publicKey).toBe(OPENSSH_PUBLIC_KEY)
    expect(runtime.keyForm.privateKey).toBe('')
  })

  it('treats PuTTY .ppk files as private keys instead of misreading them as public keys', async () => {
    installBridge({
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/Users/ops/keys/putty.ppk'] })),
      readLocalFile: vi.fn(async () => ({ content: PPK_PRIVATE_KEY, mtimeMs: 0, size: PPK_PRIVATE_KEY.length }))
    })
    const runtime = createRuntime()

    await runtime.openKeyImportDialog()

    expect(runtime.keyForm.privateKey).toBe(PPK_PRIVATE_KEY)
    expect(runtime.keyForm.publicKey).toBe('')
  })
})
