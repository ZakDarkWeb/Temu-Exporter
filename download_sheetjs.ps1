New-Item -ItemType Directory -Path 'libs' -Force | Out-Null
Invoke-WebRequest -Uri 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js' -OutFile 'libs/xlsx.full.min.js'
$size = (Get-Item 'libs/xlsx.full.min.js').Length / 1024
Write-Host "Downloaded SheetJS: $size KB"
