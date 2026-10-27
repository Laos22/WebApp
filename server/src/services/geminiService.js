// server/src/services/geminiService.js
import { GoogleGenAI } from "@google/genai";
import { planStoryboardFrames, generatePlannedStoryboard } from './storyboardService.js';
import { getDecryptedApiKey } from "./aiProfileResolver.js";
import { DEFAULT_VISUAL_BIBLE_PROMPT, DEFAULT_VISUAL_BIBLE_EDIT_PROMPT, DEFAULT_REFERENCE_ANALYSIS_PROMPT, DEFAULT_REFERENCE_DETAIL_PROMPT, DEFAULT_STORYBOARD_PROMPT, DEFAULT_STORYBOARD_DETAIL_PROMPT, DEFAULT_AUDIO_ADAPTATION_PROMPT } from "../models/Settings.js";

function modelText(response) {
  const text = typeof response.text === "function" ? response.text()
    : response.text ?? response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("Missing model text");
  return text.trim();
}

async function generateOpenRouterText(prompt, profile, json = false, timeoutMs = 120_000, config = {}) {
  const apiKey = getDecryptedApiKey(profile);
  if (!apiKey) throw new Error('API-ключ OpenRouter не найден');
  const model = profile?.textSettings?.primaryModel?.trim() || 'openrouter/free';
  const signal = AbortSignal.timeout(timeoutMs);
  let response;
  let payload;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://webapp.local',
        'X-Title': 'WebApp',
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          ...(config.systemInstruction ? [{ role: 'system', content: config.systemInstruction }] : []),
          { role: 'user', content: String(prompt) },
        ],
        ...(config.maxOutputTokens ? { max_tokens: config.maxOutputTokens } : {}),
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        temperature: profile?.textSettings?.temperature ?? 0.7,
      }),
    });
    payload = await response.json();
  } catch (cause) {
    // Aborting while reading the body must not be mistaken for an empty answer.
    const timedOut = signal.aborted || cause?.name === 'TimeoutError';
    const error = new Error(timedOut
      ? `OpenRouter: время ожидания истекло (${Math.round(timeoutMs / 1000)} сек.). Модель не успела завершить ответ. Попробуйте сократить запрос или выбрать другую модель.`
      : response && !response.ok
        ? `OpenRouter: HTTP ${response.status} (${response.statusText || 'ошибка запроса'}). Не удалось прочитать ответ сервера.`
        : 'OpenRouter: не удалось прочитать ответ — соединение прервано или получен некорректный JSON.');
    error.status = timedOut ? 504 : response && !response.ok ? response.status : 502;
    error.code = timedOut ? 'OPENROUTER_TIMEOUT' : 'OPENROUTER_RESPONSE_ERROR';
    if (response) error.response = { headers: response.headers };
    throw error;
  }
  if (!response.ok || payload?.error) {
    const error = new Error(payload?.error?.message || `OpenRouter: HTTP ${response.status} (${response.statusText || 'ошибка запроса'}), модель ${model}`);
    error.status = response.ok ? 502 : response.status;
    error.response = { headers: response.headers };
    error.code = payload?.error?.code;
    throw error;
  }
  const text = payload?.choices?.[0]?.message?.content;
  const finishReason = payload?.choices?.[0]?.finish_reason;
  if (typeof text !== 'string' || !text.trim() || ['length', 'cancelled', 'error', 'content_filter'].includes(finishReason)) {
    const messages = {
      length: 'OpenRouter: достигнут лимит токенов, модель не завершила ответ. Сократите запрос или увеличьте лимит ответа и уменьшите бюджет рассуждений.',
      cancelled: 'OpenRouter: генерация отменена до завершения ответа. Попробуйте сократить запрос или выбрать другую модель.',
      error: 'OpenRouter: провайдер прервал генерацию с ошибкой. Попробуйте позже или выберите другую модель.',
      content_filter: 'OpenRouter: ответ остановлен фильтром содержимого провайдера.',
    };
    const error = new Error(messages[finishReason] || 'OpenRouter: модель не вернула готовый текст. Попробуйте позже или выберите другую модель.');
    error.status = 502;
    error.code = 'OPENROUTER_INCOMPLETE_RESPONSE';
    // Only diagnostic metadata; never log prompts, credentials or reasoning text.
    error.generationId = payload?.id;
    error.finishReason = finishReason;
    throw error;
  }
  return text.trim();
}

