/* Experimental CEP timeline capture. ES3 only. Original clips/ranges are never edited. */
var CardTimelineTrial = (function () {
    function quote(value) { return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\u0000-\u001f]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }) + '"'; }
    function json(value) { if (value === null) return 'null'; if (typeof value === 'string') return quote(value); if (typeof value === 'number' || typeof value === 'boolean') return String(value); var parts = [], i; if (value instanceof Array) { for (i = 0; i < value.length; i++) parts.push(json(value[i])); return '[' + parts.join(',') + ']'; } for (i in value) if (Object.prototype.hasOwnProperty.call(value, i)) parts.push(quote(i) + ':' + json(value[i])); return '{' + parts.join(',') + '}'; }
    function fail(error, stage) { return json({ ok: false, stage: stage, error: String(error && error.message || error) }); }
    function tick(value) { value = String(value); if (!/^\d{1,32}$/.test(value)) throw new Error('クリップの時刻を確認できません。'); return value.replace(/^0+/, '') || '0'; }
    function after(a, b) { a = tick(a); b = tick(b); return a.length > b.length || a.length === b.length && a > b; }
    function subtract(a, b) { a = tick(a); b = tick(b); if (!after(a, b) && a !== b) throw new Error('クリップの長さを確認できません。'); var out = '', borrow = 0, j = b.length - 1; for (var i = a.length - 1; i >= 0; i--, j--) { var n = Number(a.charAt(i)) - borrow - (j >= 0 ? Number(b.charAt(j)) : 0); borrow = n < 0 ? 1 : 0; out = (n < 0 ? n + 10 : n) + out; } return tick(out); }
    function finite(value) { return typeof value === 'number' && isFinite(value); }
    function count(value, limit) { value = Number(value); if (!isFinite(value) || value < 0 || value % 1 || value > limit) throw new Error('トラック情報を確認できません。'); return value; }
    function format(seq) { var w = Number(seq.frameSizeHorizontal), h = Number(seq.frameSizeVertical), tb = tick(seq.timebase); if (!finite(w) || !finite(h) || w < 16 || h < 16 || w > 16384 || h > 16384 || tb === '0') throw new Error('シーケンスの画面サイズ・fpsを確認できません。'); return { width: w, height: h, timebase: tb }; }
    function project() { var p = app.project; if (!p || !p.activeSequence || !p.documentID) throw new Error('Premiereでプロジェクトとシーケンスを開いてください。'); return p; }
    function ids(p) { var map = {}, n = count(p.sequences.numSequences, 10000); for (var i = 0; i < n; i++) map[String(p.sequences[i].sequenceID)] = p.sequences[i]; return map; }
    function newSequence(p, before, returned) { var now = ids(p), found = [], id; for (id in now) if (!before[id]) found.push(now[id]); if (returned && returned.sequenceID && !before[String(returned.sequenceID)] && now[String(returned.sequenceID)]) return now[String(returned.sequenceID)]; if (found.length !== 1) throw new Error('作成した一時シーケンスを特定できません。Premiereでシーケンス一覧を確認してください。'); return found[0]; }
    function clips(seq) { var output = [], groups = [seq.videoTracks, seq.audioTracks]; for (var g = 0; g < groups.length; g++) for (var t = 0, n = count(groups[g].numTracks, 1000); t < n; t++) for (var i = 0, c = count(groups[g][t].clips.numItems, 100000); i < c; i++) output.push({ group: g, track: t, item: groups[g][t].clips[i] }); return output; }
    function fingerprint(seq) { var list = clips(seq), result = []; for (var i = 0; i < list.length; i++) { var row = list[i], c = row.item; result.push([row.group, row.track, String(c.nodeId), tick(c.start.ticks), tick(c.end.ticks), String(c.name)].join('|')); } return result.join('\n'); }
    function selectedCandidate() {
        var p = project(), seq = p.activeSequence, selection = seq.getSelection();
        if (!selection || selection.length !== 1) throw new Error('タイムラインでテロップのビデオクリップを1つだけ選択してください。');
        var item = selection[0], found = null, list = clips(seq), f = format(seq);
        for (var i = 0; i < list.length; i++) if (list[i].group === 0 && String(list[i].item.nodeId) === String(item.nodeId)) { found = list[i]; break; }
        if (!found || !item.nodeId || !item.name || item.disabled || item.isAdjustmentLayer && item.isAdjustmentLayer()) throw new Error('調整レイヤー・音声・キャプションではなく、表示中のテロップのビデオクリップを選択してください。');
        if (item.projectItem && item.projectItem.isSequence && item.projectItem.isSequence()) throw new Error('ネスト内のテロップを開き、そのクリップを直接選んでください。');
        var ci = -1, track = seq.videoTracks[found.track]; for (var j = 0; j < count(track.clips.numItems, 100000); j++) if (String(track.clips[j].nodeId) === String(item.nodeId)) ci = j;
        var start = tick(item.start.ticks), end = tick(item.end.ticks); if (!after(end, start)) throw new Error('クリップの長さを確認できません。');
        return { projectId: String(p.documentID), sequenceId: String(seq.sequenceID), sequenceName: String(seq.name || 'シーケンス'), clipId: String(item.nodeId), clipName: String(item.name), trackIndex: found.track, clipIndex: ci, startTicks: start, endTicks: end, width: f.width, height: f.height, timebase: f.timebase };
    }
    function onlyClip(seq, duration) { var list = clips(seq); if (list.length !== 1 || list[0].group !== 0 || tick(list[0].item.start.ticks) !== '0' || subtract(list[0].item.end.ticks, list[0].item.start.ticks) !== duration) throw new Error('テロップ1つだけの複製を確認できませんでした。登録を停止しました。'); return list[0].item; }
    function free(track, position) { try { var locked = track.isLocked(); if (locked !== false && locked !== 0) return false; if (track.isMuted) { var muted = track.isMuted(); if (muted !== false && muted !== 0) return false; } for (var i = 0, n = count(track.clips.numItems, 100000); i < n; i++) if (after(track.clips[i].end.ticks, position)) return false; return true; } catch (e) { return false; } }
    return {
        trialSelection: function () { try { return json({ ok: true, candidate: selectedCandidate() }); } catch (e) { return fail(e, 'selection'); } },
        trialCapture: function (expected, outputPath) {
            var p, source, original, originalIn, originalOut, position, owned = [], warnings = [], result = null, failure = null, stage = 'selection';
            try {
                p = project(); source = p.activeSequence; var candidate = selectedCandidate();
                if (!expected) throw new Error('確認した選択クリップの情報がありません。');
                var fields = ['projectId', 'sequenceId', 'clipId', 'trackIndex', 'clipIndex', 'startTicks', 'endTicks', 'clipName', 'width', 'height', 'timebase']; for (var k = 0; k < fields.length; k++) if (String(candidate[fields[k]]) !== String(expected[fields[k]])) throw new Error('確認後に選択クリップや位置が変わりました。もう一度選択して読み込んでください。');
                if (typeof outputPath !== 'string' || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(outputPath) || !/\.prproj$/i.test(outputPath) || /[\u0000-\u001f]/.test(outputPath)) throw new Error('試験テロップの保存先を確認できません。');
                if (new File(outputPath).exists) throw new Error('保存先に既存ファイルがあります。上書きは行いません。');
                if (!source.clone || !p.deleteSequence || !p.openSequence) throw new Error('一時シーケンスの作成・後片付けAPIを使用できません。');
                original = fingerprint(source); originalIn = source.getInPoint(); originalOut = source.getOutPoint(); position = tick(source.getPlayerPosition().ticks);
                stage = 'clone'; var before = ids(p), copy = newSequence(p, before, source.clone()); owned.push(copy);copy.name='CardReveal Temp - '+candidate.clipName;
                if (String(copy.sequenceID) === String(source.sequenceID)) throw new Error('元のシーケンスは変更できません。');
                var copyItem = copy.videoTracks[candidate.trackIndex].clips[candidate.clipIndex];
                if (!copyItem || tick(copyItem.start.ticks) !== candidate.startTicks || tick(copyItem.end.ticks) !== candidate.endTicks || String(copyItem.name) !== candidate.clipName) throw new Error('複製したクリップが元の選択と一致しません。');
                var rows = clips(copy); for (var i = 0; i < rows.length; i++) rows[i].item.setSelected(0, 0); copyItem.setSelected(1, 1);
                var begin = copyItem.start.seconds, end = copyItem.end.seconds; if (!finite(begin) || !finite(end) || end <= begin) throw new Error('クリップの秒数を確認できません。');
                copy.setInPoint(begin); copy.setOutPoint(end);
                stage = 'subsequence'; before = ids(p); var sub = newSequence(p, before, copy.createSubsequence(true)); owned.push(sub);
                var duration = subtract(candidate.endTicks, candidate.startTicks); onlyClip(sub, duration); var f = format(sub);
                if (f.width !== candidate.width || f.height !== candidate.height || f.timebase !== candidate.timebase) throw new Error('複製した画面サイズ・fpsが元と一致しません。');
                sub.name = 'CardReveal Trial - ' + candidate.clipName; sub.setInPoint(0); sub.setOutPoint(end - begin);
                stage = 'export'; sub.exportAsProject(outputPath); var file = new File(outputPath); if (!file.exists || !(file.length > 0)) throw new Error('Premiereのプロジェクト形式での保管を確認できませんでした。');
                result = { ok: true, template: { sequenceId: String(sub.sequenceID), width: f.width, height: f.height, timebase: f.timebase, durationTicks: duration, sourceName: candidate.clipName }, warnings: warnings };
            } catch (e) { failure = e; }
            finally {
                if (p && source) {
                    for (var d = owned.length - 1; d >= 0; d--) try { if (String(owned[d].sequenceID) !== String(source.sequenceID) && p.deleteSequence(owned[d]) !== true) warnings.push('一時シーケンスを削除できませんでした。Premiereで確認してください。'); } catch (clean) { warnings.push('一時シーケンスの削除時にエラーが発生しました。'); }
                    try { if (String(p.activeSequence && p.activeSequence.sequenceID) !== String(source.sequenceID)) p.openSequence(String(source.sequenceID)); if (position && tick(source.getPlayerPosition().ticks) !== position) source.setPlayerPosition(position); } catch (restore) { warnings.push('元のシーケンスへ表示を戻せませんでした。'); }
                    try { if (original !== undefined && (fingerprint(source) !== original || source.getInPoint() !== originalIn || source.getOutPoint() !== originalOut)) failure = new Error('元のシーケンスの状態が変わっています。再試行する前にPremiereで確認してください。'); } catch (verify) { failure = verify; }
                }
            }
            if (failure) return fail(new Error(String(failure.message || failure) + (warnings.length ? ' ' + warnings.join(' ') : '')), stage);
            return json(result);
        },
        trialInsert: function (templatePath, sequenceId, requestedTrack, spec) {
            var p, target, imported = null, warnings = [], stage = 'preflight';
            try {
                p = project(); target = p.activeSequence;
                if (typeof sequenceId !== 'string' || !sequenceId || sequenceId.length>200 || /[\u0000-\u001f]/.test(sequenceId)) throw new Error('保管したシーケンスのIDを確認できません。');
                if (typeof templatePath !== 'string' || !/\.prproj$/i.test(templatePath) || !new File(templatePath).exists) throw new Error('保管した試験テロップのプロジェクトが見つかりません。');
                var f = format(target); if (!spec || f.width !== spec.width || f.height !== spec.height || f.timebase !== tick(spec.timebase)) throw new Error('元のテロップと同じ画面サイズ・fpsのテストシーケンスを開いてください。');
                var now = target.getPlayerPosition(), position = tick(now.ticks); if (!finite(now.seconds) || now.seconds < 0) throw new Error('挿入位置を確認できません。');
                var groups = [target.videoTracks, target.audioTracks], video = -1;
                // A sequence project item can also insert a silent audio item.
                // The trial therefore requires every track to be empty after CTI.
                for (var g = 0; g < groups.length; g++) for (var t = 0, n = count(groups[g].numTracks, 1000); t < n; t++) if (!free(groups[g][t], position)) throw new Error('試験挿入は全トラックで再生ヘッド以降が空のシーケンスに限ります。空のテストシーケンスでお試しください。');
                var nv = count(target.videoTracks.numTracks, 1000); if (requestedTrack === 'auto') video = nv - 1; else if (typeof requestedTrack === 'number' && requestedTrack >= 0 && requestedTrack % 1 === 0 && requestedTrack < nv) video = requestedTrack;
                if (video < 0 || !target.videoTracks[video].overwriteClip) throw new Error('指定した挿入先のビデオトラックを使用できません。');
                var old = clips(target), oldIds = {}, before = ids(p); for (var i = 0; i < old.length; i++) oldIds[String(old[i].item.nodeId)] = [old[i].group, old[i].track, tick(old[i].item.start.ticks), tick(old[i].item.end.ticks)].join('|');
                stage = 'import'; if (!p.importSequences(templatePath, [sequenceId])) throw new Error('試験テロップのプロジェクトを読み込めませんでした。');
                imported = newSequence(p, before, null); onlyClip(imported, tick(spec.durationTicks)); var importedFormat = format(imported); if (importedFormat.width !== f.width || importedFormat.height !== f.height || importedFormat.timebase !== f.timebase) throw new Error('読み込んだテロップのサイズ・fpsが一致しません。');
                if (!imported.projectItem) throw new Error('読み込んだテロップのシーケンス素材を確認できません。');
                stage = 'overwrite'; target.videoTracks[video].overwriteClip(imported.projectItem, now.seconds);
                var current = clips(target), addedVideo = [], audioAdded = 0, seen = {}, verified = true;
                for (i = 0; i < current.length; i++) { var row = current[i], id = String(row.item.nodeId); if (oldIds[id]) { seen[id] = true; if (oldIds[id] !== [row.group, row.track, tick(row.item.start.ticks), tick(row.item.end.ticks)].join('|')) verified = false; } else if (row.group === 0) { addedVideo.push(row); } else { audioAdded++; if (tick(row.item.start.ticks) !== position || subtract(row.item.end.ticks, row.item.start.ticks) !== tick(spec.durationTicks)) verified = false; } }
                for (var id in oldIds) if (!seen[id]) verified = false;
                if (addedVideo.length !== 1 || addedVideo[0].track !== video || tick(addedVideo[0].item.start.ticks) !== position || subtract(addedVideo[0].item.end.ticks, addedVideo[0].item.start.ticks) !== tick(spec.durationTicks)) verified = false;
                try { p.openSequence(String(target.sequenceID)); } catch (ignored) {}
                return json({ ok: true, inserted: true, verified: verified, videoTrack: video, audioAdded: audioAdded, startTicks: position, sequenceName: String(target.name), warnings: warnings });
            } catch (e) {
                if (p && target) try { p.openSequence(String(target.sequenceID)); } catch (ignored) {}
                // Once overwrite was attempted, do not delete dependencies or retry.
                if (imported && stage !== 'overwrite') try { p.deleteSequence(imported); } catch (ignored) {}
                return fail(new Error(String(e.message || e) + (stage === 'overwrite' ? ' 再度押す前にタイムラインを確認してください。' : '')), stage);
            }
        }
    };
}());
