'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const renderer = require('../js/render');
const model = require('../js/model');

async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'card-reveal-test-'));
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  function command(file, args, options) {
    const result = cp.spawnSync(file, args, Object.assign({ maxBuffer: 80 * 1024 * 1024 }, options));
    if (result.error) throw result.error;
    assert.strictEqual(result.status, 0, result.stderr && result.stderr.toString());
    return result.stdout;
  }
  function project(mediaPath, mediaType) {
    return { width: 320, height: 180, fps: 20, duration: 3, cardWidth: 80, cardHeight: 100,
      dropDuration: 0.4, flipDuration: 0.6, backColor: '#202030', borderColor: '#f0cf80',
      cards: [{ id: 'a', name: '素材テスト', mediaPath: mediaPath || '', mediaType: mediaType || '', x: 160, y: 90, dropAt: 0.2, flipAt: 1.2, mediaOffset: 0 }] };
  }
  function frames(file) {
    return command(ffmpegPath, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
  }
  function pixel(buffer, time, x, y, fps) {
    const offset = (Math.round(time * (fps || 20)) * 320 * 180 + y * 320 + x) * 4;
    return Array.from(buffer.subarray(offset, offset + 4));
  }
  try {
    // Shell metacharacters and Japanese characters must remain a literal file
    // path. PPM also gives a known source color independent of JPEG artifacts.
    const imagePath = path.join(temporary, '赤 $(not-a-command) & image.ppm');
    fs.writeFileSync(imagePath, Buffer.concat([Buffer.from('P6\n80 100\n255\n'), Buffer.from(Array.from({ length: 80 * 100 }, function () { return [255, 0, 0]; }).flat())]));
    const imageProject = project(imagePath, 'image');
    const imageMovie = path.join(temporary, 'image.mov');
    const progress = [];
    await renderer.render(imageProject, { ffmpegPath: ffmpegPath, outputPath: imageMovie, onProgress: function (value) { progress.push(value); } });
    assert.strictEqual(progress[progress.length - 1], 1);
    const probe = JSON.parse(command(ffprobePath, ['-v', 'error', '-show_entries', 'stream=codec_name,pix_fmt,width,height,nb_frames', '-of', 'json', imageMovie]).toString()).streams[0];
    assert.strictEqual(probe.codec_name, 'prores');
    assert.ok(/^yuva444p/.test(probe.pix_fmt), 'render must carry an alpha channel');
    assert.deepStrictEqual([probe.width, probe.height, Number(probe.nb_frames)], [320, 180, 60]);
    const imageFrames = frames(imageMovie);
    assert.strictEqual(pixel(imageFrames, 0, 160, 90)[3], 0, 'nothing visible before card entrance');
    assert.strictEqual(pixel(imageFrames, 0.3, 160, 90)[3], 0, 'fall has not reached final position');
    assert.ok(pixel(imageFrames, 0.3, 160, 10)[3] > 250, 'falling card is higher than final position');
    const back = pixel(imageFrames, 0.9, 160, 90);
    assert.ok(Math.abs(back[0] - 32) < 5 && Math.abs(back[2] - 48) < 5 && back[3] > 250, 'card shows requested back color before flip');
    assert.strictEqual(pixel(imageFrames, 1.5, 148, 90)[3], 0, 'card becomes a thin edge at half flip');
    const front = pixel(imageFrames, 2.4, 160, 90);
    assert.ok(front[0] > 240 && front[1] < 10 && front[2] < 10 && front[3] > 250, 'image becomes visible after flip');
    assert.strictEqual(pixel(imageFrames, 2.4, 5, 5)[3], 0, 'background remains transparent');

    const patternPath = path.join(temporary, 'four-color-pattern.ppm');
    const pattern = Buffer.alloc(320 * 100 * 3);
    const bands = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
    for (let row = 0; row < 100; row += 1) {
      for (let column = 0; column < 320; column += 1) {
        const value = bands[Math.floor(column / 80)];
        const offset = (row * 320 + column) * 3;
        pattern[offset] = value[0]; pattern[offset + 1] = value[1]; pattern[offset + 2] = value[2];
      }
    }
    fs.writeFileSync(patternPath, Buffer.concat([Buffer.from('P6\n320 100\n255\n'), pattern]));
    const transformed = project(patternPath, 'image');
    Object.assign(transformed.cards[0], { x: 80, mediaScale: 25, mediaX: 10, mediaY: -10 });
    transformed.cards.push(Object.assign({}, transformed.cards[0], { id: 'zoomed', x: 240, mediaScale: 400, mediaX: -20, mediaY: 0 }));
    const transformedMovie = path.join(temporary, 'transformed-cards.mov');
    await renderer.render(transformed, { ffmpegPath: ffmpegPath, outputPath: transformedMovie });
    const transformedFrames = frames(transformedMovie);
    assert.ok(pixel(transformedFrames, 2.4, 55, 80)[0] > 240, 'shrinking exposes original far-left red band that cover crop would have removed');
    const yellow = pixel(transformedFrames, 2.4, 115, 80);
    assert.ok(yellow[0] > 240 && yellow[1] > 240 && yellow[2] < 10, 'shrinking exposes original far-right yellow band before cropping');
    const hole = pixel(transformedFrames, 2.4, 45, 80);
    assert.ok(Math.abs(hole[0] - 32) < 5 && Math.abs(hole[2] - 48) < 5 && hole[3] > 250, 'card holes expose its opaque original back after horizontal pan');
    const lowerHole = pixel(transformedFrames, 2.4, 80, 100);
    assert.ok(Math.abs(lowerHole[0] - 32) < 5 && Math.abs(lowerHole[2] - 48) < 5, 'negative mediaY moves image up inside a stationary card');
    const insetHole = pixel(transformedFrames, 2.4, 50, 100);
    assert.ok(Math.abs(insetHole[0] - 32) < 5 && Math.abs(insetHole[2] - 48) < 5, 'revealed front gaps are plain backColor and never leak decorative back inset lines');
    const cardBorder = pixel(transformedFrames, 2.4, 80, 40);
    assert.ok(cardBorder[0] > 225 && cardBorder[1] > 190 && cardBorder[2] > 110, 'card border stays fixed independently of source transform');
    assert.ok(pixel(transformedFrames, 2.4, 210, 90)[1] > 230, '400% crop uses full-source scale and pan at left side of boundary');
    assert.ok(pixel(transformedFrames, 2.4, 230, 90)[2] > 230, '400% crop preserves full-source scale and position on right side of boundary');
    transformed.cards[0].mediaX = 600;
    const fullyPannedMovie = path.join(temporary, 'fully-panned.mov');
    const offFrameController = new AbortController();
    const offFrameTimeout = setTimeout(function () { offFrameController.abort(); }, 3000);
    try { await renderer.render(transformed, { ffmpegPath: ffmpegPath, outputPath: fullyPannedMovie, signal: offFrameController.signal }); }
    finally { clearTimeout(offFrameTimeout); }
    const fullyPannedFrame = command(ffmpegPath, ['-v', 'error', '-ss', '2.4', '-i', fullyPannedMovie, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
    const offFrameBack = pixel(fullyPannedFrame, 0, 80, 90);
    assert.ok(Math.abs(offFrameBack[0] - 32) < 5 && Math.abs(offFrameBack[2] - 48) < 5 && offFrameBack[3] > 250, 'completely off-frame image finishes and reveals a plain opaque card front');
    const sideDataVideo = path.join(temporary, 'large-side-data.mp4');
    command(ffmpegPath, ['-v', 'error', '-y', '-i', patternPath, '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bsf:v', 'h264_metadata=sei_user_data=00000000000000000000000000000000+' + 'A'.repeat(12000), sideDataVideo]);
    const sideDataProject = project(sideDataVideo, 'video');
    Object.assign(sideDataProject.cards[0], { mediaScale: 400, mediaX: -20, mediaY: 0 });
    const sideDataMovie = path.join(temporary, 'large-side-data-transformed.mov');
    await renderer.render(sideDataProject, { ffmpegPath: ffmpegPath, outputPath: sideDataMovie });
    const sideDataFrame = command(ffmpegPath, ['-v', 'error', '-ss', '2.4', '-i', sideDataMovie, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
    assert.ok(pixel(sideDataFrame, 0, 130, 90)[1] > 225 && pixel(sideDataFrame, 0, 170, 90)[2] > 225, 'large SEI side data cannot discard source dimensions needed for efficient 400% viewport scaling');
    const invalidTransform = project();
    invalidTransform.cards[0].mediaScale = 401;
    assert.throws(function () { renderer.buildArgs(invalidTransform, path.join(temporary, 'invalid-transform.mov')); }, /素材の拡大率/);
    invalidTransform.cards[0].mediaScale = 100;
    invalidTransform.cards[0].mediaX = NaN;
    assert.throws(function () { renderer.buildArgs(invalidTransform, path.join(temporary, 'invalid-transform.mov')); }, /素材のX位置/);

    const videoPath = path.join(temporary, 'blue-then-green.mkv');
    command(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=blue:s=80x100:r=20:d=1', '-f', 'lavfi', '-i', 'color=lime:s=80x100:r=20:d=0.6', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-c:v', 'ffv1', videoPath]);
    const videoProject = project(videoPath, 'video');
    videoProject.cards[0].mediaOffset = 0.5;
    const videoMovie = path.join(temporary, 'video.mov');
    await renderer.render(videoProject, { ffmpegPath: ffmpegPath, outputPath: videoMovie });
    const videoFrames = frames(videoMovie);
    const first = pixel(videoFrames, 1.85, 160, 90);
    const second = pixel(videoFrames, 2.2, 160, 90);
    const held = pixel(videoFrames, 2.9, 160, 90);
    assert.ok(first[2] > 230 && first[1] < 20, 'video begins at the chosen source offset when front appears');
    assert.ok(second[1] > 230 && second[2] < 20, 'video advances after reveal');
    assert.ok(held[1] > 230 && held[2] < 20, 'short video holds final frame through end of composition');
    const invalid = project(path.join(temporary, 'missing.png'), 'image');
    assert.throws(function () { renderer.buildArgs(invalid, path.join(temporary, 'missing.mov')); }, function (error) {
      return error.code === 'MEDIA_NOT_FOUND' && /カード1「素材テスト」/.test(error.message) && /選び直してください/.test(error.message);
    });
    assert.throws(function () { renderer.buildArgs(project(), 'relative.mov'); }, /絶対パス/);
    const existingMovie = path.join(temporary, 'existing.mov');
    fs.writeFileSync(existingMovie, 'existing movie must survive a failed render');
    await assert.rejects(renderer.render(project(), { ffmpegPath: path.join(temporary, 'missing-ffmpeg'), outputPath: existingMovie }), function (error) {
      return error.code === 'FFMPEG_NOT_FOUND' && /FFmpegが見つかりません/.test(error.message) && error.technicalDetails.indexOf('ENOENT') !== -1 && error.message.indexOf('ENOENT') === -1;
    });
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.strictEqual(fs.readFileSync(existingMovie, 'utf8'), 'existing movie must survive a failed render');
    const emptyImage = path.join(temporary, 'empty.png');
    fs.writeFileSync(emptyImage, '');
    assert.throws(function () { renderer.buildArgs(project(emptyImage, 'image'), existingMovie); }, function (error) {
      return error.code === 'MEDIA_EMPTY' && /カード1「素材テスト」/.test(error.message) && /空です/.test(error.message);
    });
    const invalidImage = path.join(temporary, 'invalid.png');
    fs.writeFileSync(invalidImage, 'This file is not an image.');
    await assert.rejects(renderer.render(project(invalidImage, 'image'), { ffmpegPath: ffmpegPath, outputPath: existingMovie }), function (error) {
      return error.code === 'MEDIA_DECODE_FAILED' && /カード1「素材テスト」/.test(error.message) && error.technicalDetails.length > 0 && error.message.indexOf(invalidImage) === -1;
    });
    const pastEnd = project(videoPath, 'video');
    pastEnd.cards[0].name = 'ボスの動画';
    pastEnd.cards[0].mediaOffset = 99;
    await assert.rejects(renderer.render(pastEnd, { ffmpegPath: ffmpegPath, outputPath: existingMovie }), function (error) {
      return error.code === 'MEDIA_OFFSET_OUT_OF_RANGE' && /カード1「ボスの動画」/.test(error.message) && /99秒/.test(error.message) && /開始位置を短く/.test(error.message);
    });
    assert.strictEqual(fs.readFileSync(existingMovie, 'utf8'), 'existing movie must survive a failed render');
    if (process.platform !== 'win32') {
      const deniedExecutable = path.join(temporary, 'denied-ffmpeg');
      fs.writeFileSync(deniedExecutable, 'not executable');
      fs.chmodSync(deniedExecutable, 0o600);
      await assert.rejects(renderer.render(project(), { ffmpegPath: deniedExecutable, outputPath: existingMovie }), function (error) {
        return error.code === 'FFMPEG_PERMISSION' && /権限がありません/.test(error.message) && error.technicalDetails.indexOf('EACCES') !== -1;
      });
    }
    const layered = project();
    layered.cards = [140, 160, 180].map(function (x, index) { return Object.assign({}, layered.cards[0], { id: 'layer-' + index, x: x }); });
    const layeredMovie = path.join(temporary, 'layered.mov');
    await renderer.render(layered, { ffmpegPath: ffmpegPath, outputPath: layeredMovie });
    const layerFrames = frames(layeredMovie);
    const left = pixel(layerFrames, 2.4, 110, 90);
    const middle = pixel(layerFrames, 2.4, 130, 90);
    const top = pixel(layerFrames, 2.4, 150, 90);
    assert.ok(left[0] > 100 && left[2] > 150, 'first card remains visible outside overlap');
    assert.ok(middle[1] > 110 && middle[0] < 40, 'second card covers first in overlap');
    assert.ok(top[0] > 160 && top[1] < 110 && top[2] < 60, 'third card covers both earlier cards');
    const cancelOutput = path.join(temporary, 'canceled.mov');
    fs.writeFileSync(cancelOutput, 'existing output before cancellation');
    const controller = new AbortController();
    const longProject = project();
    longProject.duration = 120;
    longProject.width = 1920;
    longProject.height = 1080;
    const pendingRender = renderer.render(longProject, { ffmpegPath: ffmpegPath, outputPath: cancelOutput, signal: controller.signal });
    const abortTimer = setTimeout(function () { controller.abort(); }, 100);
    await assert.rejects(pendingRender, function (error) { return error.code === 'CANCELLED' && /中止/.test(error.message); });
    clearTimeout(abortTimer);
    assert.strictEqual(fs.readFileSync(cancelOutput, 'utf8'), 'existing output before cancellation');
    assert.strictEqual(fs.readdirSync(temporary).filter(function (name) { return name.indexOf('.canceled.mov.') === 0; }).length, 0, 'cancellation removes partial output');
    const greenImage = path.join(temporary, 'green.ppm');
    const blueImage = path.join(temporary, 'blue.ppm');
    [greenImage, blueImage].forEach(function (file, index) {
      const value = index === 0 ? [0, 255, 0] : [0, 0, 255];
      fs.writeFileSync(file, Buffer.concat([Buffer.from('P6\n80 100\n255\n'), Buffer.from(Array.from({ length: 80 * 100 }, function () { return value; }).flat())]));
    });
    const split = model.createProject();
    Object.assign(split, { mode: 'trapezoid', width: 320, height: 180, fps: 120, duration: 2, backgroundMode: 'transparent' });
    Object.assign(split.trapezoid, { angle: 8, borderWidth: 3, borderColor: '#ffffff', slideDuration: 0.4, interval: 0.25, startAt: 0.1 });
    [imagePath, greenImage, blueImage].forEach(function (file, index) { Object.assign(split.cards[index], { mediaPath: file, mediaType: 'image' }); });
    split.cards.push(Object.assign({}, invalid.cards[0], { id: 'unused-card' }));
    const splitMovie = path.join(temporary, 'split.mov');
    await renderer.render(split, { ffmpegPath: ffmpegPath, outputPath: splitMovie });
    const splitProbe = JSON.parse(command(ffprobePath, ['-v', 'error', '-show_entries', 'stream=r_frame_rate,nb_frames', '-of', 'json', splitMovie]).toString()).streams[0];
    assert.deepStrictEqual([splitProbe.r_frame_rate, Number(splitProbe.nb_frames)], ['120/1', 240]);
    const splitFrames = frames(splitMovie);
    assert.strictEqual(pixel(splitFrames, 0, 160, 90, 120)[3], 0, 'split background is transparent before arrival');
    assert.ok(pixel(splitFrames, 0.3, 20, 20, 120)[0] > 240, 'left panel slides in first');
    assert.strictEqual(pixel(splitFrames, 0.3, 160, 20, 120)[3], 0, 'center panel waits for its stagger delay');
    assert.strictEqual(pixel(splitFrames, 0.55, 300, 20, 120)[3], 0, 'right panel waits until after center');
    assert.ok(pixel(splitFrames, 1.2, 95, 10, 120)[0] > 240 && pixel(splitFrames, 1.2, 95, 170, 120)[1] > 240, 'left diagonal changes region from red at top to green at bottom');
    assert.ok(pixel(splitFrames, 1.2, 225, 10, 120)[2] > 240 && pixel(splitFrames, 1.2, 225, 170, 120)[1] > 240, 'right diagonal changes region from blue at top to green at bottom');
    const border = pixel(splitFrames, 1.2, 94, 90, 120);
    assert.ok(border[0] > 240 && border[1] > 240 && border[2] > 240 && border[3] > 250, 'internal diagonal border uses the selected white color');
    split.backgroundMode = 'solid';
    split.backgroundColor = '#10131c';
    split.fps = 90;
    split.duration = 1.2;
    Object.assign(split.cards[0], { mediaScale: 25, mediaX: 10, mediaY: 20 });
    Object.assign(split.cards[1], { mediaPath: videoPath, mediaType: 'video', mediaOffset: 0.5, mediaScale: 50, mediaX: -10, mediaY: 20 });
    const solidMovie = path.join(temporary, 'split-solid.mov');
    await renderer.render(split, { ffmpegPath: ffmpegPath, outputPath: solidMovie });
    const solidFirst = command(ffmpegPath, ['-v', 'error', '-i', solidMovie, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
    const background = pixel(solidFirst, 0, 160, 90);
    assert.ok(Math.abs(background[0] - 16) < 5 && Math.abs(background[1] - 19) < 5 && Math.abs(background[2] - 28) < 5 && background[3] > 250, 'solid background uses selected color before panels arrive');
    const solidProbe = JSON.parse(command(ffprobePath, ['-v', 'error', '-show_entries', 'stream=r_frame_rate,nb_frames', '-of', 'json', solidMovie]).toString()).streams[0];
    assert.deepStrictEqual([solidProbe.r_frame_rate, Number(solidProbe.nb_frames)], ['90/1', 108]);
    const earlySplitVideo = command(ffmpegPath, ['-v', 'error', '-ss', '0.65', '-i', solidMovie, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
    const lateSplitVideo = command(ffmpegPath, ['-v', 'error', '-ss', '1.05', '-i', solidMovie, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
    assert.ok(pixel(earlySplitVideo, 0, 160, 90)[2] > 230, 'split video begins from its source offset at its own drop time');
    assert.ok(pixel(lateSplitVideo, 0, 160, 90)[1] > 230, 'split video advances independently after its drop time');
    const splitSolidHole = pixel(lateSplitVideo, 0, 20, 100);
    assert.ok(Math.abs(splitSolidHole[0] - 16) < 5 && Math.abs(splitSolidHole[1] - 19) < 5 && splitSolidHole[3] > 250, 'shrunk split source reveals selected solid background');
    assert.ok(pixel(lateSplitVideo, 0, 60, 110)[0] > 240, 'split image scale and positive X/Y pan are independent of region geometry');
    const transformedDivider = pixel(lateSplitVideo, 0, 94, 90);
    assert.ok(transformedDivider[0] > 240 && transformedDivider[1] > 240 && transformedDivider[2] > 240, 'slanted divider remains fixed when adjacent media move or shrink');
    split.backgroundMode = 'transparent';
    split.fps = 30;
    const transparentTransformMovie = path.join(temporary, 'split-transformed-transparent.mov');
    await renderer.render(split, { ffmpegPath: ffmpegPath, outputPath: transparentTransformMovie });
    const transparentTransformFrame = command(ffmpegPath, ['-v', 'error', '-ss', '1.05', '-i', transparentTransformMovie, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
    assert.strictEqual(pixel(transparentTransformFrame, 0, 20, 100)[3], 0, 'split source holes retain alpha against transparent background');
    assert.strictEqual(pixel(transparentTransformFrame, 0, 160, 30)[3], 0, 'shrunk video leaves alpha above its positive Y offset');
    function highlightDirectories() { return fs.readdirSync(os.tmpdir()).filter(function (name) { return name.indexOf('card-reveal-highlight-') === 0; }).sort(); }
    function oneFrame(file, at) { return command(ffmpegPath, ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']); }
    const beforeHighlightDirectories = highlightDirectories();
    const highlighted = project(imagePath, 'image');
    Object.assign(highlighted, { mode: 'highlight', duration: 0.6 });
    highlighted.cards.push(Object.assign({}, invalid.cards[0], { id: 'unused-highlight-card' }));
    highlighted.highlight = { x: 160, y: 90, width: 80, height: 60, rotation: 0, shape: 'rounded', radius: 12,
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], layers: [] };
    assert.throws(function () { renderer.buildArgs(highlighted, path.join(temporary, 'no-assets.mov')); }, function (error) { return error.code === 'HIGHLIGHT_ASSETS_REQUIRED'; });
    const roundedMovie = path.join(temporary, 'highlight-rounded.mov');
    await renderer.render(highlighted, { ffmpegPath: ffmpegPath, outputPath: roundedMovie });
    const roundedFrame = oneFrame(roundedMovie, 0.2);
    assert.ok(pixel(roundedFrame, 0, 160, 90)[0] > 240, 'highlight image is visible immediately without card drop/flip');
    assert.strictEqual(pixel(roundedFrame, 0, 121, 61)[3], 0, 'rounded highlight masks source corners');
    assert.strictEqual(pixel(roundedFrame, 0, 115, 90)[3], 0, 'empty layer stack leaves no border');
    highlighted.highlight.shape = 'rectangle';
    highlighted.highlight.layers = [
      { id: 'glow', name: '黄色の光', color: '#ffff00', width: 2, glow: 5, opacity: 1, offset: 5, enabled: true },
      { id: 'line', name: '緑の線', color: '#00ff00', width: 4, glow: 0, opacity: 1, offset: 5, enabled: true }
    ];
    const outlinedMovie = path.join(temporary, 'highlight-layers.mov');
    await renderer.render(highlighted, { ffmpegPath: ffmpegPath, outputPath: outlinedMovie });
    const outlinedFrame = oneFrame(outlinedMovie, 0.2);
    assert.ok(pixel(outlinedFrame, 0, 121, 61)[0] > 240 && pixel(outlinedFrame, 0, 121, 61)[3] > 250, 'rectangle shape keeps its square image corners');
    const greenOutline = pixel(outlinedFrame, 0, 115, 90);
    assert.ok(greenOutline[1] > 240 && greenOutline[0] < 15 && greenOutline[3] > 250, 'last enabled outline layer covers an earlier layer in its selected color');
    const nearGlow = pixel(outlinedFrame, 0, 106, 90), farGlow = pixel(outlinedFrame, 0, 102, 90);
    assert.ok(farGlow[3] > 0 && farGlow[3] < nearGlow[3] && nearGlow[3] < 250, 'yellow glow fades into transparent pixels beyond the image perimeter');
    assert.ok(nearGlow[0] > 230 && nearGlow[1] > 230 && nearGlow[2] < 20, 'glow preserves selected yellow RGB at partial alpha');
    highlighted.highlight.layers.reverse();
    const reorderedOutlineMovie = path.join(temporary, 'highlight-reordered.mov');
    await renderer.render(highlighted, { ffmpegPath: ffmpegPath, outputPath: reorderedOutlineMovie });
    const reorderedOutline = pixel(oneFrame(reorderedOutlineMovie, 0.2), 0, 115, 90);
    assert.ok(reorderedOutline[0] > 240 && reorderedOutline[1] > 240 && reorderedOutline[2] < 15, 'reordering layers changes the actual exported outline color');
    highlighted.highlight.layers = [];
    Object.assign(highlighted.highlight, { shape: 'polygon', x: 100, y: 90, rotation: 30,
      points: [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }] });
    const polygonMovie = path.join(temporary, 'highlight-polygon.mov');
    await renderer.render(highlighted, { ffmpegPath: ffmpegPath, outputPath: polygonMovie });
    const polygonFrame = oneFrame(polygonMovie, 0.2);
    assert.ok(pixel(polygonFrame, 0, 100, 90)[0] > 240 && pixel(polygonFrame, 0, 78, 78)[0] > 230, 'arbitrary rotation and center positioning preserve polygon interior');
    assert.strictEqual(pixel(polygonFrame, 0, 80, 44)[3], 0, 'rotated polygon clips rectangular source corners');
    Object.assign(highlighted.highlight, { shape: 'rectangle', x: 210, y: 80, width: 80, height: 40, rotation: 90 });
    Object.assign(highlighted.cards[0], { mediaPath: patternPath, mediaType: 'image' });
    const rotatedHighlightMovie = path.join(temporary, 'highlight-clockwise.mov');
    await renderer.render(highlighted, { ffmpegPath: ffmpegPath, outputPath: rotatedHighlightMovie });
    const rotatedHighlight = oneFrame(rotatedHighlightMovie, 0.2);
    assert.ok(pixel(rotatedHighlight, 0, 210, 50)[1] > 230 && pixel(rotatedHighlight, 0, 210, 100)[2] > 230, 'positive 90-degree rotation turns source bands clockwise about the requested image center');
    assert.strictEqual(pixel(rotatedHighlight, 0, 170, 80)[3], 0, 'rotated group has swapped bounds rather than filling the original frame');
    Object.assign(highlighted.highlight, { x: 160, y: 90, width: 80, height: 60, rotation: 0 });
    Object.assign(highlighted.cards[0], { mediaScale: 25, mediaX: 10, mediaY: -8 });
    const scaledHighlightMovie = path.join(temporary, 'highlight-scaled.mov');
    await renderer.render(highlighted, { ffmpegPath: ffmpegPath, outputPath: scaledHighlightMovie });
    const scaledHighlight = oneFrame(scaledHighlightMovie, 0.2);
    assert.ok(pixel(scaledHighlight, 0, 150, 80)[0] > 240, 'highlight source shrink/pan uses original image instead of a pre-cropped source');
    const scaledYellow = pixel(scaledHighlight, 0, 188, 80);
    assert.ok(scaledYellow[0] > 240 && scaledYellow[1] > 240 && scaledYellow[2] < 15, 'highlight source shrink exposes original far-right content');
    assert.strictEqual(pixel(scaledHighlight, 0, 135, 80)[3], 0, 'highlight source holes remain transparent inside its fixed perimeter');
    Object.assign(highlighted, { duration: 1.2, backgroundMode: 'solid', backgroundColor: '#10131c' });
    Object.assign(highlighted.cards[0], { mediaPath: videoPath, mediaType: 'video', mediaOffset: 0.5, mediaScale: 50, mediaX: 10, mediaY: 10 });
    const videoHighlightMovie = path.join(temporary, 'highlight-video.mov');
    await renderer.render(highlighted, { ffmpegPath: ffmpegPath, outputPath: videoHighlightMovie });
    const firstHighlightVideo = oneFrame(videoHighlightMovie, 0), heldHighlightVideo = oneFrame(videoHighlightMovie, 1.15);
    assert.ok(pixel(firstHighlightVideo, 0, 160, 90)[2] > 230, 'highlight video begins immediately from its selected source offset');
    assert.ok(pixel(heldHighlightVideo, 0, 160, 90)[1] > 230, 'highlight video advances and holds the last frame after EOF');
    const highlightHole = pixel(heldHighlightVideo, 0, 122, 62);
    assert.ok(Math.abs(highlightHole[0] - 16) < 5 && Math.abs(highlightHole[1] - 19) < 5 && highlightHole[3] > 250, 'highlight transform holes reveal the selected solid project background');
    assert.deepStrictEqual(highlightDirectories(), beforeHighlightDirectories, 'successful highlights remove temporary PNG assets');
    highlighted.cards[0].mediaPath = '';
    await assert.rejects(renderer.render(highlighted, { ffmpegPath: path.join(temporary, 'missing-ffmpeg'), outputPath: path.join(temporary, 'highlight-launch-failed.mov') }), function (error) { return error.code === 'FFMPEG_NOT_FOUND'; });
    assert.deepStrictEqual(highlightDirectories(), beforeHighlightDirectories, 'failed highlight encoder removes temporary PNG assets');
    Object.assign(highlighted, { width: 1920, height: 1080, fps: 120, duration: 120 });
    const highlightCancelOutput = path.join(temporary, 'highlight-canceled.mov');
    fs.writeFileSync(highlightCancelOutput, 'preserve existing highlight');
    const highlightController = new AbortController();
    let sawHighlightAssets = false;
    const highlightAbortTimer = setTimeout(function () { sawHighlightAssets = highlightDirectories().length > beforeHighlightDirectories.length; highlightController.abort(); }, 100);
    await assert.rejects(renderer.render(highlighted, { ffmpegPath: ffmpegPath, outputPath: highlightCancelOutput, signal: highlightController.signal }), function (error) { return error.code === 'CANCELLED'; });
    clearTimeout(highlightAbortTimer);
    assert.ok(sawHighlightAssets, 'cancellation regression reaches the highlight asset/encoder stage');
    assert.deepStrictEqual(highlightDirectories(), beforeHighlightDirectories, 'cancelled highlight removes temporary PNG assets');
    assert.strictEqual(fs.readFileSync(highlightCancelOutput, 'utf8'), 'preserve existing highlight');
    console.log('Renderer verified: cards/trapezoid/highlight, shape masks, outline layers/glow/order, rotation, source transforms/video, alpha/solid backgrounds, 90/120fps, and cleanup on success/failure/cancellation.');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

run().catch(function (error) { console.error(error); process.exitCode = 1; });