// Keep provider selection in one place so OpenRouter credentials never reach Google.
async function generateTextResponse(profile, operation, { contents, config = {} }) {
  if (profile?.provider === 'openrouter') {
    const prompt = typeof contents === 'string' ? contents
      : contents.flatMap(content => content.parts.map(part => part.text)).join('\n\n');
    return { text: await generateOpenRouterText(prompt, profile,
      config.responseMimeType === 'application/json',
      config.httpOptions?.timeout ?? (['generate-script', 'edit-script'].includes(operation) ? 600_000 : 120_000), config) };
  }
  const { apiKey, model } = resolveTextConfig(profile, operation);
  const ai = new GoogleGenAI({ apiKey });
  return ai.models.generateContent({ model, contents, config });
}

function providerStatus(error) {
  return Number(error?.status || error?.code || error?.response?.status || error?.error?.code) || 0;
}

export function isGeminiRateLimitError(error) {
  if (providerStatus(error) === 429) return true;
  return /(?:\b429\b|resource_exhausted|rate.?limit|quota)/i.test(String(error?.message || ""));
}

export function geminiRetryAfterMs(error, fallback = 60_000) {
  const header = error?.response?.headers?.get?.("retry-after")
    ?? error?.response?.headers?.["retry-after"];
  const headerSeconds = Number(header);
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
    return Math.min(300_000, Math.max(5_000, Math.ceil(headerSeconds * 1000)));
  }
  const match = String(error?.message || "").match(/retry(?:\s+in|\s+after)?\s*([\d.]+)\s*s/i);
  const messageSeconds = Number(match?.[1]);
  if (Number.isFinite(messageSeconds) && messageSeconds > 0) {
    return Math.min(300_000, Math.max(5_000, Math.ceil(messageSeconds * 1000)));
  }
  return fallback;
}

export async function retryGeminiRateLimit(send, { beforeRetry = async () => {},
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), maxRetries = 2 } = {}) {
  for (let retry = 0; ; retry++) {
    try { return await send(); }
    catch (error) {
      if (!isGeminiRateLimitError(error) || retry >= maxRetries ||
          /(?:per day|daily|\brpd\b|RequestsPerDay)/i.test(String(error?.message || ''))) throw error;
      const delay = Math.min(120_000, Math.max(15_000, geminiRetryAfterMs(error) + 2_000) * (retry + 1));
      await sleep(delay);
      await beforeRetry();
    }
  }
}

export function buildVoiceoverAdaptationPrompt(project, sourceBlocks, instructions, template) {
  const source = typeof template === 'string' && template.trim()
    ? template : DEFAULT_AUDIO_ADAPTATION_PROMPT;
  const blocks = sourceBlocks.map(block => ({
    id: block.sourceId, title: block.sourceTitle, text: block.sourceText,
  }));
  const scopedScript = sourceBlocks.length
    ? sourceBlocks.map(block => `${block.sourceTitle}\n${block.sourceText}`).join('\n\n')
    : project.script?.content || '';
  const rendered = source.split('{{PROJECT_TITLE}}').join(project.title || '')
    .split('{{SCRIPT_BLOCKS}}').join(JSON.stringify(blocks))
    .split('{{SCRIPT}}').join(scopedScript)
    .split('{{INSTRUCTIONS}}').join(instructions || 'Нет дополнительных инструкций.');
  if (!blocks.length) return rendered;
  return `${rendered}\n\nВ этом запросе ${blocks.length} блок(ов). Верни JSON с ровно таким количеством результатов и только с этими id: ${blocks.map(block => block.id).join(', ')}. Не используй id из примера, если его нет среди входных блоков.`;
}

