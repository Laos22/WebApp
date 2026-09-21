import { mediaSourceUrl, normalizeMediaRoot } from '../../../shared/davinciMediaPaths.js';
import { audioTrimSeconds, validateAudioTrim } from '../../../shared/davinciAudioTrim.js';
import { hasAudioDuration } from './audioDuration.js';

// Divisible by 24/25/30 FPS and 44.1/48 kHz. Keep the audio end, including its
// subframe remainder, rather than rounding every block to a video frame.
export const TIMEBASE = 35280000;
const time = ticks => `${ticks}/${TIMEBASE}s`;
function fail(code) { throw Object.assign(new Error(code), { code }); }
function escapeXml(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;')
    .replaceAll('\n', '&#10;').replaceAll('\r', '&#13;').replaceAll('\t', '&#9;');
}

export function frameDurations(frames, totalTicks, frameRate = 24) {
  const minimum = TIMEBASE / frameRate;
  if (!frames.length || totalTicks < frames.length * minimum) fail('DAVINCI_BLOCK_TOO_SHORT');
  const weights = frames.map(frame => Array.from(frame.scriptText || '').length);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let used = 0;
  let cumulativeWeight = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return totalTicks - used;
    cumulativeWeight += weight;
    const target = totalWeight ? cumulativeWeight / totalWeight : (index + 1) / weights.length;
    const end = Math.max(used + minimum, Math.min(
      totalTicks - (weights.length - index - 1) * minimum,
      Math.round(target * totalTicks / minimum) * minimum,
    ));
    const duration = end - used;
    used = end;
    return duration;
  });
}

export function timelinePlan(voiceoverBlocks, frames, frameRate = 24, charsPerSecond = 15) {
  let offset = 0;
  const ids = new Set();
  const orders = new Set();
  const frameIds = new Set();
  for (const frame of frames) {
    if (frameIds.has(frame.id)) fail('DAVINCI_STRUCTURE_MISMATCH');
    frameIds.add(frame.id);
  }
  const blocks = [...voiceoverBlocks].sort((a, b) => a.order - b.order).map(block => {
    if (ids.has(block.id) || orders.has(block.order) || !Number.isSafeInteger(block.order) || block.order < 1) fail('DAVINCI_STRUCTURE_MISMATCH');
    ids.add(block.id); orders.add(block.order);
    const blockFrames = frames.filter(frame => frame.sourceVoiceoverBlockId === block.id);
    const exact = hasAudioDuration(block.audioDurationSec);
    const durationSec = exact ? block.audioDurationSec : Math.max(Array.from(block.adaptedText || '').length, 1) / charsPerSecond;
    const duration = Math.round(durationSec * TIMEBASE);
    if (!Number.isSafeInteger(duration)) fail('INVALID_DAVINCI_SETTINGS');
    const durations = frameDurations(blockFrames, duration, frameRate);
    const result = { block, frames: blockFrames, duration, durationSec, exact, offset, durations };
    offset += duration;
    return result;
  });
  if (!blocks.length || frames.some(frame => !ids.has(frame.sourceVoiceoverBlockId))) fail('DAVINCI_STRUCTURE_MISMATCH');
  return { blocks, duration: offset };
}

function transform(animation, duration, frameRate) {
  const anim = String(animation || '').toLowerCase();
  const end = duration - TIMEBASE / frameRate;
  if (end <= 0) return [];
  const positions = {
    'pan left': ['5 0', '0 0', '-5 0'], 'pan right': ['-5 0', '0 0', '5 0'],
    'pan up': ['0 5', '0 0', '0 -5'], 'pan down': ['0 -5', '0 0', '0 5'],
  };
  const position = positions[anim];
  const scale = anim === 'zoom in' ? ['1 1', '1.07 1.07', '1.15 1.15']
    : anim === 'zoom out' ? ['1.15 1.15', '1.07 1.07', '1 1']
      : position ? ['1.20 1.20', '1.25 1.25', '1.30 1.30'] : null;
  if (!scale) return [];
  const times = [0, Math.floor(end / 2), end];
  const lines = [`          <adjust-transform position="${position?.[0] || '0 0'}" scale="${scale[0]}" anchor="0 0">`];
  for (const [name, values] of [['position', position], ['scale', scale]]) {
    if (!values) continue;
    lines.push(`            <param name="${name}" value="${values[0]}"><keyframeAnimation>`);
    times.forEach((t, i) => lines.push(`              <keyframe time="${time(t)}" value="${values[i]}"/>`));
    lines.push('            </keyframeAnimation></param>');
  }
  lines.push('          </adjust-transform>');
  return lines;
}

export function imageExtension(mimeType) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mimeType];
  if (!extension) fail('DAVINCI_IMAGE_FORMAT_UNSUPPORTED');
  return extension;
}

