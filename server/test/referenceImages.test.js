import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import Project from '../src/models/Project.js';
import VisualReference from '../src/models/VisualReference.js';
import { referenceFingerprint, requireReferenceItem, saveReferenceImage } from '../src/services/referenceImageService.js';
import { referenceFlowBase, referenceFlowImage } from '../../shared/referenceFlow.js';
import { readVisualReferenceFile } from '../src/services/visualReferenceStorage.js';
process.env.ENCRYPTION_KEY ||= 'test-encryption-key-that-is-longer-than-32-characters';
const { default: router } = await import('../src/routes/referenceImageRoutes.js');

const userId = 'a'.repeat(24);
const item = { id: 'ref_12345678-1234-4123-8123-123456789012', selected: true, version: 1, prompt: 'A mountain lake', name: 'Lake', type: 'location', description: 'Mountains' };
const fixture = () => ({ _id: 'b'.repeat(24), script: { status: 'confirmed', revision: 2 }, referencePlan: { status: 'confirmed', sourceScriptRevision: 2, items: [{ ...item }] } });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64');

test('Flow names map to references and reject traversal or storyboard files', () => {
  const fingerprint = referenceFingerprint(fixture(), item);
  const name = `${referenceFlowBase(item.id, fingerprint)}.webp`;
  assert.deepEqual(referenceFlowImage(`results/${name}`), { referenceId: item.id, inputFingerprint: fingerprint });
  for (const invalid of [`../${name}`, `/tmp/${name}`, `C:\\${name}`, `__MACOSX/${name}`, 'frame_1.png']) assert.equal(referenceFlowImage(invalid), null);
});

test('reference snapshots reject changed prompt, project, version, selection and script', () => {
  const original = fixture();
  const fingerprint = referenceFingerprint(original, item);
  assert.equal(requireReferenceItem(original, item.id, null, null, fingerprint).id, item.id);
  for (const mutate of [
    p => { p.referencePlan.items[0].prompt = 'Other prompt'; },
    p => { p.referencePlan.items[0].version++; },
    p => { p.referencePlan.items[0].selected = false; },
    p => { p._id = 'c'.repeat(24); },
    p => { p.script.revision++; },
    p => { p.referencePlan.status = 'draft'; },
  ]) {
    const changed = fixture(); mutate(changed);
    assert.throws(() => requireReferenceItem(changed, item.id, null, null, fingerprint), e => e.status === 409);
  }
});

test('a failed image replacement keeps the previous file and removes only the new file', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-images-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = { ...fixture(), projectPath: root };
  await fs.mkdir(path.join(root, 'references'), { recursive: true });
  await fs.writeFile(path.join(root, 'references/old.png'), png);
  const previous = { _id: 'c'.repeat(24), storageKey: 'project/references/old.png', updatedAt: new Date() };
  t.mock.method(Project, 'findOne', async filter => { assert.deepEqual(filter, { _id: project._id, userId }); return project; });
  t.mock.method(VisualReference, 'findOneAndUpdate', async filter => {
    assert.deepEqual(filter, { _id: previous._id, userId, storageKey: previous.storageKey, updatedAt: previous.updatedAt });
    return null;
  });
  await assert.rejects(saveReferenceImage({ project, userId, item, previous, buffer: png }), e => e.status === 409);
  assert.deepEqual(await fs.readFile(path.join(root, 'references/old.png')), png);
  assert.deepEqual(await fs.readdir(path.join(root, 'references', item.id)), []);
});

test('first reference image is saved with metadata and can be read back', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-images-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = { ...fixture(), projectPath: root };
  let record;
  t.mock.method(Project, 'findOne', async () => project);
  t.mock.method(VisualReference, 'create', async data => { record = data; });
  await saveReferenceImage({ project, userId, item, previous: null, buffer: png });
  assert.equal(record.referenceId, item.id);
  assert.equal(record.sourceReferenceVersion, 1);
  assert.equal(record.mimeType, 'image/png');
  assert.deepEqual(await readVisualReferenceFile(record.storageKey, root, userId), png);
});

async function exportRoute({ authenticated = true, query = {} } = {}) {
  const layer = router.stack.find(layer => layer.route?.path === '/:id/reference-plan/flow/export');
  const req = { params: { id: fixture()._id }, user: { _id: userId }, query, isAuthenticated: () => authenticated };
  const res = { code: 200, status(code) { this.code = code; return this; }, set() { return this; }, json(data) { this.data = data; return this; }, send(data) { this.data = data; return this; } };
  for (const handler of layer.route.stack) {
    let next = false;
    await handler.handle(req, res, () => { next = true; });
    if (!next) break;
  }
  return res;
}

test('Flow export verifies owner, skips ready images, and includes matching prompts and filenames', async t => {
  const project = fixture();
  const second = { ...item, id: 'ref_22345678-1234-4123-8123-123456789012', name: 'Ready' };
  project.referencePlan.items.push(second);
  t.mock.method(Project, 'findOne', async filter => { assert.deepEqual(filter, { _id: project._id, userId }); return project; });
  t.mock.method(VisualReference, 'find', async () => [{ referenceId: second.id, status: 'ready', sourceReferenceVersion: second.version, prompt: second.prompt }]);
  assert.equal((await exportRoute({ authenticated: false })).code, 401);
  const result = await exportRoute();
  assert.equal(result.code, 200);
  const zip = await JSZip.loadAsync(result.data);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.references.length, 1);
  assert.equal(manifest.kind, 'reference-images');
  const output = manifest.references[0];
  assert.equal(referenceFlowImage(output.outputFile).referenceId, item.id);
  assert.equal(await zip.file(`prompts/${output.outputFile.replace('.png', '.txt')}`).async('string'), item.prompt);
  const all = await JSZip.loadAsync((await exportRoute({ query: { all: '1' } })).data);
  assert.equal(JSON.parse(await all.file('manifest.json').async('string')).references.length, 2);
});

test('Flow export rejects a plan changed while the archive was built', async t => {
  let reads = 0;
  t.mock.method(Project, 'findOne', async () => {
    const project = fixture();
    if (++reads > 1) project.referencePlan.items[0].prompt = 'Changed';
    return project;
  });
  t.mock.method(VisualReference, 'find', async () => []);
  assert.equal((await exportRoute()).code, 409);
});
