import { createHash } from 'node:crypto';
import Project from '../models/Project.js';
import VisualReference from '../models/VisualReference.js';
import { normalizeReferencePlan } from './referencePlanService.js';
import { saveVisualReferenceFile, deleteVisualReferenceFile } from './visualReferenceStorage.js';

export function referenceImageError(status, message) {
  return Object.assign(new Error(message), { status, publicMessage: message });
}

export function referenceFingerprint(project, item) {
  return createHash('sha256').update(JSON.stringify([
    String(project._id), project.referencePlan.sourceScriptRevision,
    item.id, item.version, item.name, item.type, item.description, item.prompt,
  ])).digest('hex');
}

export function requireReferenceItem(project, id, version, prompt, fingerprint) {
  const plan = normalizeReferencePlan(project);
  const item = plan.items.find(value => value.id === id);
  if (plan.status !== 'confirmed' || project.script?.status !== 'confirmed' || plan.sourceScriptRevision !== project.script?.revision ||
      !item?.selected || !item.prompt?.trim() ||
      (fingerprint ? referenceFingerprint(project, item) !== fingerprint :
        item.version !== version || item.prompt !== prompt)) {
    throw referenceImageError(409, 'Референс изменился. Сохраните и утвердите набор, затем повторите операцию с актуальным пакетом.');
  }
  return item;
}

// Each replacement uses a new file; a failed/stale request cannot destroy the previous image.
export async function saveReferenceImage({ project, userId, item, previous, buffer }) {
  const stored = await saveVisualReferenceFile({
    project, projectId: String(project._id), projectPath: project.projectPath, userId, referenceId: item.id, buffer,
  });
  let committed = false;
  try {
    const current = await Project.findOne({ _id: project._id, userId });
    if (!current) throw referenceImageError(404, 'Проект не найден');
    requireReferenceItem(current, item.id, null, null, referenceFingerprint(project, item));
    const fields = {
      projectId: project._id, userId, referenceId: item.id,
      entityCollection: 'references', entityId: item.id,
      sourceReferenceVersion: item.version, prompt: item.prompt, status: 'ready', errorCode: '',
      storageKey: stored.storageKey, mimeType: stored.mimeType, byteSize: stored.byteSize,
    };
    if (previous) {
      const updated = await VisualReference.findOneAndUpdate({
        _id: previous._id, userId, storageKey: previous.storageKey, updatedAt: previous.updatedAt,
      }, { $set: fields }, { returnDocument: 'after', runValidators: true });
      if (!updated) throw referenceImageError(409, 'Изображение уже изменилось в другом запросе. Обновите страницу.');
    } else {
      await VisualReference.create(fields);
    }
    committed = true;
    if (previous?.storageKey && previous.storageKey !== stored.storageKey) {
      await deleteVisualReferenceFile(previous.storageKey, project.projectPath, userId)
        .catch(() => console.error('REFERENCE_IMAGE_OLD_FILE_DELETE_FAILED'));
    }
  } catch (error) {
    if (!committed) await deleteVisualReferenceFile(stored.storageKey, project.projectPath, userId).catch(() => {});
    if (error.code === 11000) throw referenceImageError(409, 'Изображение уже создано другим запросом. Обновите страницу.');
    throw error;
  }
}
