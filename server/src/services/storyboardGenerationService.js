import { randomUUID } from 'node:crypto';
import StoryboardGeneration from '../models/StoryboardGeneration.js';
import Project from '../models/Project.js';
import Settings, { DEFAULT_STORYBOARD_PROMPT } from '../models/Settings.js';
import { resolveRequestedProfile } from './aiProfileResolver.js';
import { buildStoryboardPrompt, generateStoryboard } from './geminiService.js';
import { normalizeStoryboard, parseGeneratedStoryboard, planStoryboardFrames } from './storyboardService.js';

const LEASE_MS = 60_000;
const activeStatuses = ['queued', 'running'];
const jobError = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const publicFields = 'runId status total completed profileId errorCode createdAt updatedAt';

export function generationSummary(job) {
  if (!job) return null;
  return Object.fromEntries(publicFields.split(' ').map(key => [key, job[key]]));
}

export function generationSourceFilter(job) {
  const { expectedEditVersion, sourceScriptRevision, sourceReferencePlanRevision, sourceVoiceoverRevision } = job.input;
  return {
    _id: job.projectId, userId: job.userId,
    'script.status': 'confirmed', 'script.revision': sourceScriptRevision,
    'voiceover.status': 'confirmed', 'voiceover.revision': sourceVoiceoverRevision,
    'referencePlan.status': 'confirmed', 'referencePlan.revision': sourceReferencePlanRevision,
    ...(expectedEditVersion === 0
      ? { $or: [{ 'storyboard.editVersion': 0 }, { 'storyboard.editVersion': { $exists: false } }] }
      : { 'storyboard.editVersion': expectedEditVersion }),
  };
}

