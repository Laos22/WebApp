import ProfileSelector from './ProfileSelector';

const button = 'px-4 py-2.5 rounded-xl bg-fuchsia-700 hover:bg-fuchsia-600 disabled:opacity-50 disabled:cursor-not-allowed';
export default function ReferenceImageControls({ images, projectId, disabled, ready }) {
  const { progress } = images;
  return <section className="bg-slate-900/80 border border-fuchsia-500/30 rounded-2xl p-5 md:p-6 space-y-4">
    <h2 className="text-xl font-bold">Изображения референсов</h2>
    {!ready && <p className="text-amber-300 text-sm">Сохраните изменения и утвердите набор перед генерацией или импортом.</p>}
    <ProfileSelector type="image" provider="google_studio" projectId={projectId} operation="reference-images" value={images.profileId} onChange={images.setProfileId} disabled={disabled} />
    <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={images.replace} disabled={disabled} onChange={event => images.setReplace(event.target.checked)} />Включить готовые изображения для замены</label>
    <div className="flex flex-wrap gap-3">
      <button type="button" className={button} disabled={disabled || !ready} onClick={() => images.generate()}>Сгенерировать {images.replace ? 'все' : 'недостающие'} · Google Studio</button>
      <button type="button" className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={disabled || !ready} onClick={images.exportZip}>Скачать пакет Google Flow</button>
      <label className={`${button} bg-slate-700 hover:bg-slate-600 ${disabled || !ready ? 'opacity-50' : 'cursor-pointer'}`}>Импортировать ZIP
        <input type="file" accept=".zip,application/zip" className="sr-only" disabled={disabled || !ready} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; images.importZip(file); }} />
      </label>
    </div>
    <p className="text-sm text-slate-400">Google Studio создаёт изображения последовательно для отмеченных карточек. Flow: скачайте пакет с промптами, создайте изображения, верните их ZIP-архивом с именами из пакета.</p>
    {progress && <div role="status" className="space-y-2 border-t border-slate-700 pt-3">
      <p>{progress.kind === 'export' ? 'Собираем пакет…' : `${progress.kind === 'import' ? 'Импорт' : 'Генерация'}: ${progress.done} / ${progress.total}${progress.name ? ` — ${progress.name}` : ''}`}</p>
      {progress.total > 0 && <progress className="w-full" max={progress.total} value={progress.done} />}
      {progress.kind !== 'export' && <><button type="button" className={`${button} bg-red-800 hover:bg-red-700`} disabled={images.stopping} onClick={images.stop}>{images.stopping ? 'Остановка после текущего изображения…' : 'Остановить очередь'}</button><p className="text-xs text-slate-400">Текущий запрос завершится и сохранится. Уход со страницы остановит запуск следующих изображений; уже созданные останутся.</p></>}
    </div>}
  </section>;
}
