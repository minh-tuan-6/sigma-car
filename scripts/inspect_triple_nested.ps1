Add-Type -AssemblyName System.IO.Compression.FileSystem

function Inspect-NestedZip($outerPath, $innerPath, $nestedPath) {
    $outer = [System.IO.Compression.ZipFile]::OpenRead($outerPath)
    $innerEntry = $outer.Entries | Where-Object { $_.FullName -like "*$innerPath*" } | Select-Object -First 1
    if ($innerEntry) {
        $s1 = $innerEntry.Open()
        $inner = New-Object System.IO.Compression.ZipArchive($s1)
        $nestedEntry = $inner.Entries | Where-Object { $_.FullName -like "*$nestedPath*" } | Select-Object -First 1
        if ($nestedEntry) {
            $s2 = $nestedEntry.Open()
            $nested = New-Object System.IO.Compression.ZipArchive($s2)
            Write-Host ">>> Found nested in" $outerPath "->" $nestedPath
            $nested.Entries | ForEach-Object { Write-Host "   " $_.FullName "(" $_.Length "bytes)" }
            $nested.Dispose()
            $s2.Dispose()
        }
        $inner.Dispose()
        $s1.Dispose()
    }
    $outer.Dispose()
}

Inspect-NestedZip "Xe/Vinfast-VF3.zip" "3Dmodel" "UPLOAD.zip"
Inspect-NestedZip "Xe/2018-Honda-CivicTypeR.zip" "3Dmodel" "FINAL_MODEL.zip"
