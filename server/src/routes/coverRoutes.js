import express from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { ensureAuthenticated } from '../middleware/auth.js';
import Project from '../models/Project.js';
import Settings from '../models/Settings.js';
import CoverStyle from '../models/CoverStyle.js';
import { saveCoverToProject, readProjectCover } from '../services/coverStorage.js';
import { analyzeCoverStyle, validateCoverTemplate, coverTemplateSvg } from '../services/coverStyleService.js';
import { resolveRequestedProfile, logProfileUsage } from '../services/aiProfileResolver.js';
import { generateGoogleStoryboardImage } from '../services/googleImageService.js';
import { generateVideoPlanText } from '../services/geminiService.js';
import { buildCoverPrompt, buildCoverHeadlinesPrompt, coverFields, coverError, validateCoverImage, MAX_COVER_BYTES } from '../services/coverService.js';

const router = express.Router();
function fail(res, error) {
  const code = error.code;
  const providerStatus = Number(error.status || error.statusCode || error.response?.status);
  const limited = code === 'IMAGE_PROVIDER_RATE_LIMIT' || providerStatus === 429;
  const status = limited ? 429 : error.publicMessage ? error.status || 502 : code === 'INVALID_AI_PROFILE' ? 400 : 502;
  console.error('COVER_REQUEST_FAILED', { code: code || 'COVER_FAILED', status });
  res.status(status).json({ error: limited ? 'Google или текстовый провайдер ограничил запросы (429). Проверьте квоту выбранного профиля или попробуйте позже.' : error.publicMessage || (code === 'INVALID_AI_PROFILE' ? 'Выберите доступный профиль генерации.' : 'Не удалось подготовить обложку. Попробуйте снова.'), code });
}
async function owned(req, res, next) {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) throw coverError(404, 'Проект не найден');
    req.coverProject = await Project.findOne({ _id: req.params.id, userId: req.user._id });
    if (!req.coverProject) throw coverError(404, 'Проект не найден');
    next();
  } catch (error) { fail(res, error); }
}
function upload(field, limit) {
  const parse = multer({ storage: multer.memoryStorage(), limits: { files: 1, fields: 0, parts: 1, fileSize: limit } }).single(field);
  return (req, res, next) => parse(req, res, error => error
    ? res.status(400).json({ error: `Выберите один файл размером до ${Math.round(limit / 1024 / 1024)} МБ.` }) : next());
}
const auth = [ensureAuthenticated, owned];
router.post('/:id/cover/save', ...auth, upload('image', MAX_COVER_BYTES), async (req, res) => {
  try {
    const cover = await saveCoverToProject({ project: req.coverProject, userId: req.user._id, buffer: req.file?.buffer });
    res.json({ success: true, cover });
  } catch (error) { fail(res, error); }
});
router.get('/:id/cover/image', ...auth, async (req, res) => {
  try {
    const image = await readProjectCover(req.coverProject, req.user._id);
    res.set('Cache-Control', 'private, no-store').type(req.coverProject.coverImage.mimeType).send(image);
  } catch (error) { fail(res, error); }
});
const styleMeta = style => style ? { revision: style.revision, analysis: style.analysis || null, confirmed: style.confirmed || null } : null;

router.get('/:id/cover/style', ...auth, async (req, res) => {
  try { res.json({ success: true, style: styleMeta(await CoverStyle.findOne({ userId: req.user._id })) }); }
  catch (error) { fail(res, error); }
});
router.get('/:id/cover/style/image', ...auth, async (req, res) => {
  try {
    const style = await CoverStyle.findOne({ userId: req.user._id }).select('+image');
    if (!style) throw coverError(404, 'Сначала загрузите пример обложки.');
    res.set('Cache-Control', 'private, no-store').type(style.mimeType).send(style.image);
  } catch (error) { fail(res, error); }
});
router.put('/:id/cover/style', ...auth, upload('image', MAX_COVER_BYTES), async (req, res) => {
  try {
    const { buffer, mimeType } = await validateCoverImage(req.file?.buffer, true);
    const style = await CoverStyle.findOneAndUpdate({ userId: req.user._id }, { $set: { image: buffer, mimeType, revision: randomUUID(), analysis: null } }, { upsert: true, returnDocument: 'after', runValidators: true });
    res.json({ success: true, style: styleMeta(style) });
  } catch (error) { fail(res, error); }
});

