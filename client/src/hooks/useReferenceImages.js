import { useCallback, useEffect, useRef, useState } from 'react';
import { generateReferenceImage, exportReferenceFlowPackage, importReferenceFlowImage, getReferencePlan } from '../services/api';
import { referenceFlowImage } from '../../../shared/referenceFlow.js';

export default function useReferenceImages({ projectId, plan, applyData, setError, setMessage }) {
  const [profileId, setProfileId] = useState('');
  const [replace, setReplace] = useState(false);
  const [progress, setProgress] = useState(null);
  const [flowBatchSize, setFlowBatchSize] = useState(1);
  const [flowAspectRatio, setFlowAspectRatio] = useState('16:9');
  const [flowModel, setFlowModel] = useState('🍌 Nano Banana 2 Lite');
  const [stopping, setStopping] = useState(false);
  const operation = useRef(null);
  useEffect(() => () => { if (operation.current) { operation.current.stop = true; operation.current.detached = true; } }, [projectId]);
  const start = useCallback(kind => {
    if (operation.current) return null;
    const job = { stop: false, detached: false };
    operation.current = job;
    setStopping(false); setError(''); setMessage('');
    setProgress({ kind, done: 0, total: 0, name: '' });
    return job;
  }, [setError, setMessage]);
  const stop = () => { if (operation.current) { operation.current.stop = true; setStopping(true); } };
  const finish = useCallback(job => {
    if (operation.current === job) operation.current = null;
    if (!job.detached) { setProgress(null); setStopping(false); }
  }, []);
  const refresh = useCallback(async job => {
    if (job.detached) return;
    const data = await getReferencePlan(projectId);
    if (!job.detached) applyData(data);
  }, [projectId, applyData]);
  const generate = async single => {
    const items = single ? [single] : (plan?.items || []).filter(item => item.selected && (replace || !item.image || item.image.stale || item.image.status !== 'ready'));
    if (!items.length) return setMessage('Все выбранные референсы уже готовы.');
    if (items.some(item => !item.prompt?.trim())) return setError('Сначала подготовьте промпты для всех выбранных референсов.');
    if (items.some(item => item.image && !item.image.stale) && !window.confirm('Заменить готовые изображения новой генерацией?')) return;
    const job = start('generate');
    if (!job) return;
    let done = 0;
    try {
      for (const item of items) {
        if (job.stop) break;
        setProgress({ kind: 'generate', done, total: items.length, name: item.name });
        await generateReferenceImage(projectId, item, profileId);
        done++;
        await refresh(job);
      }
      if (!job.detached) setMessage(`${job.stop ? 'Очередь остановлена.' : 'Генерация завершена.'} Создано: ${done} из ${items.length}.`);
    } catch (error) {
      if (!job.detached) setError(`${error.message} Сохранено изображений: ${done}. Можно продолжить с отсутствующих.`);
    } finally { finish(job); }
  };
  const requestBridge = (type, payload, timeoutMs) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Расширение Google Flow не ответило. Обновите расширение и вкладки WebApp и Flow.'));
    }, timeoutMs);
    function onMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin ||
          event.data?.source !== 'flow-webapp-bridge-extension' ||
          event.data?.type !== `${type}_RESULT` || event.data?.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error || 'Google Flow не принял пакет.'));
    }
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'webapp-flow-bridge', type, requestId, payload }, window.location.origin);
  });
  const launchFlow = async single => {
    if (!plan || plan.status !== 'confirmed') return;
    const job = start('flow-start');
    if (!job) return;
    try {
      const bridge = await requestBridge('FLOW_BRIDGE_PING', {}, 4000);
      const [major, minor] = String(bridge.version || '').split('.').map(Number);
      if (!Number.isInteger(major) || !Number.isInteger(minor) || (major === 0 && minor < 6)) {
        throw new Error('Расширение Google Flow устарело. Обновите его до версии 0.6.1 в chrome://extensions, затем обновите вкладки WebApp и Flow.');
      }
      const blob = await exportReferenceFlowPackage(projectId, replace, {
        bridge: true, referenceId: single?.id || '',
      });
      if (blob.size > 16 * 1024 * 1024) throw new Error('Пакет слишком большой для расширения Google Flow.');
      const { ZipReader, BlobReader, TextWriter } = await import('@zip.js/zip.js');
      const reader = new ZipReader(new BlobReader(blob));
      let manifest;
      try {
        const entries = await reader.getEntries();
        const file = entries.find(entry => entry.filename === 'manifest.json');
        if (!file) throw new Error('В пакете Flow отсутствует manifest.json.');
        manifest = JSON.parse(await file.getData(new TextWriter()));
      } finally { await reader.close(); }
      if (manifest.projectId !== projectId || manifest.storyboardRevision !== plan.revision ||
          !Array.isArray(manifest.referenceJobs) || !manifest.referenceJobs.length) {
        throw new Error('Пакет Flow не соответствует текущему набору референсов. Обновите страницу.');
      }
      const zipBase64 = await new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onerror = () => reject(new Error('Не удалось прочитать пакет Flow.'));
        fileReader.onload = () => resolve(String(fileReader.result).split(',')[1] || '');
        fileReader.readAsDataURL(blob);
      });
      await requestBridge('START_FLOW_BATCH', {
        projectId, storyboardRevision: plan.revision,
        frameId: single ? manifest.referenceJobs[0].frameId : '',
        batchSize: single ? 1 : flowBatchSize, aspectRatio: flowAspectRatio,
        modelDisplayName: flowModel, referenceJobs: manifest.referenceJobs,
        filename: `flow-storyboard-r${plan.revision}.zip`, zipBase64,
      }, 75000);
      if (!job.detached) setMessage(single
        ? 'Референс передан в Google Flow. Готовое изображение появится в карточке автоматически.'
        : `Google Flow начал пакет из ${Math.min(flowBatchSize, manifest.referenceJobs.length)} референсов. Готовые изображения появятся в карточках автоматически.`);
    } catch (error) { if (!job.detached) setError(error.message); }
    finally { finish(job); }
  };
  useEffect(() => {
    const onImport = async event => {
      const requestId = event.data?.requestId;
      if (event.source !== window || event.origin !== window.location.origin ||
          event.data?.source !== 'flow-webapp-bridge-extension' ||
          event.data?.type !== 'IMPORT_FLOW_REFERENCE' || !requestId) return;
      const payload = event.data.payload || {};
      const reply = (ok, error = '') => window.postMessage({
        source: 'webapp-flow-bridge', type: 'IMPORT_RESULT', requestId, ok, error,
      }, window.location.origin);
      if (payload.projectId !== projectId || payload.referencePlanRevision !== plan?.revision) {
        reply(false, 'Проект или версия набора референсов изменились. Обновите страницу.'); return;
      }
      const item = plan?.items.find(value => value.id === payload.referenceId && value.selected);
      if (!item || !/^[a-f0-9]{64}$/.test(payload.inputFingerprint || '') ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(payload.mimeType) ||
          typeof payload.base64 !== 'string' || !payload.base64.length || payload.base64.length > 21_000_000) {
        reply(false, 'Некорректное изображение или референс отсутствует.'); return;
      }
      if (item.image?.status === 'ready' && !item.image.stale && !replace) {
        reply(false, 'У референса уже есть изображение. Для замены включите соответствующий переключатель.'); return;
      }
      const job = start('flow-import');
      if (!job) { reply(false, 'WebApp уже обрабатывает изображение.'); return; }
      try {
        const binary = atob(payload.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        const extension = payload.mimeType === 'image/jpeg' ? 'jpg' : payload.mimeType.slice(6);
        const file = new File([bytes], `${item.id}.${extension}`, { type: payload.mimeType });
        if (file.size > 15 * 1024 * 1024) throw new Error('Изображение больше 15 МБ.');
        await importReferenceFlowImage(projectId, payload, file);
        await refresh(job);
        if (!job.detached) setMessage(`Референс «${item.name}» получен из Google Flow.`);
        reply(true);
      } catch (error) {
        if (!job.detached) setError(error.message);
        reply(false, error.message);
      } finally { finish(job); }
    };
    window.addEventListener('message', onImport);
    return () => window.removeEventListener('message', onImport);
  }, [projectId, plan, replace, start, finish, refresh, setError, setMessage]);
  const exportZip = async () => {
    const job = start('export');
    if (!job) return;
    try {
      const blob = await exportReferenceFlowPackage(projectId, replace);
      if (job.detached) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'flow-references.zip';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Пакет скачан. Создайте изображения в Flow по prompts.txt, сохраните имена результатов из пакета и соберите изображения в ZIP.');
    } catch (error) { if (!job.detached) setError(error.message); }
    finally { finish(job); }
  };
  const importZip = async file => {
    if (!file) return;
    if (file.size > 512 * 1024 * 1024) return setError('Архив больше 512 МБ. Разделите изображения на несколько ZIP.');
    const job = start('import');
    if (!job) return;
    let reader;
    let done = 0, skipped = 0;
    const failures = [];
    try {
      const { ZipReader, BlobReader } = await import('@zip.js/zip.js');
      reader = new ZipReader(new BlobReader(file));
      const entries = await reader.getEntries();
      if (entries.length > 1000) throw new Error('Слишком много файлов в архиве (максимум 1000).');
      const seen = new Set();
      const tasks = [];
      for (const entry of entries) {
        if (entry.directory) continue;
        const parsed = referenceFlowImage(entry.filename);
        const item = parsed && plan.items.find(item => item.id === parsed.referenceId && item.selected);
        if (!item || seen.has(item.id)) { skipped++; continue; }
        seen.add(item.id); tasks.push({ entry, parsed, item });
      }
      if (!tasks.length) throw new Error('Не найдены изображения с именами из пакета референсов. Используйте outputFile из manifest.json.');
      if (tasks.some(task => task.item.image) && !window.confirm('Архив содержит изображения для уже заполненных карточек. Заменить их?')) return;
      for (const { entry, parsed, item } of tasks) {
        if (job.stop) break;
        setProgress({ kind: 'import', done: done + failures.length, total: tasks.length, name: item.name });
        try {
          const limit = 15 * 1024 * 1024;
          if (!entry.uncompressedSize || entry.uncompressedSize > limit) throw new Error('Размер изображения должен быть от 1 байта до 15 МБ.');
          let size = 0;
          const chunks = [];
          await entry.getData(new WritableStream({ write(chunk) {
            size += chunk.byteLength;
            if (size > limit) throw new Error('Изображение больше 15 МБ.');
            chunks.push(chunk);
          } }), { checkSignature: true });
          const blob = new Blob(chunks);
          if (job.stop) break;
          await importReferenceFlowImage(projectId, parsed, new File([blob], entry.filename.split('/').at(-1)));
          done++;
        } catch (error) {
          failures.push(`${item.name}: ${error.message}`);
          if ([401, 403].includes(error.status)) break;
        }
        await refresh(job);
      }
      if (!job.detached) {
        setMessage(`${job.stop ? 'Импорт остановлен.' : 'Импорт завершён.'} Загружено: ${done}. Пропущено посторонних/повторных файлов: ${skipped}. Ошибок: ${failures.length}.`);
        if (failures.length) setError(failures.slice(0, 5).join('\n'));
      }
    } catch (error) { if (!job.detached) setError(`Импорт: ${error.message} Сохранено: ${done}.`); }
    finally { await reader?.close().catch(() => {}); finish(job); }
  };
  return { profileId, setProfileId, replace, setReplace, progress, stopping, stop, generate, exportZip, importZip, launchFlow, flowBatchSize, setFlowBatchSize, flowAspectRatio, setFlowAspectRatio, flowModel, setFlowModel };
}
