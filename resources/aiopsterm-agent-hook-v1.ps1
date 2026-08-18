[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Runtime,
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Event,
  [switch]$WaitDecision
)

$env:ELECTRON_RUN_AS_NODE = '1'
$env:AIOPSTERM_AGENT_HOOK_MARKER = 'aiopsterm-agent-hook-v1'

try {
  $payload = [Console]::In.ReadToEnd()
  $hookArgs = @($Script, '--source', $Source, '--event', $Event)
  if ($WaitDecision) {
    $hookArgs += @('--wait-decision', '--wait-timeout-ms', '120000')
  }

  if ($payload) {
    $output = $payload | & $Runtime @hookArgs
  } else {
    $output = & $Runtime @hookArgs
  }
  $hookExitCode = $LASTEXITCODE
  if ($null -ne $output) {
    $output | Write-Output
  }
  if ($hookExitCode -ne 0) {
    Write-Output '{}'
  }
} catch {
  Write-Output '{}'
}

exit 0
