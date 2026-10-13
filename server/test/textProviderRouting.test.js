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

test('video planning sends editable music instructions as an OpenRouter system message', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[0].content, 'Compose a restrained seamless loop.');
    assert.equal(body.messages[1].role, 'user');
    assert.equal(body.messages[1].content, 'Storyboard and timing');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
  });
  assert.equal(await service.generateVideoPlanText('Storyboard and timing', profile, true,
    'Compose a restrained seamless loop.'), '{}');
});

test('video planning sends editable music instructions as a Google system instruction', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(JSON.stringify(body.systemInstruction), /Compose a restrained seamless loop/);
    assert.match(JSON.stringify(body.contents), /Storyboard and timing/);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }], role: 'model' }, finishReason: 'STOP' }] }),
      { headers: { 'Content-Type': 'application/json' } });
  });
  const googleProfile = { ...profile, provider: 'google_studio', apiKey: encryptData('test-google-key'),
    textSettings: { primaryModel: 'gemini-test' } };
  assert.equal(await service.generateVideoPlanText('Storyboard and timing', googleProfile, true,
    'Compose a restrained seamless loop.'), '{}');
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
  await assert.rejects(service.editScript('Script', 'Edit', profile), /модель не вернула готовый текст/);
});

test('script operations allow ten minutes; bounded video planning retains its timeout', async t => {
  const timeouts = [];
  t.mock.method(AbortSignal, 'timeout', ms => {
    timeouts.push(ms);
    return new AbortController().signal;
  });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(JSON.parse(options.body).stream, false);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Complete script' }, finish_reason: 'stop' }] }));
  });
  await service.generateScript('System', 'Project', profile);
  await service.editScript('Script', 'Edit', profile);
  await service.generateVideoPlanText('Plan', profile);
  assert.deepEqual(timeouts, [600000, 600000, 90000]);
});

for (const phase of ['headers', 'body']) {
  test(`timeout during ${phase} is reported as a timeout, not empty text`, async t => {
    const controller = new AbortController();
    t.mock.method(AbortSignal, 'timeout', () => controller.signal);
    const abort = () => {
      controller.abort(new DOMException('Timed out', 'TimeoutError'));
      throw new DOMException('Aborted', 'AbortError');
    };
    t.mock.method(globalThis, 'fetch', async () => {
      if (phase === 'headers') return abort();
      return { ok: true, status: 200, headers: new Headers(), json: async () => abort() };
    });
    await assert.rejects(service.editScript('Script', 'Edit', profile), error => {
      assert.equal(error.status, 504);
      assert.equal(error.code, 'OPENROUTER_TIMEOUT');
      assert.match(error.message, /600 сек/);
      return true;
    });
  });
}

test('malformed JSON and non-JSON HTTP errors preserve useful diagnostics', async t => {
  for (const status of [200, 502]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('<html>Bad gateway</html>', { status }));
    await assert.rejects(service.editScript('Script', 'Edit', profile), error => {
      assert.equal(error.code, 'OPENROUTER_RESPONSE_ERROR');
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /не вернула готовый текст/);
      if (status === 502) assert.match(error.message, /HTTP 502/);
      return true;
    });
  }
});

for (const reason of ['length', 'cancelled', 'error', 'content_filter']) {
  test(`unfinished response (${reason}) is rejected even with partial text`, async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      id: 'test-generation', choices: [{ finish_reason: reason, message: { content: 'Partial script' } }],
    })));
    await assert.rejects(service.editScript('Script', 'Edit', profile), error => {
      assert.equal(error.code, 'OPENROUTER_INCOMPLETE_RESPONSE');
      assert.equal(error.finishReason, reason);
      assert.equal(error.generationId, 'test-generation');
      return true;
    });
  });
}
