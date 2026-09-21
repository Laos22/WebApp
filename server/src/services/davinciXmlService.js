function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function secondsAsFrames(text, frameRate, charsPerSecond) {
  return Math.max(1, Math.round((Math.max(String(text || '').length, 1) / charsPerSecond) * frameRate));
}

function frameDurations(frames, totalFrames) {
  const weights = frames.map(frame => Math.max(String(frame.scriptText || '').length, 1));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let used = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return Math.max(1, totalFrames - used);
    const remainingFrames = totalFrames - used;
    const remainingClips = weights.length - index;
    const duration = Math.max(1, Math.min(
      remainingFrames - (remainingClips - 1),
      Math.round((weight / totalWeight) * totalFrames),
    ));
    used += duration;
    return duration;
  });
}

export function createDavinciXml({
  projectName, frames, voiceoverBlocks, imageFiles,
  frameRate = 24, charsPerSecond = 15,
}) {
  if (![24, 25, 30].includes(frameRate) || !Number.isFinite(charsPerSecond) || charsPerSecond < 5 || charsPerSecond > 30) {
    const error = new Error('INVALID_DAVINCI_SETTINGS'); error.code = 'INVALID_DAVINCI_SETTINGS'; throw error;
  }
  const framesByBlock = new Map();
  for (const frame of frames) {
    const group = framesByBlock.get(frame.sourceVoiceoverBlockId) || [];
    group.push(frame);
    framesByBlock.set(frame.sourceVoiceoverBlockId, group);
  }
  const sortedBlocks = [...voiceoverBlocks].sort((left, right) => left.order - right.order);
  if (!sortedBlocks.length || sortedBlocks.some(block => !framesByBlock.get(block.id)?.length)) {
    const error = new Error('DAVINCI_STRUCTURE_MISMATCH'); error.code = 'DAVINCI_STRUCTURE_MISMATCH'; throw error;
  }

  const resources = [
    `    <format id="r0" name="FFVideoFormat1080p${frameRate}" frameDuration="1/${frameRate}s" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>`,
    '    <format id="r1" name="FFVideoFormatRateUndefined" width="1920" height="1080"/>',
  ];
  const audioResource = new Map();
  const imageResource = new Map();
  let resourceNumber = 2;
  let totalDuration = 0;
  const blockDurations = new Map();

  for (const block of sortedBlocks) {
    const duration = secondsAsFrames(block.adaptedText, frameRate, charsPerSecond);
    blockDurations.set(block.id, duration);
    totalDuration += duration;
    const audioId = `r${resourceNumber++}`;
    audioResource.set(block.id, audioId);
    const audioName = `audio_block_${block.order}.mp3`;
    resources.push(
      `    <asset id="${audioId}" name="${audioName}" hasAudio="1" duration="${duration}/${frameRate}s" audioSources="1" audioChannels="2" audioRate="48k">`,
      `      <media-rep src="audio/${audioName}" kind="original-media"/>`,
      '    </asset>',
    );
    for (const frame of framesByBlock.get(block.id)) {
      const filename = imageFiles.get(frame.id);
      if (!filename) {
        const error = new Error('DAVINCI_IMAGE_MISSING'); error.code = 'DAVINCI_IMAGE_MISSING'; throw error;
      }
      const imageId = `r${resourceNumber++}`;
      imageResource.set(frame.id, imageId);
      resources.push(
        `    <asset id="${imageId}" name="${escapeXml(filename)}" hasVideo="1" start="0/1s" duration="3600/1s" format="r1">`,
        `      <media-rep src="images/${escapeXml(filename)}" kind="original-media"/>`,
        '    </asset>',
      );
    }
  }

  const clips = [];
  let timelineOffset = 0;
  for (const block of sortedBlocks) {
    const blockFrames = framesByBlock.get(block.id);
    const blockDuration = blockDurations.get(block.id);
    const durations = frameDurations(blockFrames, blockDuration);
    let blockOffset = 0;
    blockFrames.forEach((frame, index) => {
      const duration = durations[index];
      const filename = imageFiles.get(frame.id);
      clips.push(
        `        <asset-clip name="${escapeXml(filename)}" ref="${imageResource.get(frame.id)}" start="0/1s" duration="${duration}/${frameRate}s" offset="${timelineOffset + blockOffset}/${frameRate}s" enabled="1">`,
        '          <adjust-conform type="fit"/>',
      );
      if (index === 0) {
        clips.push(`          <asset-clip name="audio_block_${block.order}.mp3" ref="${audioResource.get(block.id)}" lane="-1" offset="0s" duration="${blockDuration}/${frameRate}s"/>`);
      }
      clips.push(
        `          <marker start="0s" duration="1/${frameRate}s" value="${escapeXml(frame.scriptText)}" note="Voiceover Text"/>`,
        `          <marker start="1/${frameRate}s" duration="1/${frameRate}s" value="${timelineOffset + blockOffset}/${frameRate}s" note="Start Time"/>`,
        '        </asset-clip>',
      );
      blockOffset += duration;
    });
    timelineOffset += blockDuration;
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<fcpxml version="1.9">',
    '  <resources>', ...resources, '  </resources>',
    '  <library>', '    <event name="AI Generated Project">',
    `      <project name="${escapeXml(projectName || 'AI Project')}">`,
    `        <sequence format="r0" duration="${totalDuration}/${frameRate}s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    '          <spine>', ...clips, '          </spine>',
    '        </sequence>', '      </project>', '    </event>', '  </library>',
    '</fcpxml>', '',
  ].join('\n');
}
