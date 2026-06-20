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

type AssertAssignable<From, To extends From> = true

type CodexCreateOptionsPreloadMatchesContract = AssertAssignable<CodexSessionCreateOptionsContract, CodexSessionCreateOptionsPreload>
type CodexCreateOptionsContractMatchesPreload = AssertAssignable<CodexSessionCreateOptionsPreload, CodexSessionCreateOptionsContract>
type CodexLifecyclePreloadMatchesContract = AssertAssignable<CodexSessionLifecycleEventContract, CodexSessionLifecycleEventPreload>
type CodexLifecycleContractMatchesPreload = AssertAssignable<CodexSessionLifecycleEventPreload, CodexSessionLifecycleEventContract>
type CodexTargetUpdatePreloadMatchesContract = AssertAssignable<CodexSessionTargetUpdateResultContract, CodexSessionTargetUpdateResultPreload>
type CodexTargetUpdateContractMatchesPreload = AssertAssignable<CodexSessionTargetUpdateResultPreload, CodexSessionTargetUpdateResultContract>

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
})