export async function generateVoiceoverAdaptation(project, sourceBlocks, instructions, template, profile) {
  try {
    const response = await generateTextResponse(profile, "adapt-voiceover", {
      contents: [{ role: 'user', parts: [{
        text: buildVoiceoverAdaptationPrompt(project, sourceBlocks, instructions, template),
      }] }],
      config: { responseMimeType: 'application/json' },
    });
    return modelText(response);
  } catch (cause) {
    const knownProviderError = ['OPENROUTER_TIMEOUT', 'OPENROUTER_INCOMPLETE_RESPONSE', 'OPENROUTER_RESPONSE_ERROR'];
    const error = new Error(knownProviderError.includes(cause.code)
      ? cause.message : 'Не удалось адаптировать текст для озвучки');
    error.code = cause.code || 'AUDIO_ADAPTATION_FAILED';
    error.status = cause.status;
    throw error;
  }
}

export function buildReferenceAnalysisPrompt(project, currentReferences, instructions, template) {
  const source = typeof template === 'string' && template.trim() ? template : DEFAULT_REFERENCE_ANALYSIS_PROMPT;
  const visibleReferences = (currentReferences || []).map(reference => ({
    id: reference.id, name: reference.name, type: reference.type,
    description: reference.description, reason: reference.reason,
    mentions: reference.mentions, prompt: reference.prompt, selected: reference.selected,
  }));
  return source.split('{{PROJECT_TITLE}}').join(project.title || '')
    .split('{{SCRIPT}}').join(project.script?.content || '')
    .split('{{VOICEOVER}}').join(JSON.stringify((project.voiceover?.blocks || []).map(block => block.adaptedText)))
    .split('{{CURRENT_REFERENCES}}').join(JSON.stringify(visibleReferences))
    .split('{{INSTRUCTIONS}}').join(instructions || 'Нет дополнительных инструкций.');
}

export async function analyzeScriptReferences(project, currentReferences, instructions, template, profile) {
  try {
    const response = await generateTextResponse(profile, "analyze-script-references", {
      contents: [{ role: 'user', parts: [{ text: buildReferenceAnalysisPrompt(project, currentReferences, instructions, template) }] }],
      config: { responseMimeType: 'application/json' },
    });
    return modelText(response);
  } catch {
    const error = new Error('Не удалось проанализировать сценарий');
    error.code = 'REFERENCE_ANALYSIS_FAILED';
    throw error;
  }
}

export function buildReferenceDetailPrompt(project, reference, instruction, template) {
  const source = typeof template === 'string' && template.trim() ? template : DEFAULT_REFERENCE_DETAIL_PROMPT;
  return source.split('{{PROJECT_TITLE}}').join(project.title || '')
    .split('{{SCRIPT}}').join(project.script?.content || '')
    .split('{{REFERENCE}}').join(JSON.stringify({
      name: reference.name, type: reference.type, description: reference.description,
      reason: reference.reason, mentions: reference.mentions,
    }))
    .split('{{CURRENT_PROMPT}}').join(reference.prompt || '')
    .split('{{INSTRUCTION}}').join(instruction || 'Нет дополнительной инструкции.');
}

export async function detailReferencePrompt(project, reference, instruction, template, profile) {
  try {
    const response = await generateTextResponse(profile, "detail-reference-prompt", {
      contents: [{ role: 'user', parts: [{ text: buildReferenceDetailPrompt(project, reference, instruction, template) }] }],
    });
    const text = modelText(response);
    if (text.length > 12000) throw new Error('Prompt too long');
    return text;
  } catch {
    const error = new Error('Не удалось детализировать prompt');
    error.code = 'REFERENCE_DETAIL_FAILED';
    throw error;
  }
}

export function buildStoryboardPrompt(project, references, currentFrames, instructions, template) {
  const source = typeof template === 'string' && template.trim() ? template : DEFAULT_STORYBOARD_PROMPT;
  const visibleReferences = references.map(reference => ({
    id: reference.id, name: reference.name, type: reference.type,
    description: reference.description, prompt: reference.prompt,
  }));
  const visibleFrames = currentFrames.map(frame => ({
    id: frame.id, sourceVoiceoverBlockId: frame.sourceVoiceoverBlockId, scriptText: frame.scriptText,
    visualDescription: frame.visualDescription, prompt: frame.prompt,
    referenceIds: frame.referenceIds,
  }));
  const prompt = source.split('{{PROJECT_TITLE}}').join(project.title || '')
    .split('{{SCRIPT}}').join(project.script?.content || '')
    .split('{{VOICEOVER_BLOCKS}}').join(JSON.stringify((project.voiceover?.blocks || []).map(block => ({
      id: block.id, order: block.order, adaptedText: block.adaptedText,
    }))))
    .split('{{REFERENCES}}').join(JSON.stringify(visibleReferences))
    .split('{{CURRENT_STORYBOARD}}').join(JSON.stringify(visibleFrames))
    .split('{{INSTRUCTIONS}}').join(instructions || 'Нет дополнительных инструкций.');
  if (prompt.length > 196608) {
    const error = new Error('Storyboard input too long');
    error.code = 'STORYBOARD_INPUT_TOO_LONG';
    throw error;
  }
  return prompt;
}

