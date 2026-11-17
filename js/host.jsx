/* ExtendScript ES3: JSON serialization kept local; no external JSON library required. */
var CardReveal = (function () {
    function quote(value) {
        return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/[\u0000-\u001f]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }) + '"';
    }
    function error(e) { return '{"ok":false,"error":' + quote((e && e.message) || e || 'ホスト処理に失敗しました。') + '}'; }
    function selected(file) { return file ? quote(file.fsName) : 'null'; }
    function defaultFolder() {
        var folder = new Folder(Folder.myDocuments.fsName + '/Card Reveal');
        if (!folder.exists) folder.create();
        return folder;
    }
    return {
        pickMedia: function () {
            try { return selected(File.openDialog('カードに表示する画像または動画を選択', undefined, false)); } catch(e) { return error(e); }
        },
        pickSaveProject: function () {
            try { return selected(new File(defaultFolder().fsName + '/card-reveal.json').saveDlg('カード設定の保存先', 'JSON:*.json')); } catch(e) { return error(e); }
        },
        pickLoadProject: function () {
            try { return selected(File.openDialog('カード設定を読み込み', 'JSON:*.json', false)); } catch(e) { return error(e); }
        },
        pickOutput: function () {
            try { return selected(new File(defaultFolder().fsName + '/card-reveal-' + new Date().getTime() + '.mov').saveDlg('透過動画の保存先', 'QuickTime Movie:*.mov')); } catch(e) { return error(e); }
        },
        revealOutput: function (filePath) {
            try {
                var file = new File(filePath);
                if (!file.exists) throw new Error('書き出した動画が見つかりません。');
                var folder = file.parent;
                if (!folder || !folder.exists || !folder.execute()) throw new Error('保存先のフォルダーを開けませんでした。');
                return '{"ok":true,"folderPath":' + quote(folder.fsName) + '}';
            } catch(e) { return error(e); }
        },
        importRendered: function (filePath) {
            try {
                if (!app.project || !app.project.rootItem) throw new Error('先にPremiere Proでプロジェクトを開いてください。');
                var file = new File(filePath);
                if (!file.exists) throw new Error('書き出した動画が見つかりません。');
                var bin = app.project.getInsertionBin() || app.project.rootItem;
                var success = app.project.importFiles([file.fsName], true, bin, false);
                if (!success) throw new Error('動画の読み込みに失敗しました。書き出したMOVを手動で読み込んでください。');
                return '{"ok":true}';
            } catch(e) { return error(e); }
        }
    };
}());
