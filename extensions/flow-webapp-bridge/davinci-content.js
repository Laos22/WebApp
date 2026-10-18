// This bridge uses the signed-in DaVinci AI web UI. It does not read account credentials
// or call undocumented generation endpoints.
const DAVINCI_MODEL = 'Gemini Omni Flash 1.1';
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
let running = false;

function visible(element) {
  return element && element.getClientRects().length > 0;
}

function findButton(text, root = document) {
  return [...root.querySelectorAll('button')].find(button =>
    visible(button) && button.textContent?.trim() === text);
}

function waitFor(find, timeout = 30000, interval = 250, step = 'элемент интерфейса') {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const result = find();
      if (result) return resolve(result);
      if (Date.now() - start >= timeout) return reject(new Error(`DaVinci AI не показал: ${step}. Генерация не запущена.`));
      setTimeout(check, interval);
    };
    check();
  });
}

function panel() {
  let element = document.getElementById('webapp-davinci-status');
  if (!element) {
    element = document.createElement('div');
    element.id = 'webapp-davinci-status';
    element.style.cssText = 'position:fixed;z-index:2147483647;right:18px;bottom:18px;max-width:350px;padding:14px 18px;border:1px solid #8b5cf6;border-radius:12px;background:#121527;color:#fff;font:14px/1.45 system-ui;box-shadow:0 8px 32px #0008';
    document.body.appendChild(element);
  }
  return element;
}

function status(message, retry) {
  const element = panel();
  element.replaceChildren(document.createTextNode(message));
  if (retry) {
    const button = document.createElement('button');
    button.textContent = 'Повторить импорт MP4';
    button.style.cssText = 'display:block;margin-top:10px;padding:8px 10px;border:0;border-radius:8px;background:#7c3aed;color:white;cursor:pointer';
    button.addEventListener('click', retry);
    element.appendChild(button);
  }
}

function payloadError(payload) {
  if (!payload || !/^[a-f\d]{24}$/i.test(payload.projectId || '') ||
      !/^frame_[0-9a-f-]+$/i.test(payload.frameId || '') ||
      !/^[a-f\d]{64}$/i.test(payload.inputFingerprint || '')) return 'Некорректное видеозадание.';
  if (payload.modelDisplayName !== DAVINCI_MODEL || payload.resolution !== '720p' ||
      payload.durationSeconds !== 8 || payload.aspectRatio !== '16:9') return 'Неподдерживаемые настройки DaVinci AI.';
  if (!IMAGE_MIME.has(payload.imageMimeType) || typeof payload.imageBase64 !== 'string' ||
      !payload.imageBase64.length || payload.imageBase64.length > 21_000_000) return 'Некорректное исходное изображение.';
  if (typeof payload.prompt !== 'string' || !payload.prompt.trim() || payload.prompt.length > 12000)
    return 'Промпт видео пустой или слишком длинный.';
  return '';
}

function imageFile(payload) {
  const binary = atob(payload.imageBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const ext = payload.imageMimeType === 'image/png' ? 'png' : payload.imageMimeType === 'image/webp' ? 'webp' : 'jpg';
  return new File([bytes], `${payload.frameId}.${ext}`, { type: payload.imageMimeType });
}

function resultGroups(prompt) {
  // Newly generated videos first appear in History's processing item. They may
  // move to a normal row later without changing their prompt or media URL.
  return [...document.querySelectorAll('[class*="__row-layout__group"], [data-generation-process-ids]')]
    .filter(group => group.querySelector('button[title]')?.getAttribute('title') === prompt);
}

function readyVideo(prompt, previousCount) {
  const groups = resultGroups(prompt);
  if (groups.length <= previousCount) return null;
  return groups.map(group => group.querySelector('video[src*="/user-outputs/"][src*=".mp4"]'))
    .find(Boolean) || null;
}

function modelTrigger() {
  return [...document.querySelectorAll('button[aria-haspopup="menu"]')]
    .find(button => visible(button) && button.className.includes('generation-area__dropdown-trigger'));
}

function toggleModelMenu() {
  // Radix DropdownMenuTrigger toggles on pointerdown, not on HTMLElement.click().
  // A synthetic click alone leaves this menu closed in DaVinci AI.
  modelTrigger()?.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', isPrimary: true,
  }));
}

