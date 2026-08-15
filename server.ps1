# career-mendan-assist ローカルサーバー
# Node.js/Pythonのインストール無しで、Windows標準のHttpListenerだけでappフォルダを配信する。
# localhostのみにバインドするため、管理者権限やファイアウォール設定変更は基本的に不要。

param(
  [int]$Port = 8420,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'docs'

if (-not (Test-Path $root)) {
  Write-Host "エラー: docsフォルダが見つかりません ($root)" -ForegroundColor Red
  exit 1
}

$mimeMap = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.webm' = 'audio/webm'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
}
$defaultMime = 'application/octet-stream'

function Start-ListenerWithRetry {
  param([int]$StartPort)
  for ($i = 0; $i -lt 10; $i++) {
    $tryPort = $StartPort + $i
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$tryPort/")
    try {
      $l.Start()
      return @{ Listener = $l; Port = $tryPort }
    } catch {
      Write-Host "ポート $tryPort は使用中のようです。次のポートを試します..." -ForegroundColor Yellow
    }
  }
  throw "利用可能なポートが見つかりませんでした（$StartPort から10個試行）。"
}

$result = Start-ListenerWithRetry -StartPort $Port
$listener = $result.Listener
$actualPort = $result.Port
$prefixUrl = "http://localhost:$actualPort/"

Write-Host "配信フォルダ: $root"
Write-Host "サーバー起動しました: $prefixUrl"
Write-Host "終了するには、このウィンドウで Ctrl+C を押してください。"

if (-not $NoBrowser) {
  Start-Process $prefixUrl | Out-Null
}

$script:cancelRequested = $false
$cancelHandler = Register-ObjectEvent -InputObject ([Console]) -EventName CancelKeyPress -Action {
  $script:cancelRequested = $true
  $Event.Cancel = $true
}

try {
  while ($listener.IsListening -and -not $script:cancelRequested) {
    $asyncResult = $listener.BeginGetContext($null, $null)
    while (-not $asyncResult.AsyncWaitHandle.WaitOne(250)) {
      if ($script:cancelRequested) { break }
    }
    if ($script:cancelRequested) { break }

    $context = $listener.EndGetContext($asyncResult)
    $request = $context.Request
    $response = $context.Response

    try {
      $reqPath = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
      if ($reqPath -eq '/') { $reqPath = '/index.html' }
      $combined = Join-Path $root ($reqPath.TrimStart('/'))
      $fullPath = [System.IO.Path]::GetFullPath($combined)
      $rootFull = [System.IO.Path]::GetFullPath($root)

      if (-not $fullPath.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        $response.StatusCode = 403
      } elseif (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
        $contentType = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { $defaultMime }
        $bytes = [System.IO.File]::ReadAllBytes($fullPath)
        $response.ContentType = $contentType
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $response.StatusCode = 404
      }
    } catch {
      $response.StatusCode = 500
      Write-Host "リクエスト処理エラー: $_" -ForegroundColor Red
    } finally {
      $response.Close()
    }
  }
} finally {
  Unregister-Event -SourceIdentifier $cancelHandler.Name -ErrorAction SilentlyContinue
  $listener.Stop()
  $listener.Close()
  Write-Host "サーバーを停止しました。ポートを解放しました。"
}
