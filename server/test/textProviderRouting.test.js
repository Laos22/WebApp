import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY ||= 'text-provider-routing-tests-key-32-characters';
const service = await import('../src/services/geminiService.js');
const { encryptData } = await import('../src/services/encryptionService.js');
const profile = {
  type: 'text', provider: 'openrouter', apiKey: encryptData('test-openrouter-key'),
  textSettings: { primaryModel: 'moonshotai/kimi-k2.5', temperature: 0 },
};
const project = { title: 'Project', script: { content: 'Script' }, voiceover: { blocks: [] } };
const topics = [{ full_topic: 'Topic', full_description: 'Description', short_title: 'Назва' }];
const cases = [
  ['script', p => service.generateScript('System instructions', 'Project description', p), false, 'Generated text'],
  ['edit script', p => service.editScript('Current script', 'Edit instruction', p), false, 'Generated text'],
  ['topics', p => service.generateVideoTopic('System instructions', 'Keywords', p), false, JSON.stringify(topics)],
  ['voiceover', p => service.generateVoiceoverAdaptation(project, [], '', '{{SCRIPT}}', p), true, '{"blocks":[]}'],
  ['reference analysis', p => service.analyzeScriptReferences(project, [], '', '{{SCRIPT}}', p), true, '{"references":[]}'],
  ['reference detail', p => service.detailReferencePrompt(project, { name: 'Reference' }, '', '{{REFERENCE}}', p), false, 'Generated text'],
  ['frame detail', p => service.detailStoryboardFramePrompt(project, { id: 'frame' }, [], '', '{{FRAME}}', p), false, 'Generated text'],
  ['visual bible', p => service.generateVisualBibleDraft('Project', 'Script', '{{SCRIPT}}', p), true, '{}'],
  ['edit visual bible', p => service.editVisualBible('Project', 'Script', {}, 'Instruction', '{{INSTRUCTION}}', p), true, '{}'],
  ['video plan', p => service.generateVideoPlanText('Plan instructions', p, true), true, '{}'],
];

for (const [name, invoke, json, content] of cases) {
  test(`${name} routes the selected OpenRouter profile to chat completions`, async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      calls++;
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer test-openrouter-key');
      assert.ok(options.signal instanceof AbortSignal);
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'moonshotai/kimi-k2.5');
      assert.equal(body.temperature, 0);
      assert.deepEqual(body.response_format, json ? { type: 'json_object' } : undefined);
      assert.ok(body.messages.at(-1).content.length);
      if (name === 'script') {
        assert.match(body.messages[0].content, /System instructions/);
        assert.match(body.messages[0].content, /Project description/);
      }
      if (name === 'edit script') {
        assert.equal(body.messages[0].role, 'system');
        assert.match(body.messages[0].content, /Верни полный обновлённый сценарий/);
        assert.deepEqual(JSON.parse(body.messages[1].content), { currentScript: 'Current script', instruction: 'Edit instruction' });
      }
      if (name === 'video plan') assert.equal(body.max_tokens, 12000);
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    });
    const result = await invoke(profile);
    assert.deepEqual(result, name === 'topics' ? topics : content);
    assert.equal(calls, 1);
  });
}

test('Google Studio still uses the Google endpoint and response format', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.match(String(url), /^https:\/\/generativelanguage\.googleapis\.com\/.*models\/gemini-test:generateContent$/);
    const body = JSON.parse(options.body);
    assert.match(body.contents[0].parts[0].text, /Project description/);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Google script' }], role: 'model' }, finishReason: 'STOP' }] }), { headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal(await service.generateScript('System', 'Project description', {
    ...profile, provider: 'google_studio', apiKey: encryptData('test-google-key'),
    textSettings: { primaryModel: 'gemini-test' },
  }), 'Google script');
  assert.equal(calls, 1);
});

test('OpenRouter missing key never falls back to a Google credential or sends a request', async t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No request should be sent'));
  await assert.rejects(service.editScript('Script', 'Edit', { ...profile, apiKey: null }), /API-ключ OpenRouter не найден/);
});

test('OpenRouter errors retain status and explain an empty 404 message', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: '', code: 404 } }), { status: 404, statusText: 'Not Found' }));
  await assert.rejects(service.editScript('Script', 'Edit', profile), error => {
    assert.equal(error.status, 404);
    assert.equal(error.code, 404);
    assert.match(error.message, /OpenRouter: HTTP 404/);
    assert.match(error.message, /moonshotai\/kimi-k2.5/);
    return true;
  });
});

test('OpenRouter rate limit retains retry timing for frame detail', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'Rate limited', code: 429 } }), { status: 429, headers: { 'Retry-After': '15' } }));
  await assert.rejects(service.detailStoryboardFramePrompt(project, {}, [], '', '{{FRAME}}', profile), error => {
    assert.equal(error.code, 'STORYBOARD_DETAIL_RATE_LIMIT');
    assert.equal(error.retryAfterMs, 15000);
    return true;
  });
});

test('OpenRouter empty response is rejected', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] })));
  await assert.rejects(service.editScript('Script', 'Edit', profile), /OpenRouter returned empty text/);
});
