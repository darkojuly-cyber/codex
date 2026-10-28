$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try {
    $projectDirectory = Split-Path -Parent $PSScriptRoot
    Set-Location -LiteralPath $projectDirectory
    $targetOutput = & node --import tsx (Join-Path $PSScriptRoot "tunnel-target.ts")
    if ($LASTEXITCODE -ne 0) { throw "Cannot read the project port. Confirm Node.js and project dependencies are installed." }
    $target = ($targetOutput -join "").Trim()
    if ($target -notmatch '^http://127\.0\.0\.1:[0-9]+$') { throw "Unexpected local API target. No tunnel was started." }
    $command = Get-Command cloudflared.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($command) {
        $tunnelExe = $command.Source
    } else {
        $toolsDirectory = Join-Path $env:LOCALAPPDATA "EvoMemeTools"
        New-Item -ItemType Directory -Force -Path $toolsDirectory | Out-Null
        $tunnelExe = Join-Path $toolsDirectory "cloudflared.exe"
        if (!(Test-Path -LiteralPath $tunnelExe)) {
            if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64" -and $env:PROCESSOR_ARCHITEW6432 -ne "AMD64") {
                throw "Install cloudflared for your Windows architecture first. This automatic download supports Windows x64."
            }
            Write-Host "Downloading cloudflared from the official Cloudflare GitHub release..."
            $temporaryDownload = Join-Path $toolsDirectory ("cloudflared-" + [guid]::NewGuid().ToString() + ".download")
            try {
                Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $temporaryDownload -TimeoutSec 180
                if ((Get-Item -LiteralPath $temporaryDownload).Length -lt 1000000) { throw "Download is incomplete. Please retry." }
                Move-Item -LiteralPath $temporaryDownload -Destination $tunnelExe -Force
            } finally {
                if (Test-Path -LiteralPath $temporaryDownload) { Remove-Item -LiteralPath $temporaryDownload -Force }
            }
        }
    }
    Write-Host "A public HTTPS address ending in trycloudflare.com will appear below."
    Write-Host "Keep this window OPEN. Copy that address into StartPublic.cmd."
    Write-Host "Do not change .env.local. No router port forwarding is needed."
    Write-Host ("Forwarding only the local EvoMeme API at " + $target)
    & $tunnelExe tunnel --url $target
    exit $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
