$ErrorActionPreference = "Continue"

$targetRoot = Join-Path (Get-Location) "Xe_unpacked"
if (-not (Test-Path $targetRoot)) {
    New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
}

$zipList = Get-ChildItem -Path "Xe" -Filter *.zip
Write-Host "Found $($zipList.Count) zip archives in Xe/"

foreach ($zip in $zipList) {
    $folderName = [System.IO.Path]::GetFileNameWithoutExtension($zip.Name)
    $destFolder = Join-Path $targetRoot $folderName
    Write-Host "Extracting $($zip.Name) -> $destFolder ..."
    
    if (-not (Test-Path $destFolder)) {
        New-Item -ItemType Directory -Path $destFolder -Force | Out-Null
    }
    
    # Extract outer zip
    try {
        Expand-Archive -Path $zip.FullName -DestinationPath $destFolder -Force
    } catch {
        Write-Warning "Failed outer Expand-Archive on $($zip.Name): $_"
    }

    # Now find any nested zips and extract them
    $nestedZips = Get-ChildItem -Path $destFolder -Filter *.zip -Recurse
    foreach ($nZip in $nestedZips) {
        $nDest = Join-Path $nZip.DirectoryName "extracted_$([System.IO.Path]::GetFileNameWithoutExtension($nZip.Name))"
        Write-Host "   -> Extracting inner zip: $($nZip.Name) to $nDest"
        try {
            Expand-Archive -Path $nZip.FullName -DestinationPath $nDest -Force
            
            # Check for 3rd level nested zip
            $subZips = Get-ChildItem -Path $nDest -Filter *.zip -Recurse
            foreach ($sZip in $subZips) {
                $sDest = Join-Path $sZip.DirectoryName "extracted_$([System.IO.Path]::GetFileNameWithoutExtension($sZip.Name))"
                Write-Host "      -> Extracting 3rd level zip: $($sZip.Name) to $sDest"
                Expand-Archive -Path $sZip.FullName -DestinationPath $sDest -Force
            }
        } catch {
            Write-Warning "   Failed inner Expand-Archive on $($nZip.Name): $_"
        }
    }
}

Write-Host "Unpack completed."
