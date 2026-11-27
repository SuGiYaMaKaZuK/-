# Card Reveal の未署名・ローカル開発版を現在のユーザーにインストールします。
# 管理者権限は不要です。Premiere を終了してから実行してください。
[CmdletBinding()]
param(
    [switch]$SkipFFmpegDownload
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'このインストーラーは Windows 専用です。'
}
if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'この開発版は 64 ビット Windows 専用です。'
}
if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
    throw 'APPDATA フォルダーを確認できません。'
}

$sourcePath = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\', '/')
$extensionPath = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.cardreveal.panel'
$extensionPath = [IO.Path]::GetFullPath($extensionPath).TrimEnd('\', '/')
$debugRegistryPath = 'HKCU:\Software\Adobe\CSXS.12'

foreach ($relativePath in @('CSXS\manifest.xml', 'index.html', 'js\host.jsx')) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourcePath $relativePath) -PathType Leaf)) {
        throw "必要なファイルがありません: $relativePath。ZIP をすべて展開してから実行してください。"
    }
}

$premiereProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -like '*Premiere*'
})
if ($premiereProcesses.Count -gt 0) {
    throw 'Premiere Pro を終了してから、このインストーラーをもう一度実行してください。'
}

# GitHub ZIP に含まれるサンプル画像のテキストデータを復元します。
foreach ($sampleName in @('boss', 'treasure', 'quest', 'portal')) {
    $encodedSample = Join-Path $sourcePath ("examples\media\" + $sampleName + '.png.base64')
    if (Test-Path -LiteralPath $encodedSample -PathType Leaf) {
        $sampleBytes = [Convert]::FromBase64String([IO.File]::ReadAllText($encodedSample))
        $samplePath = Join-Path $sourcePath ("examples\media\" + $sampleName + '.png')
        [IO.File]::WriteAllBytes($samplePath, $sampleBytes)
    }
}

if (-not [string]::Equals($sourcePath, $extensionPath, [StringComparison]::OrdinalIgnoreCase)) {
    New-Item -ItemType Directory -Path $extensionPath -Force | Out-Null
    # GitHub のソース ZIP にある過去の配布物・画面写真をインストール先にコピーしない。
    foreach ($entryName in @('CSXS', 'css', 'js', 'bin', 'index.html', 'Install.cmd', 'install-windows.ps1', 'uninstall-windows.ps1', 'LICENSE', 'README.md', '使い方.txt')) {
        Copy-Item -LiteralPath (Join-Path $sourcePath $entryName) -Destination $extensionPath -Recurse -Force
    }
    $exampleTarget = Join-Path $extensionPath 'examples\media'
    New-Item -ItemType Directory -Path $exampleTarget -Force | Out-Null
    foreach ($sampleName in @('boss.png', 'treasure.png', 'quest.png', 'portal.png')) {
        $exampleFile = Join-Path $sourcePath ('examples\media\' + $sampleName)
        Copy-Item -LiteralPath $exampleFile -Destination $exampleTarget -Force
    }
}

# FFmpeg 本体は ZIP に同梱せず、必要な場合だけ固定リリースから取得します。
$ffmpegPath = Join-Path $extensionPath 'bin\ffmpeg.exe'
$ffmpegCommand = Get-Command -Name 'ffmpeg.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not (Test-Path -LiteralPath $ffmpegPath -PathType Leaf) -and $null -eq $ffmpegCommand -and -not $SkipFFmpegDownload) {
    $downloadDirectory = Join-Path ([IO.Path]::GetTempPath()) ('card-reveal-' + [Guid]::NewGuid().ToString('N'))
    $compressedPath = Join-Path $downloadDirectory 'ffmpeg-win32-x64.gz'
    $expandedPath = Join-Path $downloadDirectory 'ffmpeg.exe'
    $releaseBase = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/'
    $expectedHash = '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77'
    $originalSecurityProtocol = [Net.ServicePointManager]::SecurityProtocol
    try {
        New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
        [Net.ServicePointManager]::SecurityProtocol = $originalSecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Write-Host '描画用 FFmpeg を GitHub からダウンロードします（約 30 MB）。'
        Invoke-WebRequest -Uri ($releaseBase + 'ffmpeg-win32-x64.gz') -OutFile $compressedPath -UseBasicParsing
        $actualHash = (Get-FileHash -LiteralPath $compressedPath -Algorithm SHA256).Hash
        if ($actualHash -ne $expectedHash) {
            throw 'ダウンロード内容の SHA-256 が一致しません。取得したファイルは使用しません。'
        }
        $compressedStream = [IO.File]::OpenRead($compressedPath)
        try {
            $gzipStream = [IO.Compression.GZipStream]::new($compressedStream, [IO.Compression.CompressionMode]::Decompress)
            try {
                $outputStream = [IO.File]::Create($expandedPath)
                try { $gzipStream.CopyTo($outputStream) }
                finally { $outputStream.Dispose() }
            }
            finally { $gzipStream.Dispose() }
        }
        finally { $compressedStream.Dispose() }
        $binaryDirectory = Join-Path $extensionPath 'bin'
        New-Item -ItemType Directory -Path $binaryDirectory -Force | Out-Null
        foreach ($assetName in @('win32-x64.LICENSE', 'win32-x64.README')) {
            try {
                Invoke-WebRequest -Uri ($releaseBase + $assetName) -OutFile (Join-Path $binaryDirectory $assetName) -UseBasicParsing
            }
            catch { Write-Warning ("FFmpeg の補足ファイルを取得できませんでした: $assetName。配布元で確認してください。") }
        }
        Move-Item -LiteralPath $expandedPath -Destination $ffmpegPath -Force
        Write-Host 'FFmpeg を取得し、SHA-256 を確認しました。'
    }
    catch {
        Write-Warning ('FFmpeg を自動取得できませんでした: ' + $_.Exception.Message)
        Write-Warning 'パネルのインストールを続行します。後で ffmpeg.exe を bin フォルダーに置いてください。'
    }
    finally {
        [Net.ServicePointManager]::SecurityProtocol = $originalSecurityProtocol
        if (Test-Path -LiteralPath $downloadDirectory) {
            Remove-Item -LiteralPath $downloadDirectory -Recurse -Force
        }
    }
}

# Adobe の開発用設定です。他の未署名 CEP 拡張にも影響する共有設定です。
New-Item -Path $debugRegistryPath -Force | Out-Null
New-ItemProperty -Path $debugRegistryPath -Name 'PlayerDebugMode' -Value '1' -PropertyType String -Force | Out-Null

Write-Host ''
Write-Host 'Card Reveal をインストールしました。' -ForegroundColor Green
Write-Host "保存先: $extensionPath"
Write-Host '開発用設定: HKCU\Software\Adobe\CSXS.12\PlayerDebugMode = 1'
Write-Host 'Premiere Pro 2026 を起動し、ウィンドウ > エクステンションから開いてください。'
Write-Host 'FFmpeg がない場合は、ffmpeg.exe を拡張の bin フォルダーに置いてください。'
Write-Host '書き出した映像はドキュメントの Card Reveal フォルダーに保存されます。'
