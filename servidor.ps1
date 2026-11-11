# SINAPSE — servidor local simples (não precisa de Python nem Node).
# Uso:  powershell -ExecutionPolicy Bypass -File servidor.ps1            (porta 8080)
#       powershell -ExecutionPolicy Bypass -File servidor.ps1 -Porta 9000
param([int]$Porta = 8080)

$raiz = [IO.Path]::GetFullPath($PSScriptRoot)
$tipos = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.svg' = 'image/svg+xml'; '.webmanifest' = 'application/manifest+json'; '.json' = 'application/json'
  '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8'
}

$http = [System.Net.HttpListener]::new()
$http.Prefixes.Add("http://localhost:$Porta/")
$http.Start()
Write-Host "SINAPSE rodando em http://localhost:$Porta  (Ctrl+C para parar)"
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
