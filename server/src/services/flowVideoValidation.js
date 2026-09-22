const CONTRACT_FILENAME_PATTERN = /^video_(frame_[0-9a-fA-F-]{8,72})__([0-9a-fA-F]{64})\.mp4$/i;
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9_\-. ]+\.mp4$/i;

const SUPPORTED_MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso4', 'iso5', 'iso6',
  'mp41', 'mp42', 'avc1', 'qt  ', 'dash',
  'm4v ', 'm4v', 'msnv', 'mp71',
]);

export const FLOW_VIDEO_ERROR_MESSAGES = {
  INVALID_PROJECT_ID: { status: 400, error: 'Некорректный проект.' },
  PROJECT_NOT_FOUND: { status: 404, error: 'Проект не найден.' },
  FRAME_NOT_FOUND: { status: 404, error: 'Кадр не найден в проекте.' },
  FRAME_NOT_SELECTED: { status: 400, error: 'Кадр не выбран в видеоплане для генерации видео.' },
  INVALID_FRAME_ID: { status: 400, error: 'Некорректный идентификатор кадра.' },
  INVALID_INPUT_FINGERPRINT: { status: 400, error: 'Некорректный отпечаток кадра (inputFingerprint).' },
  INVALID_VIDEO_FILENAME: { status: 400, error: 'Некорректное имя видеофайла.' },
  INVALID_VIDEO_FILE: { status: 415, error: 'Некорректный или повреждённый файл MP4.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, error: 'Неподдерживаемый формат медиа.' },
  PAYLOAD_TOO_LARGE: { status: 413, error: 'Размер видео превышает лимит 64 МБ.' },
  VIDEO_EXPORT_TOO_LARGE: { status: 413, error: 'Превышен лимит размера данных пакета для экспорта.' },
  NO_PENDING_VIDEOS: { status: 409, error: 'Нет кадров, требующих генерации видео.' },
  STORYBOARD_NOT_CONFIRMED: { status: 409, error: 'Раскадровка должна быть актуальной и подтверждённой.' },
  VIDEO_PLAN_NOT_CONFIRMED: { status: 409, error: 'Видеоплан должен быть подтверждённым.' },
  STALE_INPUT_FINGERPRINT: { status: 409, error: 'Исходные данные кадра изменились. Сгенерируйте видео заново.' },
  VIDEO_PLAN_CONFLICT: { status: 409, error: 'Конфликт одновременного сохранения. Обновите данные.' },
  INVALID_VIDEO_PLAN_VERSION: { status: 400, error: 'Некорректная версия видеоплана.' },
  INVALID_REQUEST: { status: 400, error: 'Некорректный запрос.' },
  IMAGE_MISSING: { status: 409, error: 'Изображение кадра отсутствует или устарело.' },
  VIDEO_TIMING_UNAVAILABLE: { status: 409, error: 'Не удалось рассчитать тайминг кадра.' },
  PLAN_NOT_READY: { status: 400, error: 'У выбранного кадра не подготовлен промт видео.' },
  AI_RATE_LIMIT: { status: 429, error: 'Временное ограничение ИИ. Повторите позже.' },
  FRAME_CHANGED: { status: 409, error: 'Кадр или раскадровка изменены. Обновите данные.' },
  INVALID_VIDEO_PLAN: { status: 400, error: 'Некорректные данные видеоплана.' },
  UNKNOWN_FRAME_ID: { status: 400, error: 'Кадр изменён или удалён. Обновите данные.' },
  DUPLICATE_FRAME_ID: { status: 400, error: 'Кадр указан несколько раз.' },
};

export function classifyFlowVideoError(error) {
  const code = error?.code;
  if (code && FLOW_VIDEO_ERROR_MESSAGES[code]) {
    const item = FLOW_VIDEO_ERROR_MESSAGES[code];
    return {
      status: error.status || item.status,
      code,
      error: item.error,
    };
  }
  return {
    status: 503,
    code: 'VIDEO_PLAN_FAILED',
    error: 'Не удалось обработать видеоплан. Повторите позже.',
  };
}

export function parseFlowVideoFilename(filename) {
  if (typeof filename !== 'string') return null;
  const match = filename.match(CONTRACT_FILENAME_PATTERN);
  if (!match) return null;
  return {
    frameId: match[1],
    inputFingerprint: match[2].toLowerCase(),
  };
}

export function isSafeFilename(filename) {
  if (typeof filename !== 'string' || !filename || filename.length > 255) return false;
  if (filename.includes('\0') || filename.includes('/') || filename.includes('\\') || filename.includes('..')) return false;
  if (/^[a-zA-Z]:/.test(filename)) return false;
  return SAFE_FILENAME_PATTERN.test(filename);
}

export function validateUploadedFilename(filename, expectedFrameId, expectedFingerprint) {
  if (!isSafeFilename(filename)) {
    throw Object.assign(new Error('INVALID_VIDEO_FILENAME'), { code: 'INVALID_VIDEO_FILENAME', status: 400 });
  }
  const parsed = parseFlowVideoFilename(filename);
  if (parsed) {
    if (parsed.frameId !== expectedFrameId || parsed.inputFingerprint !== expectedFingerprint.toLowerCase()) {
      throw Object.assign(new Error('INVALID_VIDEO_FILENAME'), { code: 'INVALID_VIDEO_FILENAME', status: 400 });
    }
  }
  return true;
}

function parseMp4Boxes(buffer) {
  const boxes = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
    }
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let size = size32;
    let headerSize = 8;
    if (size32 === 1) {
      if (offset + 16 > buffer.length) {
        throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
      }
      const size64 = buffer.readBigUInt64BE(offset + 8);
      if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
      }
      size = Number(size64);
      headerSize = 16;
    } else if (size32 === 0) {
      size = buffer.length - offset;
    }
    if (size < headerSize || offset + size > buffer.length) {
      throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
    }
    boxes.push({
      type,
      offset,
      size,
      headerSize,
      payloadOffset: offset + headerSize,
      payloadSize: size - headerSize,
    });
    offset += size;
  }
  return boxes;
}

