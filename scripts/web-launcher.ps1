param(
  [int]$Port = 4173
)

$root = (Resolve-Path $PSScriptRoot).Path
$listener = [System.Net.HttpListener]::new()
$prefix = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Host "无法启动本地网页服务 $prefix：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host '请关闭占用端口的程序后重试。' -ForegroundColor Yellow
  exit 1
}

Write-Host "网页版已启动：$prefix" -ForegroundColor Green
Write-Host '关闭此窗口即可停止本地网页服务。' -ForegroundColor Yellow
Start-Process "$prefix`index.html"

function Get-ContentType([string]$path) {
  switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
    '.html' { return 'text/html; charset=utf-8' }
    '.js' { return 'text/javascript; charset=utf-8' }
    '.css' { return 'text/css; charset=utf-8' }
    '.json' { return 'application/json; charset=utf-8' }
    '.wasm' { return 'application/wasm' }
    '.svg' { return 'image/svg+xml' }
    '.ico' { return 'image/x-icon' }
    default { return 'application/octet-stream' }
  }
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $relative = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
      $candidate = [System.IO.Path]::GetFullPath((Join-Path $root ($relative -replace '/', '\')))
      $rootPrefix = $root.TrimEnd('\') + '\'
      if (($candidate -ne $root) -and (-not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase))) {
        throw [System.IO.FileNotFoundException]::new()
      }
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        $context.Response.StatusCode = 404
        $context.Response.Close()
        continue
      }
      $bytes = [System.IO.File]::ReadAllBytes($candidate)
      $context.Response.ContentType = Get-ContentType $candidate
      $context.Response.ContentLength64 = $bytes.Length
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $context.Response.Close()
    } catch {
      try {
        $context.Response.StatusCode = 404
        $context.Response.Close()
      } catch { }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