export function createStoryboardGenerationService({ Jobs = StoryboardGeneration, Projects = Project,
  UserSettings = Settings, generate = generateStoryboard } = {}) {
  async function summary(projectId, userId) {
    return generationSummary(await Jobs.findOne({ projectId, userId }).select(publicFields));
  }

  async function enqueue(project, userId, body, currentFrames, settings) {
    const owner = { projectId: project._id, userId };
    const previous = await Jobs.findOne(owner).select(publicFields);
    // Double clicks and retries of the start request reuse the active job.
    if (previous && activeStatuses.includes(previous.status)) return generationSummary(previous);
    if (previous?.status === 'failed' && !body.restartGeneration) {
      throw jobError('STORYBOARD_JOB_FAILED', 'Есть незавершённая генерация. Продолжите её или начните заново.');
    }
    const profile = resolveRequestedProfile(settings, 'text', body.profileId);
    const references = (project.referencePlan?.items || []).filter(item => item.selected)
      .map(item => ({ id: item.id, name: item.name, type: item.type, description: item.description, prompt: item.prompt }));
    const snapshot = {
      title: project.title,
      script: { content: project.script.content },
      voiceover: { blocks: project.voiceover.blocks.map(block => ({ id: block.id, order: block.order, adaptedText: block.adaptedText })) },
    };
    const template = settings?.prompts?.storyboardPrompt || DEFAULT_STORYBOARD_PROMPT;
    const total = planStoryboardFrames(snapshot.voiceover.blocks).length;
    buildStoryboardPrompt(snapshot, references, currentFrames, body.instructions.trim(), template);
    const next = { ...owner, runId: randomUUID(), status: 'queued', total, completed: 0,
      profileId: String(profile?._id || profile?.id || ''), frames: [], errorCode: '', leaseToken: '', leaseUntil: null,
      input: { project: snapshot, references, currentFrames, template, instructions: body.instructions.trim(),
        revision: normalizeStoryboard(project).revision || 0,
        expectedEditVersion: body.expectedEditVersion,
        sourceScriptRevision: body.sourceScriptRevision,
        sourceReferencePlanRevision: body.sourceReferencePlanRevision,
        sourceVoiceoverRevision: body.sourceVoiceoverRevision } };
    try {
      const job = await Jobs.findOneAndUpdate({ ...owner, status: { $nin: activeStatuses },
        ...(previous ? { runId: previous.runId } : {}) }, { $set: next },
      { upsert: !previous, returnDocument: 'after', runValidators: true });
      if (job) return generationSummary(job);
    } catch (error) { if (error.code !== 11000) throw error; }
    const concurrent = await summary(project._id, userId);
    if (concurrent) return concurrent;
    throw jobError('STORYBOARD_JOB_CONFLICT', 'Генерация изменилась. Обновите страницу.');
  }

  async function resume(projectId, userId, runId, profileId) {
    const job = await Jobs.findOne({ projectId, userId, runId }).select('+input');
    if (!job) throw jobError('STORYBOARD_JOB_MISSING', 'Генерация не найдена.', 404);
    if (activeStatuses.includes(job.status) || job.status === 'completed') return generationSummary(job);
    if (await Projects.exists({ _id: projectId, userId, storyboardGenerationRunId: runId })) {
      return generationSummary(await Jobs.findOneAndUpdate({ projectId, userId, runId, status: 'failed' }, {
        $set: { status: 'completed', completed: job.total, errorCode: '' }, $unset: { input: 1, frames: 1 },
      }, { returnDocument: 'after' }));
    }
    if (!await Projects.exists(generationSourceFilter(job))) {
      throw jobError('STORYBOARD_JOB_CONFLICT', 'Исходные данные изменились. Создайте раскадровку заново.');
    }
    const settings = await UserSettings.findOne({ userId });
    const profile = resolveRequestedProfile(settings, 'text', profileId === undefined ? job.profileId : profileId);
    const saved = await Jobs.findOneAndUpdate({ projectId, userId, runId, status: 'failed' }, { $set: {
      status: 'queued', errorCode: '', leaseToken: '', leaseUntil: null,
      profileId: String(profile?._id || profile?.id || ''),
    } }, { returnDocument: 'after' });
    return generationSummary(saved) || summary(projectId, userId);
  }

  async function processNext() {
    const leaseToken = randomUUID();
    const job = await Jobs.findOneAndUpdate({ $or: [
      { status: 'queued' }, { status: 'running', leaseUntil: { $lte: new Date() } },
    ] }, { $set: { status: 'running', leaseToken, leaseUntil: new Date(Date.now() + LEASE_MS) } },
    { returnDocument: 'after', sort: { updatedAt: 1 } }).select('+input +frames');
    if (!job) return false;
    const lock = { _id: job._id, runId: job.runId, status: 'running', leaseToken };
    let lostLease = false;
    let renewing = false;
    const renew = async () => {
      if (renewing) return;
      renewing = true;
      try {
        const result = await Jobs.updateOne({ ...lock, leaseUntil: { $gt: new Date() } },
          { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } });
        if (!result.matchedCount) lostLease = true;
      } catch { lostLease = true; }
      finally { renewing = false; }
    };
    const heartbeat = setInterval(renew, 10_000);
    heartbeat.unref?.();
    const assertCurrent = async () => {
      if (lostLease || !await Jobs.exists({ ...lock, leaseUntil: { $gt: new Date() } })) {
        throw jobError('STORYBOARD_LEASE_LOST', 'Задача передана другому обработчику.');
      }
      if (!await Projects.exists(generationSourceFilter(job))) {
        throw jobError('STORYBOARD_JOB_CONFLICT', 'Исходные данные изменились.');
      }
    };
    try {
      // A crash after the project commit but before job completion needs no new AI call.
      const alreadySaved = await Projects.exists({ _id: job.projectId, userId: job.userId, storyboardGenerationRunId: job.runId });
      if (!alreadySaved) {
        await assertCurrent();
        const settings = await UserSettings.findOne({ userId: job.userId });
        const profile = resolveRequestedProfile(settings, 'text', job.profileId);
        const input = job.input;
        const raw = await generate(input.project, input.references, input.currentFrames, input.instructions, input.template, profile, {
          completedFrames: job.frames,
          beforeBatch: assertCurrent,
          onBatch: async frames => {
            await assertCurrent();
            const result = await Jobs.updateOne({ ...lock, leaseUntil: { $gt: new Date() } },
              { $set: { frames, completed: frames.length } });
            if (!result.matchedCount) throw jobError('STORYBOARD_LEASE_LOST', 'Задача передана другому обработчику.');
          },
        });
        const frames = parseGeneratedStoryboard(raw, input.currentFrames, new Set(input.references.map(item => item.id)), input.project.voiceover.blocks);
        await assertCurrent();
        const now = new Date();
        const saved = await Projects.findOneAndUpdate(generationSourceFilter(job), { $set: {
          storyboard: { status: 'draft', revision: input.revision, editVersion: input.expectedEditVersion + 1,
            sourceScriptRevision: input.sourceScriptRevision, sourceReferencePlanRevision: input.sourceReferencePlanRevision,
            sourceVoiceoverRevision: input.sourceVoiceoverRevision, instructions: input.instructions, frames,
            updatedAt: now, confirmedAt: null },
          storyboardGenerationRunId: job.runId, updatedAt: now,
        } }, { returnDocument: 'after', runValidators: true });
        if (!saved) throw jobError('STORYBOARD_JOB_CONFLICT', 'Исходные данные изменились.');
      }
      await Jobs.updateOne(lock, { $set: { status: 'completed', completed: job.total, errorCode: '', leaseUntil: null }, $unset: { frames: 1, input: 1 } });
    } catch (error) {
      if (error.code !== 'STORYBOARD_LEASE_LOST' && !lostLease) {
        const safeCodes = ['STORYBOARD_JOB_CONFLICT', 'INVALID_AI_PROFILE', 'INVALID_STORYBOARD_RESPONSE', 'STORYBOARD_INPUT_TOO_LONG'];
        await Jobs.updateOne(lock, { $set: { status: 'failed', leaseUntil: null,
          errorCode: safeCodes.includes(error.code) ? error.code : 'STORYBOARD_GENERATION_FAILED' } });
        console.warn('[STORYBOARD_JOB_FAILED]', { runId: job.runId, code: error.code || 'STORYBOARD_GENERATION_FAILED' });
      }
    } finally { clearInterval(heartbeat); }
    return true;
  }
  return { summary, enqueue, resume, processNext };
}

export const storyboardGeneration = createStoryboardGenerationService();

export async function startStoryboardGenerationWorker() {
  await StoryboardGeneration.init();
  let working = false;
  const tick = async () => {
    if (working) return;
    working = true;
    try { await storyboardGeneration.processNext(); }
    catch { console.warn('[STORYBOARD_WORKER] Не удалось обработать задачу. Повтор после восстановления соединения.'); }
    finally { working = false; }
  };
  const timer = setInterval(tick, 2_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
