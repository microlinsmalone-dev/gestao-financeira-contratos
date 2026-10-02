# ==============================================================================
# MICROLINS POTIRENDABA - SERVIDOR LOCAL ZERO DEPENDÊNCIAS
# ==============================================================================
# Este script inicia um servidor HTTP local usando PowerShell/.NET nativo
# e abre automaticamente o sistema no navegador padrão. Não requer Python nem Node.js.
# ==============================================================================

$port = 8080
$ip = [System.Net.IPAddress]::Loopback
$listener = $null

while ($port -lt 8100) {
    try {
        $listener = New-Object System.Net.Sockets.TcpListener($ip, $port)
        $listener.Start()
        break
    } catch {
        $port++
    }
}

if (-not $listener) {
    Write-Host "Não foi possível abrir uma porta local entre 8080 e 8100." -ForegroundColor Red
    pause
    exit 1
}

$url = "http://localhost:$port/index.html"
Write-Host ""
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "  MICROLINS POTIRENDABA - GESTÃO FINANCEIRA DE CONTRATOS E MODALIDADES" -ForegroundColor Yellow
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "  Servidor ativo em: $url" -ForegroundColor Green
Write-Host "  Para encerrar o servidor, feche esta janela ou pressione Ctrl+C." -ForegroundColor Gray
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host ""

Start-Process $url

$baseDir = (Get-Location).Path

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $line = $reader.ReadLine()

        if ($line) {
            $tokens = $line.Split(' ')
            if ($tokens.Length -ge 2) {
                $reqPath = $tokens[1].TrimStart('/').Split('?')[0]
                if (-not $reqPath) { $reqPath = "index.html" }
                $reqPath = [System.Uri]::UnescapeDataString($reqPath)
                $filePath = Join-Path $baseDir $reqPath

                if (Test-Path $filePath -PathType Leaf) {
                    $bytes = [System.IO.File]::ReadAllBytes($filePath)
                    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                    $mime = switch ($ext) {
                        ".html" { "text/html; charset=utf-8" }
                        ".js"   { "application/javascript; charset=utf-8" }
                        ".css"  { "text/css; charset=utf-8" }
                        ".json" { "application/json; charset=utf-8" }
                        ".svg"  { "image/svg+xml" }
                        ".png"  { "image/png" }
                        ".ico"  { "image/x-icon" }
                        ".xlsx" { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
                        default { "application/octet-stream" }
                    }

                    $header = "HTTP/1.1 200 OK`r`nContent-Type: $mime`r`nContent-Length: $($bytes.Length)`r`nAccess-Control-Allow-Origin: *`r`nConnection: close`r`n`r`n"
                    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                    $stream.Write($headerBytes, 0, $headerBytes.Length)
                    $stream.Write($bytes, 0, $bytes.Length)
                } else {
                    $notFound = "HTTP/1.1 404 Not Found`r`nContent-Length: 9`r`nConnection: close`r`n`r`nNot Found"
                    $notFoundBytes = [System.Text.Encoding]::ASCII.GetBytes($notFound)
                    $stream.Write($notFoundBytes, 0, $notFoundBytes.Length)
                }
            }
        }
        $client.Close()
    }
} finally {
    if ($listener) {
        $listener.Stop()
    }
}