export function createDavinciXml({
  projectName, frames, voiceoverBlocks, imageFiles, frameRate = 24, charsPerSecond = 15,
  addAnimations = true, addTransitions = false, transitionDurationSec = 0.5,
  mediaRootPath = '', audioTrim = {}, onWarning = () => {},
}) {
  if (![24, 25, 30].includes(frameRate) || !Number.isFinite(charsPerSecond) || charsPerSecond < 5 || charsPerSecond > 30 ||
      typeof addAnimations !== 'boolean' || typeof addTransitions !== 'boolean' ||
      !Number.isFinite(transitionDurationSec) || transitionDurationSec <= 0 || transitionDurationSec > 5) fail('INVALID_DAVINCI_SETTINGS');
  validateAudioTrim(audioTrim);
  if (mediaRootPath !== '') normalizeMediaRoot(mediaRootPath);
  const plan = timelinePlan(voiceoverBlocks, frames, frameRate, charsPerSecond);
  const resources = [
    `    <format id="r0" name="FFVideoFormat1080p${frameRate}" frameDuration="1/${frameRate}s" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>`,
    '    <format id="r1" name="FFVideoFormatRateUndefined" width="1920" height="1080"/>',
  ];
  let resourceNumber = 2;
  let transitionId;
  if (addTransitions) {
    transitionId = `r${resourceNumber++}`;
    resources.push(`    <effect id="${transitionId}" name="Fade To Color" uid="FxPlug:F779C565-486D-4633-8035-0374B4DB8F5C"/>`);
  }
  const clips = [];
  const quantum = TIMEBASE / frameRate;
  const transition = (offset, duration, name = 'Dip To Color Dissolve') => {
    if (duration > 0) clips.push(`        <transition name="${name}" offset="${time(offset)}" duration="${time(duration)}"><filter-video ref="${transitionId}" name="Transition"><param name="color" key="3" value="0 0 0 1"/></filter-video></transition>`);
  };
  let previousDuration = null;
  for (const item of plan.blocks) {
    const { block, duration, durations, offset } = item;
    if (!item.exact) onWarning(`Блок ${block.order}: длительность приблизительная, рассчитана по тексту.`);
    const trim = audioTrimSeconds(block.adaptedText, duration / TIMEBASE, audioTrim);
    const trimStart = Math.round(trim.start * TIMEBASE);
    const trimEnd = Math.round(trim.end * TIMEBASE);
    const audibleDuration = duration - trimStart - trimEnd;
    if (audibleDuration <= 0) fail('INVALID_AUDIO_TRIM');
    const audioId = `r${resourceNumber++}`;
    const audioName = `audio_block_${block.order}.mp3`;
    resources.push(`    <asset id="${audioId}" name="${audioName}" start="0s" hasAudio="1" duration="${time(duration)}" audioSources="1" audioChannels="2" audioRate="48k"><media-rep src="${escapeXml(mediaSourceUrl(mediaRootPath, `audio/${audioName}`))}" kind="original-media"/></asset>`);
    let blockOffset = 0;
    item.frames.forEach((frame, index) => {
      const filename = imageFiles.get(frame.id);
      if (!filename || !/^(frame_[0-9]+_[0-9]+|still_[a-p]{64})\.(jpg|png|webp)$/.test(filename)) fail('DAVINCI_IMAGE_MISSING');
      const displayName = `frame_${block.order}_${index + 1}.${filename.split('.').at(-1)}`;
      const imageId = `r${resourceNumber++}`;
      const clipDuration = durations[index];
      resources.push(`    <asset id="${imageId}" name="${filename}" hasVideo="1" start="0s" duration="${Math.max(3600, Math.ceil(duration / TIMEBASE) + 10)}/1s" format="r1"><media-rep src="${escapeXml(mediaSourceUrl(mediaRootPath, `images/${filename}`))}" kind="original-media"/></asset>`);
      if (transitionId) {
        if (previousDuration === null) {
          const fadeDuration = Math.floor(Math.min(transitionDurationSec * TIMEBASE, clipDuration / 4) / quantum) * quantum;
          transition(0, fadeDuration, 'Fade In');
        } else {
          // Overlap every cut, including block boundaries, without moving clips.
          const half = Math.floor(Math.min(transitionDurationSec * TIMEBASE / 2, previousDuration / 4, clipDuration / 4) / quantum) * quantum;
          transition(offset + blockOffset - half, half * 2);
        }
      }
      previousDuration = clipDuration;
      clips.push(`        <asset-clip name="${displayName}" ref="${imageId}" start="0s" duration="${time(clipDuration)}" offset="${time(offset + blockOffset)}" enabled="1">`,
        `          <adjust-conform type="${addAnimations && /^Pan /.test(frame.animation || '') ? 'fill' : 'fit'}"/>`);
      if (addAnimations) clips.push(...transform(frame.animation, clipDuration, frameRate));
      if (index === 0) clips.push(`          <asset-clip name="${audioName}" ref="${audioId}" lane="-1" start="${time(trimStart)}" offset="${time(trimStart)}" duration="${time(audibleDuration)}" audioRole="dialogue"/>`);
      for (const [note, value] of [['Voiceover Text', frame.scriptText], ['Start Time', time(offset + blockOffset)], ['Animation Instruction', frame.animation], ['DaVinci Resolve Marker', frame.marker]]) {
        if (value) clips.push(`          <marker start="0s" duration="1/${frameRate}s" value="${escapeXml(value)}" note="${note}"/>`);
      }
      clips.push('        </asset-clip>');
      blockOffset += clipDuration;
    });
  }
  if (transitionId) {
    const fadeDuration = Math.floor(Math.min(transitionDurationSec * TIMEBASE, previousDuration / 4) / quantum) * quantum;
    transition(plan.duration - fadeDuration, fadeDuration, 'Fade Out');
  }
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<fcpxml version="1.9">',
    '  <resources>', ...resources, '  </resources>', '  <library>', '    <event name="AI Generated Project">',
    `      <project name="${escapeXml(projectName || 'AI Project')}">`,
    `        <sequence format="r0" duration="${time(plan.duration)}" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    '          <spine>', ...clips, '          </spine>', '        </sequence>', '      </project>', '    </event>', '  </library>', '</fcpxml>', '',
  ].join('\n');
}
