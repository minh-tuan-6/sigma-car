Add-Type -AssemblyName System.IO.Compression.FileSystem

Get-ChildItem -Path "Xe" -Filter *.zip | ForEach-Object {
    $zipPath = $_.FullName
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    Write-Host "====================" $_.Name "===================="
    $zip.Entries | ForEach-Object {
        Write-Host "  " $_.FullName "(" $_.Length "bytes)"
    }
    $zip.Dispose()
}
