import { mediaSourceUrl, normalizeMediaRoot } from '../../../shared/davinciMediaPaths.js';
import { audioTrimSeconds, validateAudioTrim } from '../../../shared/davinciAudioTrim.js';
import { DEFAULT_BACKGROUND_MUSIC_VOLUME, validBackgroundMusicVolume, backgroundMusicDecibels } from '../../../shared/davinciMusicVolume.js';
import { DEFAULT_DAVINCI_ANIMATION_TYPES, validDavinciAnimationTypes } from '../../../shared/davinciAnimations.js';
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
  const weights = frames.map(frame => Number.isFinite(frame.durationWeight) && frame.durationWeight > 0
    ? frame.durationWeight : Array.from(frame.scriptText || '').length);
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

function transform(animation, duration, frameRate, horizontalOffset = 0) {
  const anim = String(animation || '').toLowerCase();
  const end = duration - TIMEBASE / frameRate;
  if (end <= 0) return [];
  const positions = {
    'pan left': ['5 0', '0 0', '-5 0'], 'pan right': ['-5 0', '0 0', '5 0'],
    'pan up': ['0 5', '0 0', '0 -5'], 'pan down': ['0 -5', '0 0', '0 5'],
  };
  const position = positions[anim]?.map(value => {
    const [x, y] = value.split(' ').map(Number);
    return `${x + horizontalOffset} ${y}`;
  });
  const scale = anim === 'zoom in' ? ['1 1', '1.07 1.07', '1.15 1.15']
    : anim === 'zoom out' ? ['1.15 1.15', '1.07 1.07', '1 1']
      : position ? ['1.20 1.20', '1.25 1.25', '1.30 1.30'] : null;
  if (!scale) return [];
  const times = [0, Math.floor(end / 2), end];
  const lines = [`          <adjust-transform position="${position?.[0] || `${horizontalOffset} 0`}" scale="${scale[0]}" anchor="0 0">`];
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
  projectName, frames, voiceoverBlocks, imageFiles, videoFiles = new Map(), frameRate = 24, charsPerSecond = 15,
  addAnimations = true, animationTypes = DEFAULT_DAVINCI_ANIMATION_TYPES, addTransitions = false, transitionDurationSec = 0.5,
  mediaRootPath = '', audioTrim = {}, backgroundMusic = null, backgroundMusicVolume = DEFAULT_BACKGROUND_MUSIC_VOLUME,
  soundEffects = [], onWarning = () => {}, outputWidth = 1920, outputHeight = 1080,
  horizontalOffsets = new Map(),
}) {
  if (![24, 25, 30].includes(frameRate) || !Number.isFinite(charsPerSecond) || charsPerSecond < 5 || charsPerSecond > 30 ||
      typeof addAnimations !== 'boolean' || !validDavinciAnimationTypes(animationTypes, addAnimations) || typeof addTransitions !== 'boolean' ||
      !Number.isFinite(transitionDurationSec) || transitionDurationSec <= 0 || transitionDurationSec > 5 ||
      !validBackgroundMusicVolume(backgroundMusicVolume) ||
      ![1080, 1920].includes(outputWidth) || ![1080, 1920].includes(outputHeight) ||
      !((outputWidth === 1920 && outputHeight === 1080) || (outputWidth === 1080 && outputHeight === 1920)) ||
      !(horizontalOffsets instanceof Map) || [...horizontalOffsets.values()].some(value => !Number.isFinite(value) || Math.abs(value) > 40)) fail('INVALID_DAVINCI_SETTINGS');
  validateAudioTrim(audioTrim);
  if (mediaRootPath !== '') normalizeMediaRoot(mediaRootPath);
  const plan = timelinePlan(voiceoverBlocks, frames, frameRate, charsPerSecond);
  const resources = [
    `    <format id="r0" name="${outputWidth === 1920 ? `FFVideoFormat1080p${frameRate}` : `FFVideoFormat1080x1920p${frameRate}`}" frameDuration="1/${frameRate}s" width="${outputWidth}" height="${outputHeight}" colorSpace="1-1-1 (Rec. 709)"/>`,
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
  let audioAnchorIndex;
  let stillImageIndex = 0;
  const frameOffsets = new Map();
  const dialogueClips = [];
  for (const item of plan.blocks) {
    const { block, duration, durations, offset } = item;
    if (!item.exact) onWarning(`Блок ${block.order}: длительность приблизительная, рассчитана по тексту.`);
    const trim = audioTrimSeconds(block.adaptedText, duration / TIMEBASE, audioTrim);
    const trimStart = Math.round(trim.start * TIMEBASE);
    const trimEnd = Math.round(trim.end * TIMEBASE);
    const audibleDuration = duration - trimStart - trimEnd;
    if (audibleDuration <= 0) fail('INVALID_AUDIO_TRIM');
    const audioId = `r${resourceNumber++}`;
    const audioName = block.audioFilename || `audio_block_${block.order}.mp3`;
    if (!/^(?:audio_block_[1-9]\d*|short_[a-f0-9]{24}_[a-f0-9]{32})\.mp3$/.test(audioName)) fail('INVALID_DAVINCI_SETTINGS');
    resources.push(`    <asset id="${audioId}" name="${audioName}" start="0s" hasAudio="1" duration="${time(duration)}" audioSources="1" audioChannels="2" audioRate="48k"><media-rep src="${escapeXml(mediaSourceUrl(mediaRootPath, `audio/${audioName}`))}" kind="original-media"/></asset>`);
    dialogueClips.push({ offset: offset + trimStart,
      clip: `<asset-clip name="${audioName}" ref="${audioId}" srcEnable="audio" lane="-1" offset="${time(offset + trimStart)}" start="${time(trimStart)}" duration="${time(audibleDuration)}" audioRole="dialogue"/>` });
    let blockOffset = 0;
    item.frames.forEach((frame, index) => {
      const filename = imageFiles.get(frame.id);
      if (!filename || !/^(frame_[0-9]+_[0-9]+|still_[a-p]{64})\.(jpg|png|webp)$/.test(filename)) fail('DAVINCI_IMAGE_MISSING');
      const video = videoFiles.get(frame.id);
      const animation = video || !addAnimations ? '' : animationTypes[stillImageIndex++ % animationTypes.length];
      const displayName = `frame_${block.order}_${index + 1}.${video ? 'mp4' : filename.split('.').at(-1)}`;
      const imageId = `r${resourceNumber++}`;
      const clipDuration = durations[index];
      const horizontalOffset = horizontalOffsets.get(frame.id) || 0;
      if (video) {
        if (!/^video_[1-9]\d*_[1-9]\d*(?:__[0-9a-zA-Z_-]{1,72})?\.mp4$/.test(video.filename) || !(video.durationSec > 0)) fail('INVALID_DAVINCI_SETTINGS');
        const formatId = `r${resourceNumber++}`;
        resources.push(`    <format id="${formatId}" frameDuration="1/${frameRate}s" width="${video.width || 1920}" height="${video.height || 1080}"/>`);
        resources.push(`    <asset id="${imageId}" name="${escapeXml(video.filename)}" hasVideo="1" start="0s" duration="${time(Math.round(video.durationSec * TIMEBASE))}" format="${formatId}"><media-rep src="${escapeXml(mediaSourceUrl(mediaRootPath, `video/${video.filename}`))}" kind="original-media"/></asset>`);
      } else {
      resources.push(`    <asset id="${imageId}" name="${filename}" hasVideo="1" start="0s" duration="${Math.max(3600, Math.ceil(duration / TIMEBASE) + 10)}/1s" format="r1"><media-rep src="${escapeXml(mediaSourceUrl(mediaRootPath, `images/${filename}`))}" kind="original-media"/></asset>`);
      }

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
      frameOffsets.set(frame.id, offset + blockOffset);
      if (video) {
        // Refer to the MP4 directly while keeping its audio out of the timeline.
        clips.push(`        <asset-clip name="${displayName}" ref="${imageId}" srcEnable="video" start="0s" duration="${time(clipDuration)}" offset="${time(offset + blockOffset)}" enabled="1">`);
        const sourceDuration = Math.round(video.durationSec * TIMEBASE);
        if (sourceDuration < clipDuration) clips.push(`          <timeMap><timept time="0s" value="0s" interp="linear"/><timept time="${time(clipDuration)}" value="${time(sourceDuration)}" interp="linear"/></timeMap>`);
        clips.push(`          <adjust-conform type="${outputHeight > outputWidth ? 'fill' : 'fit'}"/>`);
        if (horizontalOffset) clips.push(`          <adjust-transform position="${horizontalOffset} 0" scale="1 1" anchor="0 0"/>`);
      } else {
        clips.push(`        <asset-clip name="${displayName}" ref="${imageId}" start="0s" duration="${time(clipDuration)}" offset="${time(offset + blockOffset)}" enabled="1">`,
          `          <adjust-conform type="${outputHeight > outputWidth || /^Pan /.test(animation) ? 'fill' : 'fit'}"/>`);
        if (animation) clips.push(...transform(animation, clipDuration, frameRate, horizontalOffset));
        else if (horizontalOffset) clips.push(`          <adjust-transform position="${horizontalOffset} 0" scale="1 1" anchor="0 0"/>`);
      }
      if (audioAnchorIndex === undefined) audioAnchorIndex = clips.length;
      for (const [note, value] of [['Voiceover Text', frame.scriptText], ['Start Time', time(offset + blockOffset)], ['Animation Instruction', animation], ['DaVinci Resolve Marker', frame.marker]]) {
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
  const musicClips = [];
  if (backgroundMusic?.filename && backgroundMusic?.durationSec > 0) {
    const musicId = `r${resourceNumber++}`;
    const sourceDuration = Math.round(backgroundMusic.durationSec * TIMEBASE);
    resources.push(`    <asset id="${musicId}" name="${escapeXml(backgroundMusic.filename)}" start="0s" hasAudio="1" duration="${time(sourceDuration)}" audioSources="1" audioChannels="2" audioRate="48k"><media-rep src="${escapeXml(mediaSourceUrl(mediaRootPath, `audio/${backgroundMusic.filename}`))}" kind="original-media"/></asset>`);
    for (let offset = 0; offset < plan.duration; offset += sourceDuration) {
      const musicDuration = Math.min(plan.duration - offset, sourceDuration);
      musicClips.push({ offset,
        clip: `<asset-clip name="${escapeXml(backgroundMusic.title || 'Background Music')}" ref="${musicId}" srcEnable="audio" lane="-2" offset="${time(offset)}" start="0s" duration="${time(musicDuration)}" audioRole="music"><adjust-volume amount="${backgroundMusicDecibels(backgroundMusicVolume)}"/></asset-clip>` });
      if (!backgroundMusic.loop) break;
    }
  }
  const effectLanes = [];
  const laneEnds = [];
  const timedEffects = soundEffects.map(sourceEffect => ({ ...sourceEffect,
    offsetTicks: frameOffsets.get(sourceEffect.frameId) ?? sourceEffect.offsetTicks,
  })).sort((a, b) => (a.offsetTicks ?? Infinity) - (b.offsetTicks ?? Infinity));
  for (const effect of timedEffects) {
    if (!effect?.filename || !(effect.durationSec > 0) || !(effect.offsetTicks >= 0)) continue;
    const effectId = `r${resourceNumber++}`;
    const duration = Math.min(plan.duration - effect.offsetTicks, Math.round(effect.durationSec * TIMEBASE));
    if (duration <= 0) continue;
    resources.push(`    <asset id="${effectId}" name="${escapeXml(effect.filename)}" start="0s" hasAudio="1" duration="${time(Math.round(effect.durationSec * TIMEBASE))}" audioSources="1" audioChannels="2" audioRate="48k"><media-rep src="${escapeXml(mediaSourceUrl(mediaRootPath, `audio/${effect.filename}`))}" kind="original-media"/></asset>`);
    let lane = laneEnds.findIndex(end => end <= effect.offsetTicks);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = effect.offsetTicks + duration;
    (effectLanes[lane] ||= []).push({ offset: effect.offsetTicks,
      clip: `<asset-clip name="${escapeXml(effect.title || 'Sound Effect')}" ref="${effectId}" srcEnable="audio" lane="${-3 - lane}" offset="${time(effect.offsetTicks)}" start="0s" duration="${time(duration)}" audioRole="effects"/>` });
  }
  // All sound clips connect to the same first picture. Their offset is an
  // absolute sequence time; a nested spine is imported by Resolve as a
  // secondary storyline and collapses its clips toward the beginning.
  clips.splice(audioAnchorIndex, 0,
    ...dialogueClips.map(entry => `          ${entry.clip}`),
    ...musicClips.map(entry => `          ${entry.clip}`),
    ...effectLanes.flatMap(entries => entries.map(entry => `          ${entry.clip}`)));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<fcpxml version="1.9">',
    '  <resources>', ...resources, '  </resources>', '  <library>', '    <event name="AI Generated Project">',
    `      <project name="${escapeXml(projectName || 'AI Project')}">`,
    `        <sequence format="r0" duration="${time(plan.duration)}" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    '          <spine>', ...clips, '          </spine>', '        </sequence>', '      </project>', '    </event>', '  </library>', '</fcpxml>', '',
  ].join('\n');
}
