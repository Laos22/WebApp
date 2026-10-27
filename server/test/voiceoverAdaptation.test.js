import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY ||= 'voiceover-adaptation-test-key-longer-than-32-characters';
const { default: router } = await import('../src/routes/projectRoutes.js');
const { default: Project } = await import('../src/models/Project.js');
const { default: Settings } = await import('../src/models/Settings.js');
const { encryptData } = await import('../src/services/encryptionService.js');
const {
  nextVoiceoverAdaptationBatch, validVoiceoverAdaptationResults,
} = await import('../src/services/voiceoverAdaptationService.js');
const { buildVoiceoverAdaptationPrompt } = await import('../src/services/geminiService.js');

const route = router.stack.find(layer => layer.route?.path === '/:id/voiceover/adapt' && layer.route.methods.post).route;

test('adaptation sends one block per request and does not lose earlier results', () => {
  const blocks = Array.from({ length: 4 }, (_, index) => ({ sourceId: `script_block_${index + 1}`, sourceText: 'x'.repeat(index === 1 ? 11000 : 2000) }));
  assert.deepEqual(nextVoiceoverAdaptationBatch(blocks, 0).map(block => block.sourceId), ['script_block_1']);
  assert.deepEqual(nextVoiceoverAdaptationBatch(blocks, 1).map(block => block.sourceId), ['script_block_2']);
  assert.deepEqual(nextVoiceoverAdaptationBatch(blocks, 2).map(block => block.sourceId), ['script_block_3']);
  assert.equal(validVoiceoverAdaptationResults([{ id: 'script_block_1', adaptedText: 'Один' }], blocks), true);
  assert.equal(validVoiceoverAdaptationResults([{ id: 'script_block_2', adaptedText: 'Два' }], blocks), false);
});

test('custom script placeholder includes only the current adaptation batch', () => {
  const project = { title: 'Тест', script: { content: 'Блок 1: первый. Блок 2: секрет второго.' } };
  const prompt = buildVoiceoverAdaptationPrompt(project,
    [{ sourceId: 'script_block_1', sourceTitle: 'Блок 1', sourceText: 'первый.' }],
    '', '{{SCRIPT_BLOCKS}}\n{{SCRIPT}}');
  assert.match(prompt, /первый\./u);
  assert.doesNotMatch(prompt, /секрет второго/u);
  assert.match(prompt, /ровно таким количеством результатов/u);
});

test('current source ID is explicit even if an old template shows a different example', () => {
  const prompt = buildVoiceoverAdaptationPrompt({ title: 'Тест' },
    [{ sourceId: 'script_block_7', sourceTitle: 'Блок 7', sourceText: 'Седьмой.' }],
    '', 'Пример: {"blocks":[{"id":"script_block_1","adaptedText":"..."}]}');
  assert.match(prompt, /только с этими id: script_block_7/u);
  assert.match(prompt, /Не используй id из примера/u);
});

test('partial adaptation survives a malformed next answer; resume sends only remaining block', async t => {
  const profile = { _id: 'profile-a', type: 'text', provider: 'openrouter',
    apiKey: encryptData('test-key'), textSettings: { primaryModel: 'test/model', temperature: 0.2 } };
  const originalVoiceover = { status: 'confirmed', editVersion: 2, revision: 1,
    sourceScriptRevision: 1, blocks: [{ id: 'old', order: 1, adaptedText: 'Исходный текст', audioStatus: 'ready', audioStorageKey: 'old.mp3' }] };
  const project = { _id: '111111111111111111111111', title: 'Тест',
    script: { status: 'confirmed', revision: 1, content: 'Блок 1\nПервый.\n\nБлок 2\nВторой.\n\nБлок 3\nТретий.' },
    voiceover: originalVoiceover };
  t.mock.method(Project, 'findOne', () => ({ select: async () => project }));
  t.mock.method(Settings, 'findOne', async () => ({ profiles: [profile] }));
  t.mock.method(Project, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter['voiceover.editVersion'], undefined);
    assert.equal(filter.$and[0]['voiceover.editVersion'], 2);
    Object.assign(project, update.$set);
    return project;
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const prompts = [];
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const prompt = JSON.parse(options.body).messages.at(-1).content;
    prompts.push(prompt);
    const source = JSON.parse(prompt.match(/Блоки сценария:\n(\[[^\n]+\])/u)[1]);
    const ids = source.map(block => block.id);
    const blocks = calls === 2 ? [] : ids.map(id => ({ id, adaptedText: `Адаптирован ${id}` }));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ blocks }) }, finish_reason: 'stop' }] });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const request = async () => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } };
    await route.stack.at(-1).handle({ params: { id: project._id }, user: { _id: 'owner' },
      body: { instructions: '', expectedEditVersion: 2, sourceScriptRevision: 1, profileId: profile._id } }, res);
    return res;
  };
  const first = await request();
  assert.equal(first.statusCode, 200);
  assert.equal(first.value.adaptation.completed, 1);
  assert.strictEqual(project.voiceover, originalVoiceover);
  const failed = await request();
  assert.equal(failed.statusCode, 502);
  assert.equal(project.voiceoverAdaptation.results.length, 1);
  assert.strictEqual(project.voiceover, originalVoiceover);
  const resumed = await request();
  assert.equal(resumed.statusCode, 200);
  assert.equal(resumed.value.adaptation.completed, 2);
  assert.strictEqual(project.voiceover, originalVoiceover);
  const finished = await request();
  assert.equal(finished.statusCode, 200);
  assert.equal(finished.value.adaptation.status, 'idle');
  assert.equal(finished.value.voiceover.blocks.length, 3);
  assert.equal(finished.value.voiceover.status, 'draft');
  const requestedIds = prompts.map(prompt => JSON.parse(prompt.match(/Блоки сценария:\n(\[[^\n]+\])/u)[1]).map(block => block.id));
  assert.deepEqual(requestedIds, [
    ['script_block_1'], ['script_block_2'], ['script_block_2'], ['script_block_3'],
  ]);
});
