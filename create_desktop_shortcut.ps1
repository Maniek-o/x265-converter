param(
    [ValidateSet('local', 'unraid')]
    [string]$Mode = 'local',
    [string]$UnraidUrl = 'http://192.168.10.186:3001'
)

$ErrorActionPreference = 'Stop'

function New-VideoClapperIcon {
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

    # Background (dark neutral)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Rectangle(0, 0, $size, $size)),
        [System.Drawing.Color]::FromArgb(255, 37, 41, 48),
        [System.Drawing.Color]::FromArgb(255, 18, 21, 27),
        120
    )
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)

    # Clapper body
    $bodyBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 62, 66, 74))
    $bodyRect = New-Object System.Drawing.Rectangle(44, 108, 168, 104)
    $g.FillRectangle($bodyBrush, $bodyRect)

    # Top slate
    $slateBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 30, 33, 39))
    $slatePts = @(
        (New-Object System.Drawing.Point(34, 96)),
        (New-Object System.Drawing.Point(206, 64)),
        (New-Object System.Drawing.Point(224, 102)),
        (New-Object System.Drawing.Point(52, 134))
    )
    $g.FillPolygon($slateBrush, $slatePts)

    # White stripes on top slate
    $stripePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(240, 255, 255, 255), 8)
    $g.DrawLine($stripePen, 52, 123, 73, 80)
    $g.DrawLine($stripePen, 87, 116, 108, 74)
    $g.DrawLine($stripePen, 122, 110, 143, 68)
    $g.DrawLine($stripePen, 157, 103, 178, 61)

    # Body details
    $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(130, 255, 255, 255), 3)
    $g.DrawLine($linePen, 60, 146, 196, 146)
    $g.DrawLine($linePen, 60, 170, 196, 170)
    $g.DrawLine($linePen, 60, 194, 174, 194)

    # Border for clarity
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 255, 255, 255), 2)
    $g.DrawRectangle($borderPen, 1, 1, $size - 3, $size - 3)

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
        $bodyBrush.Dispose()
        $slateBrush.Dispose()
        $stripePen.Dispose()
        $linePen.Dispose()
        $borderPen.Dispose()
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
    $customIconPath = Join-Path $projectRoot 'icons\x265-video-clapper.ico'
    try {
        New-VideoClapperIcon -OutputPath $customIconPath
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
