# パネルのインストール先だけを削除します。ドキュメント内の出力は保持します。
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
    throw 'このアンインストーラーは Windows 専用です。'
}
if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
    throw 'APPDATA フォルダーを確認できません。'
}

$extensionPath = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.cardreveal.panel'
if (-not (Test-Path -LiteralPath $extensionPath -PathType Container)) {
    Write-Host 'Card Reveal のインストール先は見つかりませんでした。'
    exit 0
}

$premiereProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -like '*Premiere*'
})
if ($premiereProcesses.Count -gt 0) {
    throw 'Premiere Pro を終了してから、このアンインストーラーをもう一度実行してください。'
}

$manifestPath = Join-Path $extensionPath 'CSXS\manifest.xml'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'Card Reveal の manifest.xml を確認できないため削除を中止しました。'
}
[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
$panelIds = @($manifest.ExtensionManifest.ExtensionList.Extension | ForEach-Object { $_.Id })
if ('com.cardreveal.panel' -notin $panelIds) {
    throw '対象が Card Reveal ではないため削除を中止しました。'
}

# このスクリプト自体がインストール先にある場合も、実行中の位置を外へ移して削除します。
Set-Location -LiteralPath ([IO.Path]::GetTempPath())
Remove-Item -LiteralPath $extensionPath -Recurse -Force
Write-Host 'Card Reveal をアンインストールしました。' -ForegroundColor Green
Write-Host 'ドキュメント内の出力映像と元の画像・動画は保持しています。'
Write-Host '他の拡張への影響を避けるため、共有の PlayerDebugMode 設定は変更していません。'
