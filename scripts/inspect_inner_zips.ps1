Add-Type -AssemblyName System.IO.Compression.FileSystem

Get-ChildItem -Path "Xe" -Filter *.zip | ForEach-Object {
    $outerZipPath = $_.FullName
    $outerZip = [System.IO.Compression.ZipFile]::OpenRead($outerZipPath)
    $innerZipEntry = $outerZip.Entries | Where-Object { $_.FullName -match '3D[Mm]odel/.*\.zip$' } | Select-Object -First 1
    
    if ($innerZipEntry) {
        $stream = $innerZipEntry.Open()
        $innerZip = New-Object System.IO.Compression.ZipArchive($stream)
        $innerFiles = $innerZip.Entries | ForEach-Object { $_.FullName }
        $glbs = $innerFiles | Where-Object { $_ -match '\.(glb|gltf)$' }
        Write-Host $_.Name "-->" $innerZipEntry.Name
        Write-Host "   GLB/GLTF:" ($glbs -join '; ')
        Write-Host "   Total Inner Files:" $innerFiles.Count
        $innerZip.Dispose()
        $stream.Dispose()
    } else {
        Write-Host $_.Name "--> NO INNER ZIP"
    }
    $outerZip.Dispose()
}
