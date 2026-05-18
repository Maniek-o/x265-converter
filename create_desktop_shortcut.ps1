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

    # Transparent canvas then rounded blue app tile.
    $g.Clear([System.Drawing.Color]::Transparent)
    $tileRect = New-Object System.Drawing.Rectangle(34, 26, 188, 206)
    $tileRadius = 38
    $tilePath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tilePath.AddArc($tileRect.X, $tileRect.Y, $tileRadius * 2, $tileRadius * 2, 180, 90)
    $tilePath.AddArc($tileRect.Right - ($tileRadius * 2), $tileRect.Y, $tileRadius * 2, $tileRadius * 2, 270, 90)
    $tilePath.AddArc($tileRect.Right - ($tileRadius * 2), $tileRect.Bottom - ($tileRadius * 2), $tileRadius * 2, $tileRadius * 2, 0, 90)
    $tilePath.AddArc($tileRect.X, $tileRect.Bottom - ($tileRadius * 2), $tileRadius * 2, $tileRadius * 2, 90, 90)
    $tilePath.CloseFigure()

    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $tileRect,
        [System.Drawing.Color]::FromArgb(255, 79, 133, 237),
        [System.Drawing.Color]::FromArgb(255, 98, 154, 245),
        45
    )
    $g.FillPath($bgBrush, $tilePath)

    $whitePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(245, 255, 255, 255), 8)
    $whitePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $whitePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $whitePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    # Play bubble at top.
    $bubblePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(245, 255, 255, 255), 6)
    $g.DrawEllipse($bubblePen, 112, 44, 32, 32)
    $triangle = @(
        (New-Object System.Drawing.Point(123, 53)),
        (New-Object System.Drawing.Point(123, 67)),
        (New-Object System.Drawing.Point(134, 60))
    )
    $triangleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 255, 255, 255))
    $g.FillPolygon($triangleBrush, $triangle)

    # Dotted center guide.
    $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 255, 255, 255))
    foreach ($y in 84, 96, 108, 120, 132) {
        $g.FillEllipse($dotBrush, 126, $y, 4, 4)
    }

    # Scissors handles.
    $g.DrawEllipse($whitePen, 90, 158, 20, 20)
    $g.DrawEllipse($whitePen, 146, 158, 20, 20)

    # Scissors blades.
    $g.DrawLine($whitePen, 104, 168, 142, 118)
    $g.DrawLine($whitePen, 152, 168, 114, 118)

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
        $tilePath.Dispose()
        $whitePen.Dispose()
        $bubblePen.Dispose()
        $triangleBrush.Dispose()
        $dotBrush.Dispose()
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
