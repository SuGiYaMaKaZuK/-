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
    Object.assign(split.cards[1], { mediaPath: videoPath, mediaType: 'video', mediaOffset: 0.5 });
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
    console.log('Renderer verified: cards/3-way trapezoid, alpha/solid backgrounds, 90/120fps, staggered arrivals, slanted borders, media playback, layering, cancellation, and actionable media errors.');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

run().catch(function (error) { console.error(error); process.exitCode = 1; });
