Add-Type -AssemblyName System.IO.Compression.FileSystem

$checkZips = @(
    '1991-Honda-CivicEG6.zip',
    '2018-Honda-CivicTypeR.zip',
    'Rolls_Royce-Boattail.zip',
    'Tesla-Roadster2.0.zip',
    'Vinfast-VF3.zip',
    'Vinfast-Vf9.zip'
)

$checkZips | ForEach-Object {
    $outerZipPath = Join-Path "Xe" $_
    $outerZip = [System.IO.Compression.ZipFile]::OpenRead($outerZipPath)
    $innerZipEntry = $outerZip.Entries | Where-Object { $_.FullName -match '3D[Mm]odel/.*\.zip$' } | Select-Object -First 1
    
    if ($innerZipEntry) {
        $stream = $innerZipEntry.Open()
        $innerZip = New-Object System.IO.Compression.ZipArchive($stream)
        Write-Host "====================" $_ "===================="
        $innerZip.Entries | ForEach-Object {
            Write-Host "  " $_.FullName "(" $_.Length "bytes)"
        }
        $innerZip.Dispose()
        $stream.Dispose()
    }
    $outerZip.Dispose()
}
