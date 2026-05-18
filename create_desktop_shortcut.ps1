param(
    [ValidateSet('local', 'unraid')]
    [string]$Mode = 'local',
    [string]$UnraidUrl = 'http://192.168.10.186:3001'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'

if ($Mode -eq 'local') {
    $launcherPath = Join-Path $projectRoot 'run.bat'
    $shortcutName = 'x265 Converter.lnk'
    $shortcutDescription = 'Uruchom lokalny x265 Converter'
    $cmdArgs = "/c `"`"$launcherPath`"`""
} else {
    $launcherPath = Join-Path $projectRoot 'run_unraid_web.cmd'
    $shortcutName = 'x265 Converter (Unraid).lnk'
    $shortcutDescription = 'Uruchom web klient x265 Converter (Unraid)'
    $cmdArgs = "/c `"`"$launcherPath`"`" `"$UnraidUrl`""
}

if (-not (Test-Path -LiteralPath $launcherPath)) {
    throw "Brak pliku uruchamiajacego: $launcherPath"
}

$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath $shortcutName

# Use a Windows media icon by default, then fallback to generic system icon.
$wmploc = Join-Path $env:SystemRoot 'System32\wmploc.dll'
$shell32 = Join-Path $env:SystemRoot 'System32\shell32.dll'

if (Test-Path -LiteralPath $wmploc) {
    $iconLocation = "$wmploc,21"
} else {
    $iconLocation = "$shell32,238"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $cmdExe
$shortcut.Arguments = $cmdArgs
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 1
$shortcut.Description = $shortcutDescription
$shortcut.IconLocation = $iconLocation
$shortcut.Save()

Write-Host "Utworzono skrot: $shortcutPath"
Write-Host "Uruchamia: $cmdExe $cmdArgs"
Write-Host "Tryb: $Mode"
if ($Mode -eq 'unraid') {
    Write-Host "URL: $UnraidUrl"
}
Write-Host "Ikona: $iconLocation"