function parseContainerBoxes(buffer, startOffset, endOffset) {
  const boxes = [];
  let offset = startOffset;
  while (offset < endOffset) {
    if (offset + 8 > endOffset) {
      throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
    }
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let size = size32;
    let headerSize = 8;
    if (size32 === 1) {
      if (offset + 16 > endOffset) {
        throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
      }
      const size64 = buffer.readBigUInt64BE(offset + 8);
      if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
      }
      size = Number(size64);
      headerSize = 16;
    } else if (size32 === 0) {
      size = endOffset - offset;
    }
    if (size < headerSize || offset + size > endOffset) {
      throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
    }
    boxes.push({
      type,
      offset,
      size,
      headerSize,
      payloadOffset: offset + headerSize,
      payloadSize: size - headerSize,
    });
    offset += size;
  }
  return boxes;
}

export function validateMp4Buffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
    throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
  }

  const rootBoxes = parseMp4Boxes(buffer);
  const ftypBox = rootBoxes.find(b => b.type === 'ftyp');
  if (!ftypBox || ftypBox.payloadSize < 8) {
    throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
  }

  const majorBrand = buffer.toString('ascii', ftypBox.payloadOffset, ftypBox.payloadOffset + 4);
  let brandMatched = SUPPORTED_MP4_BRANDS.has(majorBrand.toLowerCase());

  if (!brandMatched) {
    // Check compatible brands in remainder of ftyp payload
    for (let pos = ftypBox.payloadOffset + 8; pos + 4 <= ftypBox.payloadOffset + ftypBox.payloadSize; pos += 4) {
      const compatibleBrand = buffer.toString('ascii', pos, pos + 4).toLowerCase();
      if (SUPPORTED_MP4_BRANDS.has(compatibleBrand)) {
        brandMatched = true;
        break;
      }
    }
  }

  if (!brandMatched) {
    throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
  }

  const mdatBox = rootBoxes.find(b => b.type === 'mdat');
  if (!mdatBox || mdatBox.payloadSize <= 0) {
    throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
  }

  const moovBox = rootBoxes.find(b => b.type === 'moov');
  if (!moovBox || moovBox.payloadSize < 8) {
    throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
  }

  const moovChildren = parseContainerBoxes(buffer, moovBox.payloadOffset, moovBox.payloadOffset + moovBox.payloadSize);
  const mvhdBox = moovChildren.find(b => b.type === 'mvhd');
  if (!mvhdBox || mvhdBox.payloadSize < 20) {
    throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
  }

  const mvhdVersion = buffer.readUInt8(mvhdBox.payloadOffset);
  let timescale = 0;
  let duration = 0;
  if (mvhdVersion === 0) {
    timescale = buffer.readUInt32BE(mvhdBox.payloadOffset + 12);
    duration = buffer.readUInt32BE(mvhdBox.payloadOffset + 16);
  } else if (mvhdVersion === 1) {
    if (mvhdBox.payloadSize < 32) {
      throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
    }
    timescale = buffer.readUInt32BE(mvhdBox.payloadOffset + 20);
    const duration64 = buffer.readBigUInt64BE(mvhdBox.payloadOffset + 24);
    if (duration64 > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
    }
    duration = Number(duration64);
  } else {
    throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
  }

  if (!Number.isFinite(timescale) || timescale <= 0 || !Number.isFinite(duration) || duration <= 0) {
    throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
  }

  const durationSec = duration / timescale;
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
  }

  const trakBoxes = moovChildren.filter(b => b.type === 'trak');
  if (trakBoxes.length === 0) {
    throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
  }

  let hasValidVideoTrack = false;
  let videoWidth = null;
  let videoHeight = null;

  for (const trak of trakBoxes) {
    const trakChildren = parseContainerBoxes(buffer, trak.payloadOffset, trak.payloadOffset + trak.payloadSize);
    const tkhd = trakChildren.find(b => b.type === 'tkhd');
    if (!tkhd || tkhd.payloadSize < 84) continue;

    const tkhdVersion = buffer.readUInt8(tkhd.payloadOffset);
    if (tkhdVersion !== 0 && tkhdVersion !== 1) continue;

    let width = null;
    let height = null;
    const widthOffset = tkhdVersion === 0 ? tkhd.payloadOffset + 76 : tkhd.payloadOffset + 88;
    const heightOffset = tkhdVersion === 0 ? tkhd.payloadOffset + 80 : tkhd.payloadOffset + 92;
    if (tkhd.payloadOffset + tkhd.payloadSize >= heightOffset + 4) {
      width = Math.round(buffer.readUInt32BE(widthOffset) / 65536);
      height = Math.round(buffer.readUInt32BE(heightOffset) / 65536);
    }

    const mdia = trakChildren.find(b => b.type === 'mdia');
    if (!mdia || mdia.payloadSize < 16) continue;

    const mdiaChildren = parseContainerBoxes(buffer, mdia.payloadOffset, mdia.payloadOffset + mdia.payloadSize);
    const mdhd = mdiaChildren.find(b => b.type === 'mdhd');
    if (!mdhd || mdhd.payloadSize < 20) continue;

    const hdlr = mdiaChildren.find(b => b.type === 'hdlr');
    if (!hdlr || hdlr.payloadSize < 12) continue;

    const handlerType = buffer.toString('ascii', hdlr.payloadOffset + 8, hdlr.payloadOffset + 12);
    if (handlerType !== 'vide') continue;

    const minf = mdiaChildren.find(b => b.type === 'minf');
    if (!minf || minf.payloadSize < 8) continue;

    hasValidVideoTrack = true;
    if (width && width > 0 && height && height > 0) {
      videoWidth = width;
      videoHeight = height;
    }
  }

  if (!hasValidVideoTrack) {
    throw Object.assign(new Error('INVALID_VIDEO_FILE'), { code: 'INVALID_VIDEO_FILE', status: 415 });
  }

  return {
    valid: true,
    durationSec,
    width: videoWidth,
    height: videoHeight,
    majorBrand,
  };
}