// Each batch needs its own narration and nearby context. Repeating the whole
// script, all voiceover blocks and all previous frame prompts can exhaust TPM
// even when the individual request is below the model's context limit.
export function buildStoryboardBatchPrompt(project, references, currentFrames, instructions, template, plan, batch) {
  const offset = plan.findIndex(frame => frame.slot === batch[0]?.slot);
  if (offset < 0) throw new Error('Unknown storyboard slot');
  const nearby = plan.slice(Math.max(0, offset - 2), Math.min(plan.length, offset + batch.length + 2));
  const blockIds = new Set(nearby.map(frame => frame.sourceVoiceoverBlockId));
  const scopedProject = {
    title: project.title,
    script: { content: nearby.map(frame => frame.scriptText).join(' ') },
    voiceover: { blocks: (project.voiceover?.blocks || []).filter(block => blockIds.has(block.id)).map(block => ({
      id: block.id, order: block.order,
      adaptedText: nearby.filter(frame => frame.sourceVoiceoverBlockId === block.id).map(frame => frame.scriptText).join(' '),
    })) },
  };
  const compactReferences = references.map(reference => ({
    id: reference.id, name: reference.name, type: reference.type,
    description: String(reference.description || '').slice(0, 600),
    prompt: String(reference.prompt || '').slice(0, 400),
  }));
  const nearbyCurrentFrames = currentFrames.length === plan.length
    ? currentFrames.slice(Math.max(0, offset - 2), Math.min(plan.length, offset + batch.length + 2)) : [];
  return buildStoryboardPrompt(scopedProject, compactReferences, nearbyCurrentFrames, instructions, template);
}

