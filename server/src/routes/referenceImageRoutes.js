import express from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { ensureAuthenticated } from '../middleware/auth.js';
import Project from '../models/Project.js';
import Settings from '../models/Settings.js';
import VisualReference from '../models/VisualReference.js';
import { resolveRequestedProfile, logProfileUsage } from '../services/aiProfileResolver.js';
import { generateGoogleStoryboardImage } from '../services/googleImageService.js';
import { normalizeReferencePlan } from '../services/referencePlanService.js';
import { MAX_VISUAL_REFERENCE_BYTES } from '../services/visualReferenceStorage.js';
import { referenceFingerprint, requireReferenceItem, saveReferenceImage, referenceImageError } from '../services/referenceImageService.js';
import { referenceFlowBase } from '../../../shared/referenceFlow.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VISUAL_REFERENCE_BYTES, files: 1, fields: 1, parts: 2 } }).single('image');
async function ownedProject(req, res, next) {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ error: 'Проект не найден' });
    req.referenceProject = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!req.referenceProject) return res.status(404).json({ error: 'Проект не найден' });
    next();
  } catch (error) { fail(res, error); }
}
function fail(res, error) {
  const status = error.status || (['INVALID_IMAGE_PROFILE', 'IMAGE_API_KEY_MISSING', 'INVALID_AI_PROFILE', 'INVALID_IMAGE_FILE'].includes(error.code) ? 400 : error.code === 'IMAGE_PROVIDER_RATE_LIMIT' ? 429 : 502);
  res.status(status).json({ error: error.publicMessage || 'Не удалось обработать изображение референса. Попробуйте снова.', code: error.code });
}
const previousImage = (project, userId, id) => VisualReference.findOne({ projectId: project._id, userId, referenceId: id }).select('+storageKey');

router.post('/:id/reference-plan/images/:referenceId/generate', ensureAuthenticated, ownedProject, async (req, res) => {
  try {
    const project = req.referenceProject;
    const { sourceReferenceVersion, prompt, profileId } = req.body || {};
    const item = requireReferenceItem(project, req.params.referenceId, sourceReferenceVersion, prompt);
    const settings = await Settings.findOne({ userId: req.user._id });
    const compatible = (settings?.profiles || []).filter(p => p.type === 'image' && p.provider === 'google_studio');
    const profile = profileId ? resolveRequestedProfile(settings, 'image', profileId) : compatible.find(p => p.isDefault) || compatible[0];
    if (!profile || profile.provider !== 'google_studio') throw referenceImageError(400, 'Добавьте или выберите профиль изображения Google Studio в настройках.');
    const previous = await previousImage(project, req.user._id, item.id);
    logProfileUsage('generate-reference-image', profile, 'image');
    const { buffer } = await generateGoogleStoryboardImage({ frame: item, profile, purpose: 'reference' });
    await saveReferenceImage({ project, userId: req.user._id, item, previous, buffer });
    res.json({ success: true });
  } catch (error) { fail(res, error); }
});

router.get('/:id/reference-plan/flow/export', ensureAuthenticated, ownedProject, async (req, res) => {
  try {
    const project = req.referenceProject;
    const plan = normalizeReferencePlan(project);
    if (plan.status !== 'confirmed' || project.script?.status !== 'confirmed' || plan.sourceScriptRevision !== project.script?.revision) throw referenceImageError(409, 'Сохраните и утвердите актуальный набор референсов.');
    const assets = await VisualReference.find({ projectId: project._id, userId: req.user._id });
    const selected = plan.items.filter(item => item.selected);
    if (selected.some(item => !item.prompt?.trim())) throw referenceImageError(400, 'Сначала подготовьте промпты для всех выбранных референсов.');
    const items = selected.filter(item => req.query.all === '1' || !assets.some(asset => asset.referenceId === item.id && asset.status === 'ready' && asset.sourceReferenceVersion === item.version && asset.prompt === item.prompt));
    if (!items.length) throw referenceImageError(400, 'Все выбранные референсы уже имеют изображения. Включите замену готовых.');
    if (items.length > 100) throw referenceImageError(400, 'В одном пакете допускается до 100 референсов.');
    const zip = new JSZip();
    const references = items.map(item => {
      const inputFingerprint = referenceFingerprint(project, item);
      const base = referenceFlowBase(item.id, inputFingerprint);
      zip.file(`prompts/${base}.txt`, item.prompt);
      return { referenceId: item.id, name: item.name, type: item.type, sourceReferenceVersion: item.version, inputFingerprint, prompt: item.prompt, outputFile: `${base}.png` };
    });
    zip.file('manifest.json', JSON.stringify({ schemaVersion: 1, kind: 'reference-images', projectId: String(project._id), references }, null, 2));
    zip.file('prompts.txt', references.map(item => `${item.name}\nФайл результата: ${item.outputFile}\n${item.prompt}`).join('\n\n---\n\n'));
    zip.file('README.txt', 'Пакет референсов Google Flow\n\n1. Откройте Flow и создайте изображения по prompts.txt или отдельным файлам prompts/.\n2. Назовите каждый результат точно как outputFile в manifest.json (допустимы расширения PNG, JPG, JPEG, WebP). Не меняйте идентификатор и отпечаток в имени.\n3. Соберите результаты в ZIP и нажмите «Импортировать ZIP» на странице референсов. Допускается частичный архив.\n4. Изображения распределяются по карточкам автоматически; старые версии промптов не принимаются.\n\nЭто пакет для ручной работы в Flow, он не запускает генерацию автоматически. Максимум 15 МиБ на изображение.');
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const current = await Project.findOne({ _id: project._id, userId: req.user._id });
    if (!current) throw referenceImageError(404, 'Проект не найден');
    for (const item of references) requireReferenceItem(current, item.referenceId, null, null, item.inputFingerprint);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename="flow-references.zip"');
    res.send(buffer);
  } catch (error) { fail(res, error); }
});

router.post('/:id/reference-plan/images/:referenceId/import', ensureAuthenticated, ownedProject, (req, res, next) => {
  upload(req, res, error => error ? res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Нужен файл изображения до 15 МБ.' }) : next());
}, async (req, res) => {
  try {
    const fingerprint = req.body?.inputFingerprint;
    if (!req.file || typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) throw referenceImageError(400, 'Некорректное изображение из пакета Flow.');
    const project = req.referenceProject;
    const item = requireReferenceItem(project, req.params.referenceId, null, null, fingerprint);
    const previous = await previousImage(project, req.user._id, item.id);
    await saveReferenceImage({ project, userId: req.user._id, item, previous, buffer: req.file.buffer });
    res.json({ success: true });
  } catch (error) { fail(res, error); }
});

export default router;
