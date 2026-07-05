$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "..\node_modules")) {
  Set-Location ..
  npm install
  Set-Location web
}

npm run dev
