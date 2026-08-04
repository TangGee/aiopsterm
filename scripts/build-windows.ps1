[CmdletBinding()]
param(
  [switch]$ChinaMirror,
  [switch]$SkipSetup,
  [switch]$SkipDependencies,
  [switch]$RunTests,
  [switch]$RunE2E,
  [switch]$SetupOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw 'scripts/build-windows.ps1 can only run on Windows.'
}

function Set-BuildSources {
  if ($ChinaMirror) {
    $env:npm_config_registry = 'https://registry.npmmirror.com/'
    $env:npm_config_disturl = 'https://npmmirror.com/mirrors/node'
    $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
    $env:npm_config_electron_mirror = $env:ELECTRON_MIRROR
    $env:npm_config_electron_builder_binaries_mirror = $env:ELECTRON_BUILDER_BINARIES_MIRROR
    $env:AIOPSTERM_ELECTRON_HEADERS_URL = 'https://npmmirror.com/mirrors/electron/'
    $env:RUSTUP_DIST_SERVER = 'https://rsproxy.cn'
    $env:RUSTUP_UPDATE_ROOT = 'https://rsproxy.cn/rustup'
    $env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = 'sparse'
    $env:CARGO_REGISTRIES_CRATES_IO_INDEX = 'sparse+https://rsproxy.cn/index/'
  } else {
    $env:npm_config_registry = 'https://registry.npmjs.org/'
    $env:npm_config_disturl = 'https://nodejs.org/dist'
    Remove-Item Env:ELECTRON_MIRROR -ErrorAction SilentlyContinue
    Remove-Item Env:ELECTRON_BUILDER_BINARIES_MIRROR -ErrorAction SilentlyContinue
    Remove-Item Env:npm_config_electron_mirror -ErrorAction SilentlyContinue
    Remove-Item Env:npm_config_electron_builder_binaries_mirror -ErrorAction SilentlyContinue
    $env:AIOPSTERM_ELECTRON_HEADERS_URL = 'https://artifacts.electronjs.org/headers/dist'
    Remove-Item Env:RUSTUP_DIST_SERVER -ErrorAction SilentlyContinue
    Remove-Item Env:RUSTUP_UPDATE_ROOT -ErrorAction SilentlyContinue
    $env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = 'sparse'
    Remove-Item Env:CARGO_REGISTRIES_CRATES_IO_INDEX -ErrorAction SilentlyContinue
  }
  Remove-Item Env:AIOPSTERM_GITHUB_MIRROR -ErrorAction SilentlyContinue
}

function Update-ProcessPath {
  $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = @($machinePath, $userPath, $env:Path) -join ';'
}

function Test-Command([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-VisualStudioInstallationPath {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
  if (-not (Test-Path $vswhere)) { return $null }
  return (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
}

function Install-Prerequisites {
  $packages = @(
    @{ Id = 'Git.Git'; Command = 'git' },
    @{ Id = 'OpenJS.NodeJS.LTS'; Command = 'node' },
    @{ Id = 'Python.Python.3.12'; Command = 'python' },
    @{ Id = 'Rustlang.Rustup'; Command = 'rustup' }
  )
  $missingPackages = @($packages | Where-Object { -not (Test-Command $_.Command) })
  $needsBuildTools = -not (Get-VisualStudioInstallationPath)
  if (($missingPackages.Count -gt 0 -or $needsBuildTools) -and -not (Test-Command 'winget')) {
    throw 'winget is required to install missing Windows build prerequisites. Install App Installer or use -SkipSetup with an existing toolchain.'
  }
  foreach ($package in $missingPackages) {
    & winget install --id $package.Id --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Failed to install $($package.Id)." }
  }
  if ($needsBuildTools) {
    & winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --accept-package-agreements --accept-source-agreements --override '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install Visual Studio C++ Build Tools.' }
  }
  Update-ProcessPath
}

function Import-VisualStudioEnvironment {
  $installationPath = Get-VisualStudioInstallationPath
  if (-not $installationPath) { return }
  $devShell = Join-Path $installationPath 'Common7/Tools/Launch-VsDevShell.ps1'
  if (Test-Path $devShell) { & $devShell -Arch amd64 -HostArch amd64 }
}

function Assert-Prerequisites {
  foreach ($command in @('node', 'npm', 'python', 'rustup', 'git')) {
    if (-not (Test-Command $command)) { throw "Required command is missing: $command" }
  }
  if (-not (Get-VisualStudioInstallationPath)) { throw 'Visual Studio C++ Build Tools with the VCTools workload are unavailable.' }
}

function Invoke-Npm([string[]]$Arguments) {
  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) { throw "npm command failed: npm $($Arguments -join ' ')" }
}

Set-BuildSources
Push-Location $repoRoot
try {
  if (-not $SkipSetup) { Install-Prerequisites }
  Import-VisualStudioEnvironment
  Assert-Prerequisites
  if ($SetupOnly) { return }
  if (-not $SkipDependencies) { Invoke-Npm @('ci') }
  if ($RunTests) { Invoke-Npm @('test') }
  if ($RunE2E) { Invoke-Npm @('run', 'test:e2e') }
  Invoke-Npm @('run', 'package:build', '--', 'windows')
  Invoke-Npm @('run', 'package:verify', '--', 'windows')
} finally {
  Pop-Location
}
