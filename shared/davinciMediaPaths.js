function invalid() { throw Object.assign(new Error('INVALID_DAVINCI_MEDIA_ROOT'), { code: 'INVALID_DAVINCI_MEDIA_ROOT' }); }

export function normalizeMediaRoot(value) {
  if (typeof value !== 'string' || value.length > 4000 || /[\u0000-\u001f]/.test(value)) invalid();
  const root = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!root || (!root.startsWith('/') && !/^[a-z]:\//i.test(root))) invalid();
  if (root.split('/').some(part => part === '..' || part === '.')) invalid();
  return root;
}

// Only constructs XML references. This value is never used as a server write path.
export function mediaSourceUrl(root, relativePath) {
  if (!root) return relativePath;
  const normalized = normalizeMediaRoot(root);
  const encoded = `${normalized}/${relativePath}`.split('/').map((part, i) =>
    i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/');
  if (normalized.startsWith('//')) return `file:${encoded}`;
  return `file://${normalized.startsWith('/') ? '' : '/'}${encoded}`;
}
