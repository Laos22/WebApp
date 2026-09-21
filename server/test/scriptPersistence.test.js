import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/routes/projectRoutes.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from\s+"[^"]+";\n/gm, '')
  .replace('export default router;', '');

function setup({ owner = true, failWrite = false, failMirror = false } = {}) {
  const routes = new Map();
  let project = { _id: 'project', userId: 'owner', projectPath: '/virtual' };
  let generated = 0;
  let state = { topic: 'Keep topic', coverData: { title: 'Keep cover' } };
  const Project = {
    async findOne(filter) {
      assert.equal(filter.userId, 'owner');
      return owner ? structuredClone(project) : null;
    },
    async findOneAndUpdate(filter, update, options) {
      assert.equal(filter.userId, 'owner');
      assert.equal(options.new, true);
      if (failWrite) throw new Error('Database unavailable');
      if (!owner || (filter['script.revision'] !== undefined && filter['script.revision'] !== project.script?.revision)
        || (filter['script.status'] && filter['script.status'] !== project.script?.status)) return null;
      project.script ||= {};
      if (Array.isArray(update)) {
        const set = update[0].$set;
        project.script.content = set['script.content'].$literal;
        project.script.status = set['script.status'];
        project.script.generatedAt = set['script.generatedAt'];
        project.script.confirmedAt = set['script.confirmedAt'];
        project.script.revision = (project.script.revision || 0) + 1;
        project.updatedAt = set.updatedAt;
        return structuredClone(project);
      }
      assert.equal(options.runValidators, true);
      for (const [key, value] of Object.entries(update.$set)) {
        if (key.startsWith('script.')) project.script[key.slice(7)] = value;
        else project[key] = value;
      }
      if (update.$inc) project.script.revision = (project.script.revision || 0) + 1;
      return structuredClone(project);
    },
  };
  const router = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map(method => [method,
    (path, ...handlers) => routes.set(`${method} ${path}`, handlers.at(-1))]));
  vm.runInNewContext(source, {
    process: { env: {} },
    express: { Router: () => router }, ensureAuthenticated() {}, Project,
    multer: Object.assign(() => ({ single: () => (_req, _res, next) => next() }), {
      memoryStorage: () => ({}), MulterError: class MulterError extends Error {},
    }),
    MAX_VISUAL_REFERENCE_BYTES: 15 * 1024 * 1024,
    projectUsesDrive: () => false,
    markVisualBibleStaleUpdate: () => ({ $set: {} }),
    Settings: { findOne: async () => ({ prompts: { script: 'unchanged prompt' } }) },
    resolveProfile: () => 'profile',
    generateScript: async (...args) => {
      assert.deepEqual(args, ['unchanged prompt', 'description', 'profile']);
      generated++;
      return `Generated ${generated}`;
    },
    fs: { existsSync: () => true, mkdirSync() {}, readFileSync: () => JSON.stringify(state),
      writeFileSync: (_, value) => { if (failMirror) throw new Error('Disk unavailable'); state = JSON.parse(value); } },
    path: { join: (...parts) => parts.join('/') }, console: { error() {} },
  });
  return {
    async request(route, body = {}) {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await routes.get(route)({ params: { id: 'project' }, user: { _id: 'owner' }, body }, res);
      return res;
    },
    state: () => state, generated: () => generated,
  };
}
const generate = app => app.request('post /:id/generate-script', { prompt: 'prompt', projectDescription: 'description' });

test('generate, reload, edit, confirm and regenerate; preserve legacy state', async () => {
  const app = setup();
  assert.equal((await generate(app)).body.savedScript.revision, 1);
  const loaded = (await app.request('get /:id')).body.project.script;
  assert.equal(loaded.content, 'Generated 1');
  assert.equal(loaded.status, 'draft');
  assert.ok(loaded.generatedAt);
  assert.equal(loaded.confirmedAt, null);
  const edited = await app.request('put /:id/script', { content: 'Edited', revision: 1 });
  assert.equal(edited.body.script.revision, 2);
  assert.equal(app.state().generatedScript, 'Edited');
  assert.equal(app.state().topic, 'Keep topic');
  assert.equal(app.state().coverData.title, 'Keep cover');
  assert.equal((await app.request('post /:id/script/confirm', { revision: 1 })).code, 409);
  const confirmed = await app.request('post /:id/script/confirm', { revision: 2 });
  assert.equal(confirmed.body.script.status, 'confirmed');
  assert.ok(confirmed.body.script.confirmedAt);
  const regenerated = (await generate(app)).body.savedScript;
  assert.equal(regenerated.revision, 3);
  assert.equal(regenerated.status, 'draft');
  assert.equal(regenerated.confirmedAt, null);
});

test('foreign project is rejected before AI or writes', async () => {
  const app = setup({ owner: false });
  for (const response of [await generate(app), await app.request('get /:id'),
    await app.request('put /:id/script', { content: 'Edited', revision: 1 }),
    await app.request('post /:id/script/confirm', { revision: 1 })]) assert.equal(response.code, 404);
  assert.equal(app.generated(), 0);
});

test('MongoDB errors never report success or update the legacy file', async () => {
  const app = setup({ failWrite: true });
  for (const response of [await generate(app),
    await app.request('put /:id/script', { content: 'Edited', revision: 1 }),
    await app.request('post /:id/script/confirm', { revision: 1 })]) {
    assert.equal(response.code, 500);
    assert.notEqual(response.body.success, true);
  }
  assert.equal(app.state().generatedScript, undefined);
});

test('legacy disk error returns a warning while MongoDB remains readable', async () => {
  const app = setup({ failMirror: true });
  const response = await generate(app);
  assert.equal(response.body.success, true);
  assert.ok(response.body.warning);
  assert.equal((await app.request('get /:id')).body.project.script.content, 'Generated 1');
});

test('empty content and invalid revision are rejected', async () => {
  const app = setup();
  assert.equal((await app.request('put /:id/script', { content: ' ', revision: 1 })).code, 400);
  assert.equal((await app.request('post /:id/script/confirm', { revision: -1 })).code, 400);
});