router.post('/:id/cover/style/analyze', ...auth, async (req, res) => {
  try {
    const { revision, instruction = '', profileId } = req.body || {};
    if (typeof instruction !== 'string' || instruction.length > 4000) throw coverError(400, 'Инструкция — до 4000 символов.');
    const style = await CoverStyle.findOne({ userId: req.user._id }).select('+image');
    if (!style) throw coverError(400, 'Загрузите пример обложки.');
    if (style.revision !== revision) throw coverError(409, 'Пример или его анализ изменился. Обновите страницу.');
    const settings = await Settings.findOne({ userId: req.user._id });
    const compatible = (settings?.profiles || []).filter(p => p.type === 'text' && p.provider === 'google_studio');
    const profile = profileId ? resolveRequestedProfile(settings, 'text', profileId) : compatible.find(p => p.isDefault) || compatible[0];
    logProfileUsage('analyze-cover-style', profile, 'text');
    const analysis = await analyzeCoverStyle({ profile, image: { buffer: style.image, mimeType: style.mimeType }, analysis: style.analysis, instruction: instruction.trim() });
    const updated = await CoverStyle.findOneAndUpdate({ userId: req.user._id, revision }, { $set: { analysis, revision: randomUUID() } }, { returnDocument: 'after', runValidators: true });
    if (!updated) throw coverError(409, 'Образец изменился во время анализа. Повторите действие.');
    res.json({ success: true, style: styleMeta(updated) });
  } catch (error) { fail(res, error); }
});
router.post('/:id/cover/style/confirm', ...auth, async (req, res) => {
  try {
    const style = await CoverStyle.findOne({ userId: req.user._id });
    if (!style?.analysis) throw coverError(400, 'Сначала проанализируйте пример.');
    if (style.revision !== req.body?.revision) throw coverError(409, 'Анализ изменился. Обновите страницу.');
    const template = validateCoverTemplate(style.analysis.template);
    const confirmed = { template, revision: style.revision, confirmedAt: new Date().toISOString() };
    const updated = await CoverStyle.findOneAndUpdate({ userId: req.user._id, revision: style.revision }, { $set: { confirmed } }, { returnDocument: 'after', runValidators: true });
    if (!updated) throw coverError(409, 'Анализ изменился. Повторите подтверждение.');
    res.json({ success: true, style: styleMeta(updated) });
  } catch (error) { fail(res, error); }
});
router.get('/:id/cover/style/template', ...auth, async (req, res) => {
  try {
    const style = await CoverStyle.findOne({ userId: req.user._id });
    const template = req.query.draft === '1' ? style?.analysis?.template : style?.confirmed?.template;
    if (!template) throw coverError(404, 'Шаблон ещё не подготовлен.');
    const image = await sharp(Buffer.from(coverTemplateSvg(template))).png().toBuffer();
    res.set('Cache-Control', 'private, no-store').type('image/png').send(image);
  } catch (error) { fail(res, error); }
});

