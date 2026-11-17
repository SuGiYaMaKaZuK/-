# Card Reveal カード演出 v0.2.0

Premiere Pro 2026（26.x）・Windows向けの開発版です。カードめくりと台形3分割スライドを作成できます。

## ダウンロードと導入

1. [ZIPをダウンロード](https://github.com/SuGiYaMaKaZuK/-/archive/refs/heads/main.zip)します。ページの緑色の **Code → Download ZIP** からも取得できます。
2. ダウンロードしたZIPを右クリックして **すべて展開** します。
3. **Premiere Proを終了**します。
4. 展開したフォルダー内の **Install.cmd** をダブルクリックします。管理者権限は不要です。
5. 初回は描画用FFmpegを取得します（約30MB）。完了まで待ちます。
6. Premiereを起動し、**ウィンドウ → エクステンション → Card Reveal カード演出** を開きます。
7. **サンプルで試す** を押して動きを確認します。

ダウンロードしたZIP内には本体コードとサンプル画像の復元用データがあります。サンプル画像はインストール時に自動復元されます。以前チャットで貼り付けた分割データは不要です。

## できること

- カード1〜12枚、画像・動画の指定、ドラッグ配置、好きな順番・時刻でめくる。
- 台形3分割で左・中央・右の映像を上から順に登場させる。
- 境界の角度・線の太さと色・登場速度と間隔の調整。
- 背景透過／単色背景、24・25・30・60・90・120fps。
- 名前付きプリセット、JSON設定の保存・読み込み。
- ProRes 4444のMOVを書き出してPremiereのプロジェクトへ読み込み。

完成したMOVはプロジェクトパネルからタイムラインにドラッグして使います。動画内の音声は出力しません。各面やカードをタイムラインで個別編集する形式ではなく、変更時はパネルで再書き出しします。After Effectsは不要です。

## 導入について

保存先は `%APPDATA%\Adobe\CEP\extensions\com.cardreveal.panel` です。未署名のローカル開発版を表示するため、インストーラーは `HKCU\Software\Adobe\CSXS.12` の文字列 `PlayerDebugMode` を `1` に設定します。他の未署名CEP拡張にも適用される共有設定です。

FFmpegはこのリポジトリに同梱していません。インストーラーは[固定リリースb6.1.1](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1)から取得し、SHA-256を照合します。取得できない場合は[FFmpeg公式案内](https://ffmpeg.org/download.html)にあるWindowsビルドの `ffmpeg.exe` を、インストール先の `bin` フォルダーに配置してください。PATH上のFFmpegも利用できます。

削除するときはPremiereを終了し、PowerShellで `powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall-windows.ps1` を実行します。元の素材と出力MOV、共有の開発用レジストリ設定は残します。

## 確認状況

Linux上で自動テスト31件とブラウザーの画面操作、FFmpegの実レンダリングを確認しています。**WindowsのインストーラーとPremiere Pro実機内での動作は未検証です。** 署名済みMarketplace製品ではありません。詳しくは `検証結果.txt` を参照してください。

開発用の再検証にはNode.js 18以降、FFmpeg、ffprobeを用意して `npm test` を実行します。パネル本体へのnpmパッケージ導入は不要です。
