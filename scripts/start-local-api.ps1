$ErrorActionPreference = "Stop"

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$apiDirectory = Join-Path $repositoryRoot "apps\api"
$healthUrl = "http://localhost:4000/api/v1/categories"

$listener = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($listener) {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      Write-Host "GYAMI Global API is already running on http://localhost:4000."
      exit 0
    }
  }
  catch {
    # A listener exists but it is not the GYAMI Global API health endpoint.
  }

  $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  $processName = if ($process) { $process.ProcessName } else { "unknown" }
  throw "Port 4000 is occupied by process $processName (PID $($listener.OwningProcess)), but the GYAMI Global API is not responding."
}

Push-Location $apiDirectory
try {
  & node "dist/src/main.js"
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