async function setModel() {
  const trigger = await waitFor(modelTrigger, 30000, 250, 'переключатель модели');
  if (trigger.textContent?.trim() === DAVINCI_MODEL) return;
  let choice;
  for (let attempt = 0; attempt < 3 && !choice; attempt += 1) {
    toggleModelMenu();
    try {
      choice = await waitFor(() => [...document.querySelectorAll('[role="menu"] button')]
        .find(button => visible(button) && button.textContent?.includes(DAVINCI_MODEL)),
      3000, 250, 'модель Gemini Omni Flash 1.1 в списке');
    } catch { /* The page may still be attaching click handlers; retry. */ }
  }
  if (!choice) throw new Error('Не удалось открыть список моделей DaVinci AI. Обновите вкладку и повторите.');
  choice.click();
  // DaVinci rerenders the model control after selection; the old button becomes stale.
  await waitFor(() => modelTrigger()?.textContent?.trim() === DAVINCI_MODEL,
    10000, 250, 'подтверждение модели Gemini Omni Flash 1.1');
  const current = modelTrigger();
  if (current?.getAttribute('aria-expanded') === 'true') toggleModelMenu();
  await waitFor(() => !document.querySelector('[role="menu"]'), 10000, 250, 'закрытие списка моделей');
}

async function setSettings() {
  const settingsTrigger = () => document.querySelector('button[aria-label="Video settings"]');
  const settingsDialog = () => [...document.querySelectorAll('[role="dialog"]')]
    .find(item => item.textContent?.includes('Video settings'));
  const trigger = await waitFor(settingsTrigger,
    30000, 250, 'настройки видео');
  trigger.click();
  const dialog = await waitFor(settingsDialog, 10000, 250, 'окно настроек видео');
  const aspect = [...dialog.querySelectorAll('[role="radiogroup"][aria-label="Aspect ratio"] [role="radio"]')]
    .find(item => item.textContent?.trim() === '16:9');
  const resolution = [...dialog.querySelectorAll('[role="radiogroup"][aria-label="Resolution"] [role="radio"]')]
    .find(item => item.textContent?.trim() === '720p');
  if (!aspect || !resolution) throw new Error('В DaVinci AI недоступны 16:9 или 720p.');
  aspect.click();
  resolution.click();
  const slider = settingsDialog()?.querySelector('[role="slider"]');
  if (!slider) throw new Error('DaVinci AI не показал настройку длительности.');
  slider.focus();
  // Omni Flash uses 3..10 seconds with one-second keyboard steps.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const currentSlider = settingsDialog()?.querySelector('[role="slider"]');
    const value = Number(currentSlider?.getAttribute('aria-valuenow'));
    const shown = settingsDialog()?.querySelector('output')?.textContent?.trim();
    if (shown === '8s') break;
    if (!currentSlider || !Number.isFinite(value)) throw new Error('Не удалось прочитать длительность DaVinci AI.');
    currentSlider.focus();
    currentSlider.dispatchEvent(new KeyboardEvent('keydown', {
      key: shown && parseInt(shown, 10) > 8 ? 'ArrowLeft' : 'ArrowRight', bubbles: true, cancelable: true,
    }));
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  if (settingsDialog()?.querySelector('output')?.textContent?.trim() !== '8s')
    throw new Error('Не удалось установить длительность 8 секунд в DaVinci AI.');
  settingsTrigger()?.click();
  await waitFor(() => !settingsDialog(), 10000, 250, 'закрытие настроек видео');
  if (!/16:9\s*·\s*8 Sec\s*·\s*720p/.test(settingsTrigger()?.textContent || ''))
    throw new Error('DaVinci AI не подтвердил настройки 16:9, 8 секунд, 720p.');
}

async function setPrompt(prompt) {
  const editor = await waitFor(() => document.querySelector('[contenteditable="true"][role="textbox"]'),
    30000, 250, 'поле промпта');
  editor.focus();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, prompt);
  if (editor.textContent?.trim() !== prompt.trim())
    throw new Error('DaVinci AI не принял промпт.');
}

