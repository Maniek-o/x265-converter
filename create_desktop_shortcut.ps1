param(
    [ValidateSet('local', 'unraid')]
    [string]$Mode = 'local',
    [string]$UnraidUrl = 'http://192.168.10.186:3001'
)

$ErrorActionPreference = 'Stop'

function New-UnraidBrandIcon {
    param(
        [Parameter(Mandatory = $true)]
        [string]$OutputPath
    )

    Add-Type -AssemblyName System.Drawing

    $size = 256
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Unraid-like gradient background
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Rectangle(0, 0, $size, $size)),
        [System.Drawing.Color]::FromArgb(255, 234, 36, 40),
        [System.Drawing.Color]::FromArgb(255, 255, 152, 43),
        20
    )
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)

    # UNRAID wordmark
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $font = New-Object System.Drawing.Font('Segoe UI', 32, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textRect = New-Object System.Drawing.RectangleF(0, 118, $size, 102)
    $g.DrawString('UNRAID', $font, $textBrush, $textRect, $sf)

    if (-not (Test-Path -LiteralPath (Split-Path -Parent $OutputPath))) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
    }

    $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    $fs = [System.IO.File]::Create($OutputPath)
    try {
        $icon.Save($fs)
    } finally {
        $fs.Close()
        $icon.Dispose()
        $g.Dispose()
        $bmp.Dispose()
        $bgBrush.Dispose()
        $font.Dispose()
        $textBrush.Dispose()
        $sf.Dispose()
    }
}

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

# Mode-specific icon selection.
$wmploc = Join-Path $env:SystemRoot 'System32\wmploc.dll'
$shell32 = Join-Path $env:SystemRoot 'System32\shell32.dll'
$iconLocation = "$shell32,238"

if ($Mode -eq 'unraid') {
    $customIconPath = Join-Path $projectRoot 'icons\x265-unraid-brand.ico'
    try {
        New-UnraidBrandIcon -OutputPath $customIconPath
        $iconLocation = "$customIconPath,0"
    } catch {
        # Fallback to a more network/server-like icon for Unraid mode.
        $iconLocation = "$shell32,18"
    }
} elseif (Test-Path -LiteralPath $wmploc) {
    $iconLocation = "$wmploc,21"
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
