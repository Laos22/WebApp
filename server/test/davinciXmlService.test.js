import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDavinciXml } from '../src/services/davinciXmlService.js';

test('creates portable Resolve FCPXML with project media paths', () => {
  const block = { id: 'voice_1', order: 1, adaptedText: 'Текст первого блока для озвучки' };
  const frames = [
    { id: 'frame_1', sourceVoiceoverBlockId: block.id, scriptText: 'Текст первого' },
    { id: 'frame_2', sourceVoiceoverBlockId: block.id, scriptText: 'блока для озвучки' },
  ];
  const xml = createDavinciXml({
    projectName: 'Проект & тест', frames, voiceoverBlocks: [block],
    imageFiles: new Map([['frame_1', 'frame_1_1.jpg'], ['frame_2', 'frame_1_2.png']]),
  });
  assert.match(xml, /<fcpxml version="1\.9">/);
  assert.match(xml, /src="audio\/audio_block_1\.mp3"/);
  assert.match(xml, /src="images\/frame_1_1\.jpg"/);
  assert.match(xml, /src="images\/frame_1_2\.png"/);
  assert.match(xml, /Проект &amp; тест/);
  assert.equal((xml.match(/note="Voiceover Text"/g) || []).length, 2);
});

import { frameDurations, timelinePlan, TIMEBASE, imageExtension } from '../src/services/davinciXmlService.js';
function fixture() {
  const voiceoverBlocks = [1, 2].map(order => ({ id: `b${order}`, order, adaptedText: 'А Б В', audioDurationSec: 3.123 }));
  const frames = voiceoverBlocks.flatMap(block => [1, 2, 3].map(n => ({ id: `${block.id}_${n}`, sourceVoiceoverBlockId: block.id, scriptText: 'я'.repeat(n), animation: 'Pan Left', marker: 'Мой <маркер> & "текст"' })));
  const imageFiles = new Map(frames.map((frame, i) => [frame.id, `frame_${Math.floor(i / 3) + 1}_${i % 3 + 1}.${['jpg', 'png', 'webp'][i % 3]}`]));
  return { projectName: 'Проект', voiceoverBlocks, frames, imageFiles };
}
for (const fps of [24, 25, 30]) test(`exact frame sum and last remainder at ${fps} FPS, without block drift`, () => {
  const input = fixture();
  const plan = timelinePlan(input.voiceoverBlocks, input.frames, fps);
  for (const block of plan.blocks) {
    assert.equal(block.durations.reduce((a, b) => a + b, 0), block.duration);
    assert.equal(block.durations.at(-1), block.duration - block.durations.slice(0, -1).reduce((a, b) => a + b, 0));
    assert.ok(Math.abs(block.durations[0] / TIMEBASE - block.durationSec / 6) <= 1 / fps);
  }
  assert.equal(plan.blocks[1].offset, Math.round(3.123 * TIMEBASE));
  assert.equal(plan.duration, 2 * Math.round(3.123 * TIMEBASE));
  assert.match(createDavinciXml({ ...input, frameRate: fps }), new RegExp(`frameDuration="1/${fps}s"`));
});
test('short blocks reject impossible minimum durations rather than extending audio', () => {
  assert.throws(() => frameDurations([{}, {}], TIMEBASE / 24), { code: 'DAVINCI_BLOCK_TOO_SHORT' });
  assert.deepEqual(frameDurations([{}, {}, {}], 3 * TIMEBASE), [TIMEBASE, TIMEBASE, TIMEBASE]);
});
test('resource IDs are unique and all refs resolve; mixed formats use only portable paths', () => {
  const xml = createDavinciXml({ ...fixture(), addTransitions: true });
  const ids = [...xml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of xml.matchAll(/\b(?:ref|format)="(r\d+)"/g)) assert.ok(ids.includes(match[1]));
  for (const match of xml.matchAll(/src="([^"]+)"/g)) assert.match(match[1], /^(images\/frame_\d+_\d+\.(jpg|png|webp)|audio\/audio_block_\d+\.mp3)$/);
  assert.deepEqual(['image/jpeg', 'image/png', 'image/webp'].map(imageExtension), ['jpg', 'png', 'webp']);
  assert.throws(() => imageExtension('image/gif'));
  assert.doesNotMatch(xml, /<track|\/Users\/|\/tmp\/|file:\/\//);
  assert.equal((xml.match(/lane="-1"/g) || []).length, 2);
});
test('XML escapes Russian marker text and omits absent optional markers', () => {
  const input = fixture();
  input.frames[0].marker = 'Русский & < > " \'\n\u0001';
  const xml = createDavinciXml(input);
  assert.match(xml, /Русский &amp; &lt; &gt; &quot; &apos;&#10;/);
  assert.doesNotMatch(xml, /\u0001/);
  for (const note of ['Voiceover Text', 'Start Time', 'Animation Instruction', 'DaVinci Resolve Marker']) assert.equal(xml.split(`note="${note}"`).length - 1, 6);
  input.frames.forEach(frame => { delete frame.animation; delete frame.marker; });
  const legacy = createDavinciXml(input);
  assert.doesNotMatch(legacy, /Animation Instruction|DaVinci Resolve Marker|adjust-transform/);
});
for (const [animation, first, last] of [
  ['Zoom In', '1 1', '1.15 1.15'], ['Zoom Out', '1.15 1.15', '1 1'],
  ['Pan Left', '5 0', '-5 0'], ['Pan Right', '-5 0', '5 0'],
  ['Pan Up', '0 5', '0 -5'], ['Pan Down', '0 -5', '0 5'],
]) test(`${animation} has the bot's keyframes ending inside the final clip duration`, () => {
  const input = fixture(); input.frames.forEach(frame => { frame.animation = animation; });
  const xml = createDavinciXml(input);
  const duration = timelinePlan(input.voiceoverBlocks, input.frames).blocks[0].durations[0];
  assert.ok(xml.includes(`time="0/${TIMEBASE}s" value="${first}"`));
  assert.ok(xml.includes(`time="${duration - TIMEBASE / 24}/${TIMEBASE}s" value="${last}"`));
  assert.doesNotMatch(createDavinciXml({ ...input, addAnimations: false }), /adjust-transform/);
});
test('transitions cover every cut and both ends without changing image or audio timing', () => {
  const input = fixture();
  const off = createDavinciXml(input);
  const on = createDavinciXml({ ...input, addTransitions: true, transitionDurationSec: 0.5 });
  assert.doesNotMatch(off, /<transition/);
  const clipTiming = xml => xml.match(/<asset-clip[^>]+>/g).map(clip => clip.replace(/ ref="r\d+"/, ""));
  assert.deepEqual(clipTiming(on), clipTiming(off));
  const transitions = [...on.matchAll(/<transition[^>]+offset="(\d+)\/\d+s" duration="(\d+)\/\d+s"/g)];
  assert.equal(transitions.length, input.frames.length + 1);
  const plan = timelinePlan(input.voiceoverBlocks, input.frames);
  const cuts = [];
  for (const block of plan.blocks) {
    let offset = block.offset;
    for (const duration of block.durations) { if (offset > 0) cuts.push(offset); offset += duration; }
  }
  const internal = transitions.slice(1, -1);
  internal.forEach((match, i) => assert.equal(Number(match[1]) + Number(match[2]) / 2, cuts[i]));
  assert.equal(Number(transitions[0][1]), 0);
  assert.equal(Number(transitions.at(-1)[1]) + Number(transitions.at(-1)[2]), plan.duration);
  assert.match(on, /name="Fade In"/);
  assert.match(on, /name="Fade Out"/);
  assert.ok(cuts.includes(plan.blocks[1].offset));
});
test('legacy duration falls back with an explicit warning and does not mutate the project', () => {
  const input = fixture(); input.voiceoverBlocks.forEach(block => { delete block.audioDurationSec; });
  const before = structuredClone(input);
  const warnings = [];
  createDavinciXml({ ...input, onWarning: warning => warnings.push(warning) });
  assert.equal(warnings.length, 2);
  assert.deepEqual(input, before);
});

for (const frameRate of [24, 25, 30]) test(`single-image blocks include boundary and edge transitions at ${frameRate} FPS`, () => {
  const voiceoverBlocks = [1, 2].map(order => ({ id: `b${order}`, order, audioDurationSec: 2.125 }));
  const frames = voiceoverBlocks.map(block => ({ id: block.id, sourceVoiceoverBlockId: block.id }));
  const xml = createDavinciXml({ voiceoverBlocks, frames, frameRate, addTransitions: true,
    imageFiles: new Map(frames.map((f, i) => [f.id, `frame_${i + 1}_1.jpg`])) });
  const transitions = [...xml.matchAll(/<transition[^>]+offset="(\d+)\/\d+s" duration="(\d+)\/\d+s"/g)];
  assert.equal(transitions.length, 3);
  assert.equal(Number(transitions[1][1]) + Number(transitions[1][2]) / 2, Math.round(2.125 * TIMEBASE));
  assert.equal(Number(transitions[2][1]) + Number(transitions[2][2]), Math.round(4.25 * TIMEBASE));
  for (const t of transitions) assert.ok(Number(t[1]) >= 0 && Number(t[2]) > 0);
});
test('very short clips omit transitions that cannot fit instead of extending the timeline', () => {
  const xml = createDavinciXml({ frameRate: 24, addTransitions: true, transitionDurationSec: 5,
    frames: [{ id: 'f', sourceVoiceoverBlockId: 'b' }],
    voiceoverBlocks: [{ id: 'b', order: 1, audioDurationSec: 1 / 24 }],
    imageFiles: new Map([['f', 'frame_1_1.jpg']]),
  });
  assert.doesNotMatch(xml, /<transition /);
  assert.match(xml, new RegExp(`sequence format="r0" duration="${TIMEBASE / 24}/${TIMEBASE}s"`));
});


test('exports MP4, music, overlapping frame effects and transitions together at 25 FPS', () => {
  const input = fixture();
  const plan = timelinePlan(input.voiceoverBlocks, input.frames, 25);
  const effectOffset = plan.blocks[0].durations[0];
  const xml = createDavinciXml({ ...input, frameRate: 25, addTransitions: true,
    videoFiles: new Map([[input.frames[0].id, { filename: 'video_1_1.mp4', durationSec: 0.25, width: 1280, height: 720 }]]),
    backgroundMusic: { filename: 'background_music_test.mp3', durationSec: 10 },
    soundEffects: [1, 2].map(i => ({ filename: `sound_effect_${i}.mp3`, durationSec: 2, frameId: input.frames[1].id })),
  });
  assert.match(xml, /src="video\/video_1_1.mp4"/);
  assert.doesNotMatch(xml, /src="images\/frame_1_1.jpg"/);
  assert.match(xml, /<timeMap>/);
  assert.match(xml, /lane="-2" audioRole="music"/);
  assert.match(xml, /lane="-3" audioRole="effects"/);
  assert.match(xml, /lane="-4" audioRole="effects"/);
  assert.equal((xml.match(/<transition /g) || []).length, input.frames.length + 1);
  const effects = [...xml.matchAll(/<asset-clip[^>]+audioRole="effects"[^>]*>/g)];
  for (const [tag] of effects) assert.ok(tag.includes(`offset="${effectOffset}/${TIMEBASE}s"`));
  const firstClip = xml.slice(xml.indexOf('<clip name='), xml.indexOf('</clip>'));
  for (const role of ['dialogue', 'music', 'effects']) assert.ok(firstClip.includes(`audioRole="${role}"`));
  assert.ok(xml.includes(`sequence format="r0" duration="${plan.duration}/${TIMEBASE}s"`));
});