async function setImage(payload) {
  const start = await waitFor(() => findButton('Start Image'), 30000, 250, 'кнопку Start Image');
  start.click();
  const dialog = await waitFor(() => [...document.querySelectorAll('[role="dialog"]')]
    .find(item => item.querySelector('h2')?.textContent?.trim() === 'Assets'), 10000, 250, 'окно загрузки изображения');
  const input = dialog.querySelector('input[type="file"]');
  if (!input) throw new Error('DaVinci AI не показал загрузку изображения.');
  const transfer = new DataTransfer();
  transfer.items.add(imageFile(payload));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => dialog.querySelector('[class*="__upload__item"] img[alt="Asset"]') &&
    findButton('Add', dialog), 60000, 250, 'загруженное изображение и кнопку Add');
  findButton('Add', dialog).click();
  await waitFor(() => document.querySelector('button[aria-label="Remove start image"]'),
    60000, 250, 'подтверждение исходного изображения');
}

function sendReady(payload, videoUrl) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'DAVINCI_VIDEO_READY', payload: {
      projectId: payload.projectId, frameId: payload.frameId,
      inputFingerprint: payload.inputFingerprint, videoUrl,
    } }, response => {
      const error = chrome.runtime.lastError;
      if (error || response?.ok !== true) reject(new Error(response?.error || 'Не удалось передать MP4 в WebApp. Оставьте вкладку открытой и повторите импорт.'));
      else resolve();
    });
  });
}

async function awaitVideo(payload, previousCount) {
  status('DaVinci AI создаёт видео. После готовности MP4 будет импортирован в WebApp.');
  const video = await waitFor(() => readyVideo(payload.prompt, previousCount),
    20 * 60 * 1000, 2000, 'готовый MP4 в списке');
  const url = video.src;
  const transfer = () => sendReady(payload, url)
    .then(() => status('Готово: MP4 импортирован в WebApp.'))
    .catch(error => status(error.message, transfer));
  await transfer();
}

async function startVideo(payload) {
  const error = payloadError(payload);
  if (error) throw new Error(error);
  if (running) throw new Error('В этой вкладке уже создаётся видео.');
  running = true;
  try {
    status('Открываем генератор DaVinci AI…');
    await waitFor(() => findButton('Create Video'), 30000, 250, 'режим Create Video');
    status('Выбираем Gemini Omni Flash 1.1…');
    await setModel();
    status('Выставляем 720p, 8 секунд и 16:9…');
    await setSettings();
    status('Передаём промпт и исходное изображение…');
    await setPrompt(payload.prompt);
    await setImage(payload);
    const selectedModel = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
      .find(button => visible(button) && button.className.includes('generation-area__dropdown-trigger'));
    const selectedSettings = document.querySelector('button[aria-label="Video settings"]');
    if (selectedModel?.textContent?.trim() !== DAVINCI_MODEL ||
        !/16:9\s*·\s*8 Sec\s*·\s*720p/.test(selectedSettings?.textContent || '')) {
      throw new Error('DaVinci AI изменил модель или параметры после загрузки кадра. Генерация не запущена.');
    }
    const previousCount = resultGroups(payload.prompt).length;
    const generate = await waitFor(() => document.querySelector('button[data-generate-button="true"]'));
    if (generate.disabled) throw new Error('Кнопка Generate недоступна. Проверьте баланс кредитов и вход в аккаунт DaVinci AI.');
    generate.click();
    status('Генерация запущена в DaVinci AI. Оставьте вкладку открытой.');
    awaitVideo(payload, previousCount).catch(failure =>
      status(`Не удалось автоматически получить MP4: ${failure.message}. Готовое видео остаётся в DaVinci AI; его можно скачать и импортировать вручную.`))
      .finally(() => { running = false; });
    return { ok: true };
  } catch (failure) {
    running = false;
    status(failure.message || 'Не удалось запустить DaVinci AI.');
    throw failure;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'START_DAVINCI_VIDEO') return;
  startVideo(message.payload).then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
  return true;
});
