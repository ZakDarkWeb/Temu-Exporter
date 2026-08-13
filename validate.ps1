$json = Get-Content manifest.json -Raw
try {
    $obj = $json | ConvertFrom-Json
    Write-Host "manifest.json: VALID JSON"
    Write-Host ("Name: " + $obj.name + " | Version: " + $obj.version)
    Write-Host ("Background type: " + $obj.background.type)
    Write-Host ("Web accessible: " + ($obj.web_accessible_resources | ConvertTo-Json -Compress))
} catch {
    Write-Host "manifest.json INVALID"
    Write-Host $_.Exception.Message
}