export async function generateStoryboard(project, references, currentFrames, instructions, template, profile, options = {}) {
  try {
    const plan = planStoryboardFrames(project.voiceover?.blocks || []);
    const config = profile?.provider === 'openrouter' ? null : resolveTextConfig(profile, 'generate-storyboard');
    const ai = config ? new GoogleGenAI({ apiKey: config.apiKey }) : null;
    const longStoryboard = plan.length > 200;
    return await generatePlannedStoryboard(plan, new Set(references.map(reference => reference.id)), async (batch, attempt) => {
      const batchPrompt = buildStoryboardBatchPrompt(project, references, currentFrames, instructions, template, plan, batch);
      const text = `${batchPrompt}\n\nВыше дан только ближайший контекст этого пакета, а не весь сценарий. Сервер уже разделил утверждённый текст на кадры. Для этого запроса создай только визуальные описания для следующих слотов, ровно по одному на слот. Не объединяй и не добавляй кадры. Верни {"frames":[{"slot":"...","visualDescription":"...","prompt":"...","referenceIds":[]}]}. Поля scriptText и sourceVoiceoverBlockId служат контекстом и не возвращаются. Эта структура ответа заменяет структуру из шаблона выше. Для каждого кадра дай конкретное visualDescription и самостоятельный английский prompt примерно на 60–100 слов, не повторяя общий контекст.\n${JSON.stringify(batch)}${attempt ? '\nПредыдущий ответ не прошёл проверку: проверь все slot, обязательные поля и допустимые referenceIds.' : ''}`;
      if (text.length > 196608) {
        const error = new Error('Storyboard input too long');
        error.code = 'STORYBOARD_INPUT_TOO_LONG';
        throw error;
      }
      if (!ai) return generateOpenRouterText(text, profile, true, 120_000);
      const response = await retryGeminiRateLimit(() => ai.models.generateContent({
        model: config.model, contents: [{ role: 'user', parts: [{ text }] }],
        config: { httpOptions: { timeout: 120_000 }, responseMimeType: 'application/json', responseJsonSchema: {
          type: 'object', required: ['frames'], properties: { frames: {
            type: 'array', minItems: batch.length, maxItems: batch.length,
            items: { type: 'object', required: ['slot', 'visualDescription', 'prompt', 'referenceIds'], properties: {
              slot: { type: 'string', enum: batch.map(frame => frame.slot) },
              visualDescription: { type: 'string' }, prompt: { type: 'string' },
              referenceIds: { type: 'array', items: { type: 'string' } },
            } },
          } },
        } },
      }), { beforeRetry: options.beforeBatch });
      try {
        return modelText(response);
      } catch (error) {
        if (error.message !== 'Missing model text') throw error;
        const empty = new Error('Gemini returned no storyboard text');
        empty.code = response?.promptFeedback?.blockReason
          ? 'STORYBOARD_CONTENT_BLOCKED' : 'STORYBOARD_EMPTY_RESPONSE';
        empty.finishReason = response?.candidates?.[0]?.finishReason || null;
        empty.blockReason = response?.promptFeedback?.blockReason || null;
        throw empty;
      }
    }, { batchSize: longStoryboard ? 6 : 12, maxAttempts: 2,
      splitOnInvalidResponse: longStoryboard, ...options });
  } catch (cause) {
    console.error('[STORYBOARD_PROVIDER_ERROR]', {
      status: cause?.status || cause?.statusCode || cause?.response?.status || null,
      code: cause?.code || null,
      message: String(cause?.message || '').slice(0, 500),
      ...(['STORYBOARD_EMPTY_RESPONSE', 'STORYBOARD_CONTENT_BLOCKED'].includes(cause?.code) ? {
        finishReason: cause.finishReason, blockReason: cause.blockReason,
      } : {}),
    });
    if (['STORYBOARD_INPUT_TOO_LONG', 'STORYBOARD_TOO_MANY_FRAMES', 'INVALID_STORYBOARD_RESPONSE',
      'STORYBOARD_EMPTY_RESPONSE', 'STORYBOARD_CONTENT_BLOCKED',
      'STORYBOARD_JOB_CONFLICT', 'STORYBOARD_LEASE_LOST', 'STORYBOARD_STOP_REQUESTED',
      'INVALID_STORYBOARD_CHECKPOINT'].includes(cause.code)) throw cause;
    if (isGeminiRateLimitError(cause)) {
      const error = new Error('Лимит текстовой модели временно исчерпан. Сохранённые кадры можно продолжить позже.');
      error.code = 'STORYBOARD_RATE_LIMIT';
      throw error;
    }
    const error = new Error('Не удалось создать раскадровку');
    error.code = 'STORYBOARD_GENERATION_FAILED';
    throw error;
  }
}

export function buildStoryboardDetailPrompt(project, frame, references, instruction, template, preserveCurrentPrompt = false) {
  const source = typeof template === 'string' && template.trim()
    ? template : DEFAULT_STORYBOARD_DETAIL_PROMPT;
  const selectedIds = new Set(frame.referenceIds || []);
  const selectedReferences = references.filter(reference => selectedIds.has(reference.id)).map(reference => ({
    id: reference.id, name: reference.name, type: reference.type,
    description: reference.description, prompt: reference.prompt,
  }));
  const currentPrompt = preserveCurrentPrompt && frame.promptDetailStatus !== 'stale' ? frame.prompt || '' : '';
  const prepared = source.split('{{PROJECT_TITLE}}').join(project.title || '')
    .split('{{FRAME}}').join(JSON.stringify({
      id: frame.id, order: frame.order, scriptText: frame.scriptText,
      visualDescription: frame.visualDescription,
    }))
    .split('{{REFERENCES}}').join(JSON.stringify(selectedReferences))
    .split('{{CURRENT_PROMPT}}').join(currentPrompt)
    .split('{{INSTRUCTION}}').join(instruction || 'Нет дополнительной инструкции.');
  return `${prepared}\n\nОБЯЗАТЕЛЬНОЕ ВИЗУАЛЬНОЕ ОПИСАНИЕ КАДРА: ${frame.visualDescription}\nВЫБРАННЫЕ РЕФЕРЕНСЫ ЭТОГО КАДРА: ${JSON.stringify(selectedReferences)}\nОБЯЗАТЕЛЬНЫЙ ПРИОРИТЕТ: финальный prompt должен точно показывать всё, что указано в visualDescription кадра. Выбранные референсы персонажей, предметов и локаций включай в сцену явно, а не только как стиль; описание кадра задаёт их действия и расположение. Не добавляй отрицаний, запретов или деталей из прежнего prompt, если они противоречат visualDescription или выбранным референсам. ${currentPrompt ? 'Прежний prompt служит только второстепенным контекстом.' : 'Прежний prompt намеренно не передан: составь новый с нуля по описанию кадра и выбранным референсам.'}`;
}

