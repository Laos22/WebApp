export const FIXTURE_PROJECT_ID = '507f1f77bcf86cd799439011';
export const FIXTURE_USER_ID = '507f1f77bcf86cd799439022';
export const FIXTURE_FRAME_ID_1 = 'frame_11111111-1111-4111-8111-111111111111';
export const FIXTURE_FRAME_ID_2 = 'frame_22222222-2222-4222-8222-222222222222';

export const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

export function createFixtureProject({
  rootPath = '',
  storyboardRevision = 1,
  videoPlanRevision = 1,
  videoPlanEditVersion = 1,
  audioDurationSec1 = 5.0,
  audioDurationSec2 = 6.0,
  selected1 = true,
  selected2 = true,
  videoPrompt1 = 'Камера медленно приближается',
  videoPrompt2 = 'Панорама слева направо',
  isDrive = false,
} = {}) {
  return {
    _id: FIXTURE_PROJECT_ID,
    title: 'Flow Video Test Project',
    userId: FIXTURE_USER_ID,
    projectPath: rootPath,
    ...(isDrive ? { googleDriveFolderId: 'gdrive_folder_123' } : {}),
    script: { status: 'confirmed', revision: 1 },
    referencePlan: { status: 'confirmed', revision: 1, items: [] },
    voiceover: {
      status: 'confirmed',
      revision: 1,
      blocks: [
        { id: 'b1', order: 1, adaptedText: 'Текст озвучки первого блока для видео', audioDurationSec: audioDurationSec1, audioStatus: 'ready' },
        { id: 'b2', order: 2, adaptedText: 'Текст озвучки второго блока для видео', audioDurationSec: audioDurationSec2, audioStatus: 'ready' },
      ],
    },
    storyboard: {
      status: 'confirmed',
      revision: storyboardRevision,
      sourceScriptRevision: 1,
      sourceReferencePlanRevision: 1,
      sourceVoiceoverRevision: 1,
      frames: [
        { id: FIXTURE_FRAME_ID_1, sourceVoiceoverBlockId: 'b1', scriptText: 'Текст озвучки первого блока для видео', visualDescription: 'Визуал 1', prompt: 'Промт картинки 1', referenceIds: [] },
        { id: FIXTURE_FRAME_ID_2, sourceVoiceoverBlockId: 'b2', scriptText: 'Текст озвучки второго блока для видео', visualDescription: 'Визуал 2', prompt: 'Промт картинки 2', referenceIds: [] },
      ],
    },
    videoPlan: {
      status: 'confirmed',
      revision: videoPlanRevision,
      editVersion: videoPlanEditVersion,
      sourceStoryboardRevision: storyboardRevision,
      sourceStoryboardFingerprint: '',
      frames: [
        { frameId: FIXTURE_FRAME_ID_1, selected: selected1, videoPrompt: videoPrompt1, promptStatus: videoPrompt1 ? 'ready' : 'pending' },
        { frameId: FIXTURE_FRAME_ID_2, selected: selected2, videoPrompt: videoPrompt2, promptStatus: videoPrompt2 ? 'ready' : 'pending' },
      ],
    },
  };
}

