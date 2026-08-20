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
  # Windows PowerShell 5.1 defaults native stdin/stdout conversion to the
  # console code page and US-ASCII. Hook payloads are UTF-8 JSON, so that
  # conversion can corrupt non-ASCII text and even consume a trailing JSON
  # quote after a multibyte character. Pin both directions before relaying the
  # payload to the Node helper.
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [Console]::OutputEncoding = $utf8NoBom
  $global:OutputEncoding = $utf8NoBom

  # Read bytes from the inherited pipe directly. Console.In may already have
  # cached the legacy Windows code page before this script starts.
  $stdinBytes = New-Object System.IO.MemoryStream
  ([Console]::OpenStandardInput()).CopyTo($stdinBytes)
  $payload = $utf8NoBom.GetString($stdinBytes.ToArray())
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
  if ($env:AIOPSTERM_AGENT_HOOK_DEBUG -eq '1') {
    [Console]::Error.WriteLine($_.Exception.ToString())
  }
  Write-Output '{}'
}

exit 0