export function storyboardDetailFailureCode(cause, response) {
  if (response?.promptFeedback?.blockReason) return 'STORYBOARD_DETAIL_CONTENT_BLOCKED';
  if (isGeminiRateLimitError(cause)) return 'STORYBOARD_DETAIL_RATE_LIMIT';
  const status = providerStatus(cause);
  if (status === 401) return 'STORYBOARD_DETAIL_AUTH_FAILED';
  if (status === 402 || /(?:prepay credits depleted|insufficient.credits|billing account)/i.test(String(cause?.message || ''))) {
    return 'STORYBOARD_DETAIL_BILLING';
  }
  if (cause?.message === 'Missing model text') return 'STORYBOARD_DETAIL_EMPTY_RESPONSE';
  return 'STORYBOARD_DETAIL_FAILED';
}

export async function detailStoryboardFramePrompt(project, frame, references, instruction, template, profile, preserveCurrentPrompt = false) {
  let response;
  try {
    response = await generateTextResponse(profile, "detail-storyboard-frame-prompt", {
      contents: [{ role: 'user', parts: [{
        text: buildStoryboardDetailPrompt(project, frame, references, instruction, template, preserveCurrentPrompt),
      }] }],
    });
    const text = modelText(response);
    if (text.length > 12000) throw new Error('Prompt too long');
    return text;
  } catch (cause) {
    const status = providerStatus(cause);
    const message = String(cause?.message || '');
    console.error('[STORYBOARD_DETAIL_PROVIDER_ERROR]', {
      status: status || null,
      code: cause?.code || null,
      message: message.slice(0, 350),
      finishReason: response?.candidates?.[0]?.finishReason || null,
      blockReason: response?.promptFeedback?.blockReason || null,
    });
    const error = new Error('Не удалось детализировать prompt кадра');
    error.code = storyboardDetailFailureCode(cause, response);
    if (error.code === 'STORYBOARD_DETAIL_RATE_LIMIT') {
      error.retryAfterMs = geminiRetryAfterMs(cause);
    }
    throw error;
  }
}

export function buildVisualBiblePrompt(projectTitle, confirmedScript, visualBiblePrompt) {
  const template = typeof visualBiblePrompt === "string" && visualBiblePrompt.trim()
    ? visualBiblePrompt : DEFAULT_VISUAL_BIBLE_PROMPT;
  return template.split("{{PROJECT_TITLE}}").join(projectTitle)
    .split("{{SCRIPT}}").join(confirmedScript);
}

export async function generateVisualBibleDraft(projectTitle, confirmedScript, visualBiblePrompt, profile) {
  try {
    if (!profile || !profile.textSettings?.primaryModel) throw new Error("Missing text profile");
    const response = await generateTextResponse(profile, "generate-visual-bible", {
      contents: [{ role: "user", parts: [{
        text: buildVisualBiblePrompt(projectTitle, confirmedScript, visualBiblePrompt),
      }] }],
      config: { responseMimeType: "application/json" },
    });
    const text = typeof response.text === "function" ? response.text()
      : response.text ?? response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new Error("Missing model text");
    return text;
  } catch {
    const error = new Error("Не удалось сгенерировать Visual Bible");
    error.status = 502;
    error.code = "VISUAL_BIBLE_GENERATION_FAILED";
    throw error;
  }
}

