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

    # Transparent canvas with film clapper icon (gray style).
    $g.Clear([System.Drawing.Color]::Transparent)

    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 0, 0, 0))
    $g.FillEllipse($shadowBrush, 46, 214, 164, 22)

    $bodyRect = New-Object System.Drawing.Rectangle(48, 108, 162, 102)
    $bodyBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $bodyRect,
        [System.Drawing.Color]::FromArgb(255, 110, 114, 122),
        [System.Drawing.Color]::FromArgb(255, 62, 66, 74),
        90
    )
    $g.FillRectangle($bodyBrush, $bodyRect)

    $bodyBorderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 30, 33, 38), 3)
    $g.DrawRectangle($bodyBorderPen, $bodyRect)

    $hingeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 150, 153, 160))
    $g.FillEllipse($hingeBrush, 58, 118, 16, 16)

    # Top clapper slate.
    $topPts = @(
        (New-Object System.Drawing.Point(36, 96)),
        (New-Object System.Drawing.Point(192, 66)),
        (New-Object System.Drawing.Point(214, 98)),
        (New-Object System.Drawing.Point(58, 128))
    )
    $topBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 52, 55, 62))
    $g.FillPolygon($topBrush, $topPts)

    $topBorderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(210, 20, 22, 27), 3)
    $g.DrawPolygon($topBorderPen, $topPts)

    # White stripes on top slate.
    $stripePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(238, 240, 240, 240), 8)
    $stripePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $stripePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($stripePen, 58, 120, 84, 80)
    $g.DrawLine($stripePen, 92, 113, 118, 73)
    $g.DrawLine($stripePen, 126, 106, 152, 66)
    $g.DrawLine($stripePen, 160, 99, 186, 59)

    # Chalk-like scribbles.
    $chalkPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 245, 245, 245), 4)
    $chalkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $chalkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($chalkPen, 72, 156, 118, 148)
    $g.DrawLine($chalkPen, 72, 168, 106, 161)
    $g.DrawLine($chalkPen, 72, 180, 126, 172)
    $g.DrawLine($chalkPen, 136, 178, 170, 171)

    # Guide lines.
    $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(105, 235, 235, 235), 2)
    $g.DrawLine($linePen, 64, 142, 194, 142)
    $g.DrawLine($linePen, 64, 192, 194, 192)

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
        $shadowBrush.Dispose()
        $bodyBrush.Dispose()
        $bodyBorderPen.Dispose()
        $hingeBrush.Dispose()
        $topBrush.Dispose()
        $topBorderPen.Dispose()
        $stripePen.Dispose()
        $chalkPen.Dispose()
        $linePen.Dispose()
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
    $customIconPath = Join-Path $projectRoot 'icons\x265-video-clapper-v2.ico'
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