export function createValidMp4Buffer({
  durationSec = 5.0,
  width = 1920,
  height = 1080,
  majorBrand = 'isom',
  compatibleBrands = ['isom', 'mp41'],
  mvhdVersion = 0,
} = {}) {
  // 1. ftyp box (24 bytes)
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write('ftyp', 4, 'ascii');
  ftyp.write(majorBrand.padEnd(4, ' ').slice(0, 4), 8, 'ascii');
  ftyp.writeUInt32BE(0x00000200, 12);
  ftyp.write(compatibleBrands[0]?.padEnd(4, ' ').slice(0, 4) || 'isom', 16, 'ascii');
  ftyp.write(compatibleBrands[1]?.padEnd(4, ' ').slice(0, 4) || 'mp41', 20, 'ascii');

  // 2. mvhd box
  let mvhd;
  if (mvhdVersion === 0) {
    mvhd = Buffer.alloc(108);
    mvhd.writeUInt32BE(108, 0);
    mvhd.write('mvhd', 4, 'ascii');
    mvhd.writeUInt8(0, 8); // version 0
    mvhd.writeUInt32BE(1000, 20); // timescale
    mvhd.writeUInt32BE(Math.round(durationSec * 1000), 24); // duration
    mvhd.writeUInt32BE(0x00010000, 28); // rate 1.0
    mvhd.writeUInt16BE(0x0100, 32); // volume 1.0
    mvhd.writeUInt32BE(0x00010000, 48);
    mvhd.writeUInt32BE(0x00010000, 64);
    mvhd.writeUInt32BE(0x40000000, 80);
    mvhd.writeUInt32BE(2, 104); // next track id
  } else {
    mvhd = Buffer.alloc(120);
    mvhd.writeUInt32BE(120, 0);
    mvhd.write('mvhd', 4, 'ascii');
    mvhd.writeUInt8(1, 8); // version 1
    mvhd.writeUInt32BE(1000, 28); // timescale at offset 28 (payload offset 20)
    mvhd.writeBigUInt64BE(BigInt(Math.round(durationSec * 1000)), 32); // duration at offset 32 (payload offset 24)
    mvhd.writeUInt32BE(0x00010000, 40);
    mvhd.writeUInt16BE(0x0100, 44);
    mvhd.writeUInt32BE(0x00010000, 60);
    mvhd.writeUInt32BE(0x00010000, 76);
    mvhd.writeUInt32BE(0x40000000, 92);
    mvhd.writeUInt32BE(2, 116);
  }

  // 3. tkhd box (92 bytes)
  const tkhd = Buffer.alloc(92);
  tkhd.writeUInt32BE(92, 0);
  tkhd.write('tkhd', 4, 'ascii');
  tkhd.writeUInt8(0, 8); // version 0
  tkhd.writeUInt32BE(1, 20); // track id
  tkhd.writeUInt32BE(Math.round(durationSec * 1000), 28);
  tkhd.writeUInt32BE(0x00010000, 48);
  tkhd.writeUInt32BE(0x00010000, 64);
  tkhd.writeUInt32BE(0x40000000, 80);
  tkhd.writeUInt32BE(width * 65536, 84); // width 16.16
  tkhd.writeUInt32BE(height * 65536, 88); // height 16.16

  // 4. mdhd box (32 bytes)
  const mdhd = Buffer.alloc(32);
  mdhd.writeUInt32BE(32, 0);
  mdhd.write('mdhd', 4, 'ascii');
  mdhd.writeUInt8(0, 8);
  mdhd.writeUInt32BE(1000, 20);
  mdhd.writeUInt32BE(Math.round(durationSec * 1000), 24);

  // 5. hdlr box (33 bytes)
  const hdlr = Buffer.alloc(33);
  hdlr.writeUInt32BE(33, 0);
  hdlr.write('hdlr', 4, 'ascii');
  hdlr.writeUInt8(0, 8);
  hdlr.write('vide', 16, 'ascii');

  // 6. minf box (16 bytes)
  const minf = Buffer.alloc(16);
  minf.writeUInt32BE(16, 0);
  minf.write('minf', 4, 'ascii');

  // 7. mdia box
  const mdiaPayload = Buffer.concat([mdhd, hdlr, minf]);
  const mdia = Buffer.alloc(8 + mdiaPayload.length);
  mdia.writeUInt32BE(mdia.length, 0);
  mdia.write('mdia', 4, 'ascii');
  mdiaPayload.copy(mdia, 8);

  // 8. trak box
  const trakPayload = Buffer.concat([tkhd, mdia]);
  const trak = Buffer.alloc(8 + trakPayload.length);
  trak.writeUInt32BE(trak.length, 0);
  trak.write('trak', 4, 'ascii');
  trakPayload.copy(trak, 8);

  // 9. moov box
  const moovPayload = Buffer.concat([mvhd, trak]);
  const moov = Buffer.alloc(8 + moovPayload.length);
  moov.writeUInt32BE(moov.length, 0);
  moov.write('moov', 4, 'ascii');
  moovPayload.copy(moov, 8);

  // 10. mdat box
  const mdatPayload = Buffer.alloc(32, 0xaa);
  const mdat = Buffer.alloc(8 + mdatPayload.length);
  mdat.writeUInt32BE(mdat.length, 0);
  mdat.write('mdat', 4, 'ascii');
  mdatPayload.copy(mdat, 8);

  return Buffer.concat([ftyp, moov, mdat]);
}