export function buildVisualBibleEditPrompt(projectTitle, confirmedScript, currentVisualBible, instruction, visualBibleEditPrompt) {
  const template = typeof visualBibleEditPrompt === "string" && visualBibleEditPrompt.trim()
    ? visualBibleEditPrompt : DEFAULT_VISUAL_BIBLE_EDIT_PROMPT;
  return template.split("{{PROJECT_TITLE}}").join(projectTitle)
    .split("{{SCRIPT}}").join(confirmedScript)
    .split("{{CURRENT_VISUAL_BIBLE}}").join(JSON.stringify(currentVisualBible))
    .split("{{INSTRUCTION}}").join(instruction);
}

export async function editVisualBible(projectTitle, confirmedScript, currentVisualBible, instruction, visualBibleEditPrompt, profile) {
  try {
    if (!profile || !profile.textSettings?.primaryModel) throw new Error("Missing text profile");
    const response = await generateTextResponse(profile, "edit-visual-bible", {
      contents: [{ role: "user", parts: [{
        text: buildVisualBibleEditPrompt(projectTitle, confirmedScript, currentVisualBible, instruction, visualBibleEditPrompt),
      }] }],
      config: { responseMimeType: "application/json" },
    });
    const text = typeof response.text === "function" ? response.text()
      : response.text ?? response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new Error("Missing model text");
    return text;
  } catch {
    const error = new Error("Не удалось отредактировать Visual Bible");
    error.status = 502;
    error.code = "VISUAL_BIBLE_EDIT_FAILED";
    throw error;
  }
}


/**
 * Возвращает конфигурацию генерации на основе профиля (если он передан).
 * Если профиль отсутствует — падаем на .env + дефолтную модель.
 *
 * @param {Object|null} profile - Текстовый профиль из настроек
 * @param {string} operation - Название операции для логов
 */
function resolveTextConfig(profile, operation) {
  // Do not log the profile object: it contains the encrypted API key.
  // Ключ в профиле хранится в зашифрованном виде — расшифровываем его
  // только здесь, непосредственно перед вызовом Gemini API.
  const profileKey = getDecryptedApiKey(profile);
  
  const apiKey = profileKey || process.env.GEMINI_API_KEY;
  const model = profile?.textSettings?.primaryModel;

  // console.log(`🔑 [${operation}] Используем ключ из: ${profileKey ? "профиля" : ".env"}`);
  // console.log(`🧠 [${operation}] Используем модель: ${model || "дефолтная"}`);

  if (!apiKey) {
    throw new Error(
      "API-ключ не найден: ни в профиле, ни в .env (GEMINI_API_KEY)",
    );
  }

  console.log(
    `🤖 [${operation}] Генерация через model="${model}" ` +
      `(источник ключа: ${profileKey ? "профиль" : ".env"})`,
  );

  return { apiKey, model };
}

