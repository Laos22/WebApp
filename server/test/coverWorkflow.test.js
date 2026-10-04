import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import Project from '../src/models/Project.js';
import Settings from '../src/models/Settings.js';
import CoverStyle from '../src/models/CoverStyle.js';
import { buildCoverPrompt, validateCoverImage } from '../src/services/coverService.js';

process.env.AUTH_MODE = 'google';
process.env.ENCRYPTION_KEY ||= 'test-encryption-key-that-is-longer-than-32-characters';
const { buildGoogleImageInput } = await import('../src/services/googleImageService.js');
const { default: router } = await import('../src/routes/coverRoutes.js');
const { coverTemplateSvg, parseCoverAnalysis } = await import('../src/services/coverStyleService.js');
const { saveCoverToProject, readProjectCover } = await import('../src/services/coverStorage.js');
const userId = 'a'.repeat(24);
const project = { _id: 'b'.repeat(24), title: 'Несамовите', description: 'Озеро в Карпатах' };
const fields = { title: 'НЕСАМОВИТЕ', subtitle: 'ТАЄМНИЦЯ КАРПАТ', instruction: 'Светлый рассвет' };
const region = { x: 6, y: 8, width: 62, height: 27, font: 'condensed', fontSize: 110, color: '#31e0dc', outlineColor: '#101820', outlineWidth: 4, align: 'left', uppercase: true };
const template = { title: region, subtitle: { ...region, y: 37, height: 12, fontSize: 34 }, backgroundColor: '#183047', accentColor: '#eac776', designNotes: 'Яркий свет, крупный заголовок, свободная область справа.' };

async function call(path, { body = {}, file, authenticated = true, middleware = true } = {}) {
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods.post)?.route;
  const req = { params: { id: project._id }, body, file, user: { _id: userId }, coverProject: project, isAuthenticated: () => authenticated };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; }, send(data) { this.data = data; return this; }, attachment() { return this; }, type() { return this; } };
  for (const layer of middleware ? route.stack : route.stack.slice(-1)) {
    let next = false;
    await layer.handle(req, res, () => { next = true; });
    if (!next) break;
  }
  return res;
}

test('Flow exports only approved layout, never the original image or observed subject; guards ownership and revision', async t => {
  const image = await sharp({ create: { width: 32, height: 18, channels: 3, background: '#12abcd' } }).jpeg().toBuffer();
  t.mock.method(Project, 'findOne', async filter => { assert.deepEqual(filter, { _id: project._id, userId }); return project; });
  t.mock.method(Settings, 'findOne', async () => ({ prompts: { cover: 'My saved style rules' } }));
  t.mock.method(CoverStyle, 'findOne', filter => {
    assert.deepEqual(filter, { userId });
    return Promise.resolve({ revision: 'style-v2', image, mimeType: 'image/jpeg', analysis: { observation: 'A castle from the original sample' }, confirmed: { revision: 'style-v1', template } });
  });
  const path = '/:id/cover/flow/export';
  assert.equal((await call(path, { authenticated: false })).code, 401);
  assert.equal((await call(path, { body: { ...fields, styleRevision: 'old' } })).code, 409);
  const result = await call(path, { body: { ...fields, styleRevision: 'style-v1' } });
  assert.equal(result.code, 200);
  const zip = await JSZip.loadAsync(result.data);
  assert.equal(zip.file('style-reference.jpg'), null);
  const layout = await zip.file('template.png').async('nodebuffer');
  assert.notDeepEqual(layout, image);
  assert.equal((await sharp(layout).metadata()).width, 1280);
  const prompt = buildCoverPrompt({ systemPrompt: 'My saved style rules', project, ...fields, template });
  assert.doesNotMatch(prompt, /castle/);
  assert.equal(await zip.file('prompt.txt').async('string'), prompt);
  const input = buildGoogleImageInput({ prompt }, [{ name: 'style', mimeType: 'image/png', buffer: layout }], 'cover-final');
  assert.ok(input[0].text.includes(prompt));
  assert.match(input[0].text, /WITH the exact requested title and subtitle/);
  assert.doesNotMatch(input[0].text, /Do not create.*captions/);
  assert.equal(input[2].data, layout.toString('base64'));
  t.mock.method(Project, 'findOne', async () => null);
  assert.equal((await call(path, { body: fields })).code, 404);
});

test('template preview escapes text, strips unknown fields, and rejects invalid regions', async () => {
  const analysis = parseCoverAnalysis(JSON.stringify({ observation: 'На исходнике замок.', template: { ...template, scene: 'castle' } }));
  assert.equal(analysis.template.scene, undefined);
  const svg = coverTemplateSvg(analysis.template, '<b>Текст</b>', '');
  assert.ok(svg.includes('&lt;'));
  assert.ok(!svg.includes('<b>'));
  assert.equal((await sharp(Buffer.from(svg)).png().toBuffer()).length > 100, true);
  assert.throws(() => parseCoverAnalysis(JSON.stringify({ observation: 'Пример', template: { ...template, title: { ...region, x: 95 } } })));
});

test('saved cover is written to project folder and survives reload; failed DB update rolls back only new file', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-storage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const localProject = { ...project, projectPath: root };
  const buffer = await sharp({ create: { width: 32, height: 18, channels: 3, background: '#ff9900' } }).png().toBuffer();
  let saved;
  t.mock.method(Project, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { _id: project._id, userId }); saved = update.$set.coverImage; return localProject;
  });
  const cover = await saveCoverToProject({ project: localProject, userId, buffer });
  assert.equal(cover.filename, saved.filename);
  assert.deepEqual(await fs.readFile(path.join(root, 'cover', cover.filename)), buffer);
  assert.deepEqual(await readProjectCover({ ...localProject, coverImage: saved }, userId), buffer);
  t.mock.method(Project, 'findOneAndUpdate', async () => { throw new Error('DB unavailable'); });
  await assert.rejects(saveCoverToProject({ project: localProject, userId, buffer }));
  assert.deepEqual(await fs.readdir(path.join(root, 'cover')), [cover.filename]);
});

test('imports one real cover from ZIP; rejects export package and corrupt images', async () => {
  const image = await sharp({ create: { width: 32, height: 18, channels: 3, background: '#ff9900' } }).png().toBuffer();
  const zip = new JSZip().file('cover.png', image);
  const result = await call('/:id/cover/import', { middleware: false, file: { originalname: 'result.zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) } });
  assert.equal(result.code, 200);
  assert.deepEqual(Buffer.from(result.data.imageBase64, 'base64'), image);
  const wrong = await call('/:id/cover/import', { middleware: false, file: { originalname: 'package.zip', buffer: await new JSZip().file('style-reference.jpg', image).generateAsync({ type: 'nodebuffer' }) } });
  assert.equal(wrong.code, 400);
  await assert.rejects(validateCoverImage(image.subarray(0, 8)), error => error.status === 415);
  const normalized = await validateCoverImage(image, true);
  assert.equal((await sharp(normalized.buffer).metadata()).format, 'jpeg');
});
