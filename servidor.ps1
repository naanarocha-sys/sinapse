# SINAPSE — servidor local simples (não precisa de Python nem Node).
# Uso:  powershell -ExecutionPolicy Bypass -File servidor.ps1            (porta 8080)
#       powershell -ExecutionPolicy Bypass -File servidor.ps1 -Porta 9000
#       powershell -ExecutionPolicy Bypass -File servidor.ps1 -Rede     (aceita o celular no mesmo Wi-Fi)
param([int]$Porta = 8080, [switch]$Rede)

$raiz = [IO.Path]::GetFullPath($PSScriptRoot)
$tipos = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.svg' = 'image/svg+xml'; '.webmanifest' = 'application/manifest+json'; '.json' = 'application/json'
  '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8'
}

$http = [System.Net.HttpListener]::new()
$http.Prefixes.Add($(if ($Rede) { "http://+:$Porta/" } else { "http://localhost:$Porta/" }))
try { $http.Start() } catch {
  Write-Host "Nao consegui abrir a porta $Porta. No modo -Rede, rode uma vez (PowerShell como administrador):"
  Write-Host "  netsh http add urlacl url=http://+:$Porta/ user=$env:USERNAME"
  exit 1
}
Write-Host "SINAPSE rodando em http://localhost:$Porta  (Ctrl+C para parar)"
if ($Rede) {
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))' } |
    ForEach-Object { Write-Host "No celular (mesmo Wi-Fi): http://$($_.IPAddress):$Porta" }
}
try {
  while ($http.IsListening) {
    $tarefa = $http.GetContextAsync()
    while (-not $tarefa.AsyncWaitHandle.WaitOne(300)) { }   # deixa o Ctrl+C funcionar
    $ctx = $tarefa.Result
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $arq = [IO.Path]::GetFullPath((Join-Path $raiz $rel))
      if ($arq.StartsWith($raiz) -and (Test-Path -LiteralPath $arq -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($arq)
        $ext = [IO.Path]::GetExtension($arq).ToLower()
        $res.ContentType = if ($tipos[$ext]) { $tipos[$ext] } else { 'application/octet-stream' }
        $res.Headers['Cache-Control'] = 'no-cache'
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    } catch { } finally { $res.Close() }
  }
} finally {
  $http.Stop()
}
