param(
  [Parameter(Mandatory = $true)]
  [string]$SourceFile,

  [string]$ApiBase = 'http://127.0.0.1:3001',

  [ValidateSet('quality', 'balanced', 'speed')]
  [string]$Preset = 'quality',

  [ValidateRange(20, 95)]
  [int]$TargetPercent = 55,

  [ValidateSet('copy', 'opus')]
  [string]$AudioCodec = 'copy',

  [ValidateRange(32, 320)]
  [int]$AudioBitrateKbps = 96,

  [ValidateSet('source', '24')]
  [string]$FpsMode = 'source',

  [int]$PollSeconds = 2,

  [string]$OutputCsv = '.\\benchmark_results.csv',

  [switch]$KeepQueue
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host "[bench] $Message"
}

function Get-JobById([string]$Base, [int]$Id) {
  $jobsResp = Invoke-RestMethod -Method Get -Uri "$Base/api/jobs"
  return @($jobsResp.jobs) | Where-Object { [int]$_.id -eq $Id } | Select-Object -First 1
}

$resolvedSource = (Resolve-Path -LiteralPath $SourceFile).Path
if (-not (Test-Path -LiteralPath $resolvedSource)) {
  throw "Source file not found: $SourceFile"
}

Write-Step "Checking API health at $ApiBase"
$health = Invoke-RestMethod -Method Get -Uri "$ApiBase/api/health"

if (-not $KeepQueue) {
  Write-Step 'Stopping active/queued jobs to isolate benchmark run'
  Invoke-RestMethod -Method Post -Uri "$ApiBase/api/queue/stop-all" | Out-Null
}

$settings = @{
  encoder = 'cpu'
  targetPercent = $TargetPercent
  cpuLimitPercent = 100
  qualityPreset = $Preset
  audioCodec = $AudioCodec
  audioBitrateKbps = $AudioBitrateKbps
  testClipEnabled = $false
  smartQuality = $false
  turboMode = $false
  fpsMode = $FpsMode
}

$payload = @{
  sourceFiles = @($resolvedSource)
  settings = $settings
}

Write-Step 'Submitting benchmark job'
$createResp = Invoke-RestMethod -Method Post -Uri "$ApiBase/api/jobs" -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 8)
$job = @($createResp.jobs) | Select-Object -First 1
if (-not $job) {
  throw 'API did not return a created job.'
}

$jobId = [int]$job.id
Write-Step "Created job id=$jobId"

do {
  Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds))
  $current = Get-JobById -Base $ApiBase -Id $jobId
  if (-not $current) {
    throw "Job id=$jobId disappeared from queue state."
  }

  $progress = [double]($current.metrics.progressPercent)
  $fps = [double]($current.metrics.fps)
  $eta = $current.metrics.etaSeconds
  $status = [string]$current.status

  $progressText = if ($progress -ge 0) { ('{0:N1}' -f $progress) } else { '0.0' }
  $fpsText = if ($fps -ge 0) { ('{0:N2}' -f $fps) } else { '0.00' }
  $etaText = if ($null -ne $eta) { [string]$eta } else { '-' }

  Write-Host ("[bench] status={0} progress={1}% fps={2} eta={3}s" -f $status, $progressText, $fpsText, $etaText)
}
while ($current.status -eq 'queued' -or $current.status -eq 'preparing' -or $current.status -eq 'processing')

if ($current.status -ne 'completed') {
  $msg = if ($current.error) { [string]$current.error } else { "Benchmark job finished with status: $($current.status)" }
  throw $msg
}

$cpu = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1
$powerScheme = ((powercfg /GETACTIVESCHEME) 2>$null) -join ' '

$sourceBytes = [double]($current.metrics.sourceSizeBytes)
$outputBytes = [double]($current.metrics.currentSizeBytes)
$savedPercent = [double]($current.sizeSavedPercent)

$conversionSeconds = $current.metrics.conversionSeconds
if ($null -eq $conversionSeconds -and $current.startedAt -and $current.finishedAt) {
  $conversionSeconds = [Math]::Round(((Get-Date $current.finishedAt) - (Get-Date $current.startedAt)).TotalSeconds)
}

$result = [PSCustomObject]@{
  timestampUtc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  computerName = $env:COMPUTERNAME
  cpuName = [string]$cpu.Name
  cpuCores = [int]$cpu.NumberOfCores
  cpuLogicalProcessors = [int]$cpu.NumberOfLogicalProcessors
  powerScheme = [string]$powerScheme
  apiBase = $ApiBase
  appInstanceId = [string]$health.instanceId
  ffmpegPath = [string]$health.ffmpegPath
  sourceFile = $resolvedSource
  sourceMB = [Math]::Round($sourceBytes / 1MB, 2)
  outputMB = [Math]::Round($outputBytes / 1MB, 2)
  savedPercent = [Math]::Round($savedPercent, 2)
  status = [string]$current.status
  conversionSeconds = [double]$conversionSeconds
  finalFps = [Math]::Round([double]($current.metrics.fps), 3)
  encoder = 'cpu'
  preset = $Preset
  turboMode = $false
  cpuLimitPercent = 100
  smartQuality = $false
  testClipEnabled = $false
  targetPercent = $TargetPercent
  audioCodec = $AudioCodec
  audioBitrateKbps = $AudioBitrateKbps
  fpsMode = $FpsMode
  outputPath = [string]$current.outputPath
  jobId = $jobId
}

$csvPath = Resolve-Path -LiteralPath (Split-Path -Parent $OutputCsv) -ErrorAction SilentlyContinue
if (-not $csvPath) {
  $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputCsv)
}

if (Test-Path -LiteralPath $OutputCsv) {
  $result | Export-Csv -LiteralPath $OutputCsv -NoTypeInformation -Append
} else {
  $result | Export-Csv -LiteralPath $OutputCsv -NoTypeInformation
}

Write-Host ''
Write-Host '[bench] Benchmark finished successfully.'
Write-Host ('[bench] conversionSeconds={0} finalFps={1} sourceMB={2} outputMB={3} savedPercent={4}%' -f $result.conversionSeconds, $result.finalFps, $result.sourceMB, $result.outputMB, $result.savedPercent)
Write-Host ("[bench] Result appended to: {0}" -f (Resolve-Path -LiteralPath $OutputCsv).Path)