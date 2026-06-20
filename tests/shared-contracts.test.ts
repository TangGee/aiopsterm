import { describe, expect, it } from 'vitest'
import type {
  CodexSessionCreateOptions as CodexSessionCreateOptionsContract,
  CodexSessionLifecycleEvent as CodexSessionLifecycleEventContract,
  CodexSessionTargetUpdateResult as CodexSessionTargetUpdateResultContract
} from '../src/shared/contracts/codexSessions'
import type {
  CodexSessionCreateOptions as CodexSessionCreateOptionsPreload,
  CodexSessionLifecycleEvent as CodexSessionLifecycleEventPreload,
  CodexSessionTargetUpdateResult as CodexSessionTargetUpdateResultPreload
} from '../src/shared/preload'
import type {
  TerminalCreateOptions as TerminalCreateOptionsContract,
  TerminalKeyboardInteractiveRequest as TerminalKeyboardInteractiveRequestContract,
  TerminalLifecycleEvent as TerminalLifecycleEventContract,
  TerminalWriteResult as TerminalWriteResultContract
} from '../src/shared/contracts/terminalSessions'
import type {
  TerminalCreateOptions as TerminalCreateOptionsPreload,
  TerminalKeyboardInteractiveRequest as TerminalKeyboardInteractiveRequestPreload,
  TerminalLifecycleEvent as TerminalLifecycleEventPreload,
  TerminalWriteResult as TerminalWriteResultPreload
} from '../src/shared/preload'
import type {
  AiopsAssetImportPreviewResult as AiopsAssetImportPreviewResultContract,
  AiopsAssetInput as AiopsAssetInputContract,
  AiopsAssetSnapshot as AiopsAssetSnapshotContract,
  AiopsSshTunnelMutationResult as AiopsSshTunnelMutationResultContract
} from '../src/shared/contracts/assets'
import type {
  AiopsAssetImportPreviewResult as AiopsAssetImportPreviewResultPreload,
  AiopsAssetInput as AiopsAssetInputPreload,
  AiopsAssetSnapshot as AiopsAssetSnapshotPreload,
  AiopsSshTunnelMutationResult as AiopsSshTunnelMutationResultPreload
} from '../src/shared/preload'

type AssertAssignable<From, To extends From> = true

type CodexCreateOptionsPreloadMatchesContract = AssertAssignable<CodexSessionCreateOptionsContract, CodexSessionCreateOptionsPreload>
type CodexCreateOptionsContractMatchesPreload = AssertAssignable<CodexSessionCreateOptionsPreload, CodexSessionCreateOptionsContract>
type CodexLifecyclePreloadMatchesContract = AssertAssignable<CodexSessionLifecycleEventContract, CodexSessionLifecycleEventPreload>
type CodexLifecycleContractMatchesPreload = AssertAssignable<CodexSessionLifecycleEventPreload, CodexSessionLifecycleEventContract>
type CodexTargetUpdatePreloadMatchesContract = AssertAssignable<CodexSessionTargetUpdateResultContract, CodexSessionTargetUpdateResultPreload>
type CodexTargetUpdateContractMatchesPreload = AssertAssignable<CodexSessionTargetUpdateResultPreload, CodexSessionTargetUpdateResultContract>
type TerminalCreateOptionsPreloadMatchesContract = AssertAssignable<TerminalCreateOptionsContract, TerminalCreateOptionsPreload>
type TerminalCreateOptionsContractMatchesPreload = AssertAssignable<TerminalCreateOptionsPreload, TerminalCreateOptionsContract>
type TerminalLifecyclePreloadMatchesContract = AssertAssignable<TerminalLifecycleEventContract, TerminalLifecycleEventPreload>
type TerminalLifecycleContractMatchesPreload = AssertAssignable<TerminalLifecycleEventPreload, TerminalLifecycleEventContract>
type TerminalKeyboardInteractivePreloadMatchesContract = AssertAssignable<
  TerminalKeyboardInteractiveRequestContract,
  TerminalKeyboardInteractiveRequestPreload
>
type TerminalKeyboardInteractiveContractMatchesPreload = AssertAssignable<
  TerminalKeyboardInteractiveRequestPreload,
  TerminalKeyboardInteractiveRequestContract
>
type TerminalWriteResultPreloadMatchesContract = AssertAssignable<TerminalWriteResultContract, TerminalWriteResultPreload>
type TerminalWriteResultContractMatchesPreload = AssertAssignable<TerminalWriteResultPreload, TerminalWriteResultContract>
type AssetInputPreloadMatchesContract = AssertAssignable<AiopsAssetInputContract, AiopsAssetInputPreload>
type AssetInputContractMatchesPreload = AssertAssignable<AiopsAssetInputPreload, AiopsAssetInputContract>
type AssetSnapshotPreloadMatchesContract = AssertAssignable<AiopsAssetSnapshotContract, AiopsAssetSnapshotPreload>
type AssetSnapshotContractMatchesPreload = AssertAssignable<AiopsAssetSnapshotPreload, AiopsAssetSnapshotContract>
type AssetImportPreviewPreloadMatchesContract = AssertAssignable<AiopsAssetImportPreviewResultContract, AiopsAssetImportPreviewResultPreload>
type AssetImportPreviewContractMatchesPreload = AssertAssignable<AiopsAssetImportPreviewResultPreload, AiopsAssetImportPreviewResultContract>
type SshTunnelMutationPreloadMatchesContract = AssertAssignable<AiopsSshTunnelMutationResultContract, AiopsSshTunnelMutationResultPreload>
type SshTunnelMutationContractMatchesPreload = AssertAssignable<AiopsSshTunnelMutationResultPreload, AiopsSshTunnelMutationResultContract>

describe('shared contract compatibility exports', () => {
  it('keeps Codex session contracts compatible through the preload export', () => {
    const checks: [
      CodexCreateOptionsPreloadMatchesContract,
      CodexCreateOptionsContractMatchesPreload,
      CodexLifecyclePreloadMatchesContract,
      CodexLifecycleContractMatchesPreload,
      CodexTargetUpdatePreloadMatchesContract,
      CodexTargetUpdateContractMatchesPreload
    ] = [true, true, true, true, true, true]

    expect(checks).toEqual([true, true, true, true, true, true])
  })

  it('keeps terminal session contracts compatible through the preload export', () => {
    const checks: [
      TerminalCreateOptionsPreloadMatchesContract,
      TerminalCreateOptionsContractMatchesPreload,
      TerminalLifecyclePreloadMatchesContract,
      TerminalLifecycleContractMatchesPreload,
      TerminalKeyboardInteractivePreloadMatchesContract,
      TerminalKeyboardInteractiveContractMatchesPreload,
      TerminalWriteResultPreloadMatchesContract,
      TerminalWriteResultContractMatchesPreload
    ] = [true, true, true, true, true, true, true, true]

    expect(checks).toEqual([true, true, true, true, true, true, true, true])
  })

  it('keeps asset contracts compatible through the preload export', () => {
    const checks: [
      AssetInputPreloadMatchesContract,
      AssetInputContractMatchesPreload,
      AssetSnapshotPreloadMatchesContract,
      AssetSnapshotContractMatchesPreload,
      AssetImportPreviewPreloadMatchesContract,
      AssetImportPreviewContractMatchesPreload,
      SshTunnelMutationPreloadMatchesContract,
      SshTunnelMutationContractMatchesPreload
    ] = [true, true, true, true, true, true, true, true]

    expect(checks).toEqual([true, true, true, true, true, true, true, true])
  })
})
