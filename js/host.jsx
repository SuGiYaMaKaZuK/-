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
    function tickString(value) {
        var result = String(value);
        if (!/^\d+$/.test(result)) throw new Error('再生ヘッドの位置を確認できません。');
        result = result.replace(/^0+/, '');
        return result || '0';
    }
    function afterTick(a, b) { a = tickString(a); b = tickString(b); return a.length > b.length || (a.length === b.length && a > b); }
    function trackIsFree(track, position) {
        try {
            var locked = track.isLocked();
            if (locked !== false && locked !== 0) return false;
            if (track.isMuted) { var muted = track.isMuted(); if (muted !== false && muted !== 0) return false; }
            var count = Number(track.clips.numItems);
            if (!isFinite(count) || count < 0 || count % 1) return false;
            for (var i = 0; i < count; i++) if (afterTick(track.clips[i].end.ticks, position)) return false;
            return true;
        } catch (e) { return false; }
    }
    function freeTrack(collection, requested, position, label) {
        var count = Number(collection && collection.numTracks);
        if (!isFinite(count) || count < 1 || count > 1000 || count % 1) throw new Error('空きの' + label + 'トラックを追加してください。');
        if (requested !== 'auto') {
            if (typeof requested !== 'number' || requested < 0 || requested % 1 || requested >= count) throw new Error('保存した挿入先トラックがありません。テロップの設定を変更してください。');
            if (!trackIsFree(collection[requested], position)) throw new Error('挿入先の' + label + 'トラックはロック・非表示、または再生ヘッド以降にクリップがあります。空きトラックを選んでください。');
            return requested;
        }
        for (var i = count - 1; i >= 0; i--) if (trackIsFree(collection[i], position)) return i;
        throw new Error('再生ヘッド以降にクリップがない' + label + 'トラックを追加してください。既存のクリップは変更していません。');
    }
    return {
        pickTitleTemplate: function () {
            try { return selected(File.openDialog('いつものテロップを保存した.mogrtを選択', 'Motion Graphics Template:*.mogrt', false)); } catch(e) { return error(e); }
        },
        titleContext: function () {
            try {
                var seq = app.project && app.project.activeSequence;
                if (!seq) return '{"ok":true,"sequenceName":null,"videoTracks":[]}';
                var tracks = [], count = Number(seq.videoTracks.numTracks);
                if (!isFinite(count) || count < 0 || count > 1000) throw new Error('ビデオトラックを確認できません。');
                for (var i = 0; i < count; i++) tracks.push('{"index":' + i + ',"name":' + quote(seq.videoTracks[i].name || ('V' + (i + 1))) + '}');
                return '{"ok":true,"sequenceName":' + quote(seq.name || 'シーケンス') + ',"videoTracks":[' + tracks.join(',') + ']}';
            } catch(e) { return error(e); }
        },
        insertTitle: function (templatePath, videoTrack) {
            try {
                if (typeof templatePath !== 'string' || !/\.mogrt$/i.test(templatePath)) throw new Error('.mogrtファイルを選んでください。');
                var file = new File(templatePath);
                if (!file.exists) throw new Error('登録したテロップのファイルが見つかりません。登録し直してください。');
                var seq = app.project && app.project.activeSequence;
                if (!seq) throw new Error('Premiereで挿入先のシーケンスを開いてください。');
                if (!seq.importMGT) throw new Error('このPremiereではテンプレートの挿入APIを使用できません。');
                var position = tickString(seq.getPlayerPosition().ticks);
                var video = freeTrack(seq.videoTracks, videoTrack, position, 'ビデオ');
                var audio = freeTrack(seq.audioTracks, 'auto', position, '音声');
                var item = seq.importMGT(file.fsName, position, video, audio);
                if (!item) throw new Error('挿入結果を確認できませんでした。再試行する前にタイムラインを確認してください。');
                var verified = false;
                try { verified = tickString(item.start.ticks) === position && afterTick(item.end.ticks, position); } catch (e) {}
                try { var selection = seq.getSelection(); for (var j = 0; j < selection.length; j++) selection[j].setSelected(0, 0); item.setSelected(1, 1); } catch (e) {}
                return '{"ok":true,"inserted":true,"verified":' + (verified ? 'true' : 'false') + ',"videoTrack":' + video + ',"audioTrack":' + audio + ',"startTicks":' + quote(position) + ',"sequenceName":' + quote(seq.name || 'シーケンス') + '}';
            } catch(e) { return error(e); }
        },
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
