param(
    [ValidateSet('local', 'unraid')]
    [string]$Mode = 'local',
    [string]$UnraidUrl = 'http://192.168.10.186:3001'
)

$ErrorActionPreference = 'Stop'

function New-UnraidVideoIcon {
    param(
        [Parameter(Mandatory = $true)]
        [string]$OutputPath
    )

    Add-Type -AssemblyName System.Drawing

    $size = 256
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Background
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Rectangle(0, 0, $size, $size)),
        [System.Drawing.Color]::FromArgb(255, 8, 17, 34),
        [System.Drawing.Color]::FromArgb(255, 12, 47, 96),
        135
    )
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)

    # Unraid-like cloud
    $cloudBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 4, 189, 255))
    $g.FillEllipse($cloudBrush, 52, 92, 78, 62)
    $g.FillEllipse($cloudBrush, 98, 74, 90, 74)
    $g.FillEllipse($cloudBrush, 148, 95, 62, 55)
    $g.FillRectangle($cloudBrush, 70, 114, 125, 32)

    # Stylized U inside the cloud
    $uPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 0, 32, 78), 12)
    $uPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $uPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($uPen, 108, 92, 108, 126)
    $g.DrawLine($uPen, 108, 126, 150, 126)
    $g.DrawLine($uPen, 150, 126, 150, 92)

    # Avidemux/video accent: film strip
    $filmBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 33, 225, 148))
    $filmRect = New-Object System.Drawing.Rectangle(50, 162, 156, 56)
    $radius = 14
    $diameter = $radius * 2
    $filmPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $filmPath.AddArc($filmRect.X, $filmRect.Y, $diameter, $diameter, 180, 90)
    $filmPath.AddArc($filmRect.Right - $diameter, $filmRect.Y, $diameter, $diameter, 270, 90)
    $filmPath.AddArc($filmRect.Right - $diameter, $filmRect.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $filmPath.AddArc($filmRect.X, $filmRect.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $filmPath.CloseFigure()
    $g.FillPath($filmBrush, $filmPath)

    $holeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 10, 28, 53))
    for ($x = 60; $x -le 188; $x += 22) {
        $g.FillRectangle($holeBrush, $x, 170, 10, 8)
        $g.FillRectangle($holeBrush, $x, 202, 10, 8)
    }

    $playBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 10, 28, 53))
    $pts = @(
        (New-Object System.Drawing.Point(118, 177)),
        (New-Object System.Drawing.Point(118, 203)),
        (New-Object System.Drawing.Point(148, 190))
    )
    $g.FillPolygon($playBrush, $pts)

    # Border
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 255, 255, 255), 2)
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
        $cloudBrush.Dispose()
        $uPen.Dispose()
        $filmBrush.Dispose()
        $holeBrush.Dispose()
        $playBrush.Dispose()
        $borderPen.Dispose()
        $filmPath.Dispose()
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
    $customIconPath = Join-Path $projectRoot 'icons\x265-unraid-video.ico'
    try {
        New-UnraidVideoIcon -OutputPath $customIconPath
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
