# Instalação de desenvolvimento: copia extension\ para a pasta CEP do usuário.
# Uso: powershell -ExecutionPolicy Bypass -File tools\dev-install.ps1
# Depois de copiar, reabrir o painel no Premiere (ou reiniciar o Premiere se o manifest mudou).

$src = Join-Path $PSScriptRoot "..\extension"
$dst = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.willian.plugins"

if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
Copy-Item $src $dst -Recurse
Write-Output "Copiado para $dst"
