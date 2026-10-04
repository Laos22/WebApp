import { useEffect, useRef, useState } from 'react';
import { generateReferenceImage, exportReferenceFlowPackage, importReferenceFlowImage, getReferencePlan } from '../services/api';
import { referenceFlowImage } from '../../../shared/referenceFlow.js';

export default function useReferenceImages({ projectId, plan, applyData, setError, setMessage }) {
  const [profileId, setProfileId] = useState('');
  const [replace, setReplace] = useState(false);
  const [progress, setProgress] = useState(null);
  const [stopping, setStopping] = useState(false);
  const operation = useRef(null);
  useEffect(() => () => { if (operation.current) { operation.current.stop = true; operation.current.detached = true; } }, [projectId]);
  const start = kind => {
    if (operation.current) return null;
    const job = { stop: false, detached: false };
    operation.current = job;
    setStopping(false); setError(''); setMessage('');
    setProgress({ kind, done: 0, total: 0, name: '' });
    return job;
  };
  const stop = () => { if (operation.current) { operation.current.stop = true; setStopping(true); } };
  const finish = job => {
    if (operation.current === job) operation.current = null;
    if (!job.detached) { setProgress(null); setStopping(false); }
  };
  const refresh = async job => {
    if (job.detached) return;
    const data = await getReferencePlan(projectId);
    if (!job.detached) applyData(data);
  };
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
  return { profileId, setProfileId, replace, setReplace, progress, stopping, stop, generate, exportZip, importZip };
}
