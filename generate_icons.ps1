Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\Basit\.gemini\antigravity-ide\brain\b8c62fe5-aeee-4dfa-8916-f834b5173ca3\media__1786108056988.jpg"
$iconDir = Join-Path $PSScriptRoot 'icons'
if (!(Test-Path $iconDir)) { New-Item -ItemType Directory -Path $iconDir | Out-Null }

$sizes = @(16, 32, 48, 128)
$img = [System.Drawing.Image]::FromFile($srcPath)

foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($img, 0, 0, $s, $s)
    $g.Dispose()
    
    $outPath = Join-Path $iconDir "icon$s.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Generated crisp icon ${s}x${s} -> $outPath"
}
$img.Dispose()
Write-Host "Done - all professional icons generated."