router.post('/:id/cover/headlines', ...auth, async (req, res) => {
  try {
    const fields = coverFields(req.body, false);
    const settings = await Settings.findOne({ userId: req.user._id });
    const profile = resolveRequestedProfile(settings, 'text', req.body?.profileId);
    logProfileUsage('cover-headlines', profile, 'text');
    const answer = await generateVideoPlanText(buildCoverHeadlinesPrompt({ systemPrompt: settings?.prompts?.cover, project: req.coverProject, ...fields }), profile, true);
    let result;
    try {
      const parsed = JSON.parse(answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
      if (typeof parsed.title !== 'string' || typeof parsed.subtitle !== 'string') throw new Error('Invalid headlines');
      result = coverFields({ title: parsed.title, subtitle: parsed.subtitle });
    } catch { throw coverError(502, 'Модель не вернула корректные заголовок и подзаголовок. Попробуйте ещё раз.'); }
    res.json({ success: true, title: result.title, subtitle: result.subtitle });
  } catch (error) { fail(res, error); }
});

async function generationInputs(req) {
  const fields = coverFields(req.body);
  const style = await CoverStyle.findOne({ userId: req.user._id });
  if (!style?.confirmed) throw coverError(400, 'Сначала проанализируйте пример и примените шаблон.');
  if (req.body.styleRevision !== style.confirmed.revision) throw coverError(409, 'Утверждённый шаблон изменился. Обновите страницу перед генерацией.');
  const template = validateCoverTemplate(style.confirmed.template);
  const settings = await Settings.findOne({ userId: req.user._id });
  const prompt = buildCoverPrompt({ systemPrompt: settings?.prompts?.cover, project: req.coverProject, ...fields, template });
  const layoutImage = await sharp(Buffer.from(coverTemplateSvg(template, fields.title, fields.subtitle))).png().toBuffer();
  return { style, settings, prompt, fields, template, layoutImage };
}
router.post('/:id/cover/generate', ...auth, async (req, res) => {
  try {
    const { settings, prompt, layoutImage } = await generationInputs(req);
    const compatible = (settings?.profiles || []).filter(p => p.type === 'image' && p.provider === 'google_studio');
    const profile = req.body.profileId ? resolveRequestedProfile(settings, 'image', req.body.profileId) : compatible.find(p => p.isDefault) || compatible[0];
    if (!profile || profile.provider !== 'google_studio') throw coverError(400, 'Добавьте или выберите профиль изображения Google Studio в настройках.');
    logProfileUsage('generate-cover', profile, 'image');
    const result = await generateGoogleStoryboardImage({ frame: { prompt }, profile, purpose: 'cover-final', aspectRatio: '16:9', references: [{ name: 'Approved neutral text layout', type: 'style', mimeType: 'image/png', buffer: layoutImage }] });
    const image = await validateCoverImage(result.buffer);
    res.json({ success: true, imageBase64: image.buffer.toString('base64'), mimeType: image.mimeType });
  } catch (error) { fail(res, error); }
});
router.post('/:id/cover/flow/export', ...auth, async (req, res) => {
  try {
    const { style, prompt, fields, template, layoutImage } = await generationInputs(req);
    const zip = new JSZip();
    zip.file('template.png', layoutImage);
    zip.file('style.json', JSON.stringify(template, null, 2));
    zip.file('prompt.txt', prompt);
    zip.file('manifest.json', JSON.stringify({ kind: 'cover', schemaVersion: 2, projectId: req.params.id, title: fields.title, subtitle: fields.subtitle, styleRevision: style.confirmed.revision, outputFile: 'cover.png' }, null, 2));
    zip.file('README.txt', '1. В Google Flow выберите генерацию изображения 16:9.\n2. Прикрепите template.png как схему текста и вставьте весь prompt.txt. Исходная фотография сюда не включена.\n3. Сгенерируйте готовую обложку с новым сюжетом и указанным текстом.\n4. Импортируйте картинку в WebApp либо ZIP с файлом cover.png (допустимы cover.jpg и cover.webp).\n5. Нажмите «Сохранить в проект».\n');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.attachment(`cover-flow-${req.params.id}.zip`).type('application/zip').send(buffer);
  } catch (error) { fail(res, error); }
});

router.post('/:id/cover/import', ...auth, upload('file', 20 * 1024 * 1024), async (req, res) => {
  try {
    if (!req.file) throw coverError(400, 'Выберите изображение или ZIP с результатом.');
    let buffer = req.file.buffer;
    if (/\.zip$/i.test(req.file.originalname)) {
      let zip;
      try { zip = await JSZip.loadAsync(buffer); } catch { throw coverError(400, 'Не удалось открыть ZIP-архив.'); }
      const entries = Object.values(zip.files);
      if (entries.length > 30) throw coverError(400, 'В архиве слишком много файлов. Загрузите одну обложку.');
      const images = entries.filter(entry => !entry.dir && /(^|\/)cover\.(png|jpe?g|webp)$/i.test(entry.name) && !entry.name.startsWith('__MACOSX/'));
      if (images.length !== 1) throw coverError(400, 'В ZIP должна быть одна готовая обложка с именем cover.png, cover.jpg или cover.webp.');
      buffer = await new Promise((resolve, reject) => {
        const stream = images[0].nodeStream('nodebuffer');
        const chunks = []; let size = 0;
        stream.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_COVER_BYTES) stream.destroy(coverError(400, 'Обложка в архиве превышает 15 МБ.'));
          else chunks.push(chunk);
        });
        stream.on('error', reject); stream.on('end', () => resolve(Buffer.concat(chunks)));
      });
    }
    const image = await validateCoverImage(buffer);
    res.json({ success: true, imageBase64: image.buffer.toString('base64'), mimeType: image.mimeType });
  } catch (error) { fail(res, error); }
});

export default router;
