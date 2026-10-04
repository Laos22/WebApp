const referenceId = 'ref_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const outputPattern = new RegExp(`^reference_(${referenceId})__([0-9a-f]{64})\\.(png|jpe?g|webp)$`, 'i');

export function referenceFlowImage(path) {
  if (typeof path !== 'string' || path.startsWith('/') || /[\\\x00-\x1f:]/.test(path)) return null;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '..' || part === '.' || part === '__MACOSX')) return null;
  const match = parts.at(-1).match(outputPattern);
  return match ? { referenceId: match[1].toLowerCase(), inputFingerprint: match[2].toLowerCase() } : null;
}

export function referenceFlowBase(id, fingerprint) {
  const base = `reference_${id}__${fingerprint}`;
  if (!referenceFlowImage(`${base}.png`)) throw new Error('Invalid reference filename');
  return base;
}