export async function generateVideoTopic(
  systemPrompt,
  keywords = "",
  profile = null,
) {
  try {
    // Формируем детальный промпт с учетом ключевых слов, если они есть
    let userPrompt = `${systemPrompt}\n\n`;
    if (keywords.trim()) {
      userPrompt += `Обязательно используй следующие ключевые слова или контекст при генерации: "${keywords}".\n\n`;
    }
    userPrompt += `Генерируй 3 НОВЫХ и ОРИГИНАЛЬНЫХ идеи для YouTube. Делай идеи конкретными, интересными и актуальными. Ответ выдай СТРОГО в формате JSON массива с 3 объектами. Каждый объект должен иметь ключи: 
- "full_topic" (полное кликбейтное название темы)
- "full_description" (Суть. Как мы планируем зацыпить и удержать зрителя?)
- "short_title" (КРАТКОЕ название темы на УКРАИНСКОМ языке, МАКСИМУМ 3 слова, без кавычек, для использования в названии папки и проекта)

Пример формата:
[
  {
    "full_topic": "Название темы 1",
    "full_description": "Описание 1",
    "short_title": "Коротка назва"
  },
  {
    "full_topic": "Название темы 2",
    "full_description": "Описание 2",
    "short_title": "Коротка назва"
  },
  {
    "full_topic": "Название темы 3",
    "full_description": "Описание 3",
    "short_title": "Коротка назва"
  }
]

Никакого лишнего текста, только JSON массив.`;

    const response = await generateTextResponse(profile, "generate-topic", {
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
    });

    // Надежное извлечение текста с учетом разных версий SDK `@google/genai`
    let generatedText = "";
    if (typeof response.text === "function") {
      generatedText = response.text();
    } else if (typeof response.text === "string") {
      generatedText = response.text;
    } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      generatedText = response.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Не удалось получить текстовый ответ от Gemini API");
    }

    // Пытаемся распарсить JSON и вернуть массив объектов
    let parsed;
    try {
      // Очищаем текст от возможных markdown-оберток
      const cleanedText = generatedText
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      parsed = JSON.parse(cleanedText);

      // Проверяем, что это массив
      if (!Array.isArray(parsed)) {
        throw new Error("Ответ не является массивом");
      }

      // Валидация: проверяем, что каждый элемент имеет нужные поля
      for (const item of parsed) {
        if (!item.full_topic || !item.full_description || !item.short_title) {
          throw new Error("Отсутствуют необходимые поля в одном из элементов");
        }
      }
    } catch (parseError) {
      console.error("❌ Ошибка парсинга JSON от Gemini:", generatedText);
      throw new Error(
        "Не удалось распарсить ответ от Gemini API как JSON массив",
      );
    }

    return parsed;
  } catch (error) {
    console.error("❌ Ошибка AI API:", error);
    throw error;
  }
}

export async function generateScript(systemPrompt, projectDescription, profile) {
  try {
    const userPrompt = `${systemPrompt}\n\n
Описание проекта: "${projectDescription}"

Никакого лишнего текста.`;
    // console.log("🚀 Отправка запроса на генерацию сценария с промптом:", userPrompt);
    const response = await generateTextResponse(profile, "generate-script", {
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
    });

    let generatedText = "";
    if (typeof response.text === "function") {
      generatedText = response.text();
    } else if (typeof response.text === "string") {
      generatedText = response.text;
    } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
      generatedText = response.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Не удалось получить текстовый ответ от Gemini API");
    }

    let parsed;
    try {
      const cleanedText = generatedText
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      parsed = cleanedText;

      // Валидация: проверяем необходимые поля
      // if (
      //   !parsed.script ||
      //   !parsed.scene_breakdown ||
      //   !parsed.estimated_duration
      // ) {
      //   throw new Error("Отсутствуют необходимые поля в ответе");
      // }
    } catch (parseError) {
      console.error("❌ Ошибка парсинга JSON от Gemini:", generatedText);
      throw new Error(
        "Не удалось распарсить ответ от Gemini API как JSON объект",
      );
    }

    return parsed;
  } catch (error) {
    console.error("❌ Ошибка AI API при генерации сценария:", error);
    throw error;
  }
}


export async function editScript(currentScript, instruction, profile) {
  const response = await generateTextResponse(profile, "edit-script", {
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ currentScript, instruction }) }] }],
    config: {
      systemInstruction: "Отредактируй сценарий согласно инструкции пользователя. Верни полный обновлённый сценарий, а не список изменений. Сохрани язык исходного сценария. Не добавляй Markdown-обёртки, пояснения и комментарии о редактировании.",
    },
  });
  const text = typeof response.text === "function" ? response.text()
    : response.text ?? response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("Empty edited script");
  const cleaned = text.trim().replace(/^```[^\n]*\n([\s\S]*?)\n```$/, "$1").trim();
  if (!cleaned || cleaned.length > 20000) throw new Error("Invalid edited script length");
  return cleaned;
}

// Single bounded request; the client owns pacing and resumable orchestration.
export async function generateVideoPlanText(prompt, profile, json = false, systemInstruction = '') {
  const result = await generateTextResponse(profile, "video-plan", { contents: prompt,
    config: { ...(json ? { responseMimeType: 'application/json' } : {}),
      ...(systemInstruction ? { systemInstruction } : {}),
      httpOptions: { timeout: 90000 }, maxOutputTokens: 12000 } });
  return modelText(result);
}
