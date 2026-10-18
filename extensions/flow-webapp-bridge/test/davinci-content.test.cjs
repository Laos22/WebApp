const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'davinci-content.js'), 'utf8');

function setup({ ignoreFirstPointerDown = false } = {}) {
  let selected = false;
  let menuOpen = false;
  let pointerDowns = 0;
  const makeTrigger = () => ({
    className: 'generation-area__dropdown-trigger',
    textContent: selected ? 'Gemini Omni Flash 1.1' : 'Seedance 2.0 Fast',
    getClientRects: () => [1],
    getAttribute: () => menuOpen ? 'true' : 'false',
    click() { /* DaVinci's Radix model trigger ignores synthetic click. */ },
    dispatchEvent(event) {
      assert.equal(event.type, 'pointerdown');
      assert.equal(event.button, 0);
      pointerDowns += 1;
      if (ignoreFirstPointerDown && pointerDowns === 1) return;
      menuOpen = !menuOpen;
    },
  });
  let trigger = makeTrigger();
  const choice = {
    textContent: 'Gemini Omni Flash 1.1 Gemini Omni Flash 1.1',
    getClientRects: () => [1],
    click() { selected = true; trigger = makeTrigger(); },
  };
  const menu = { querySelectorAll: () => [choice] };
  const document = {
    querySelectorAll(selector) {
      if (selector === 'button[aria-haspopup="menu"]') return [trigger];
      if (selector === '[role="menu"] button') return menuOpen ? [choice] : [];
      return [];
    },
    querySelector(selector) { return selector === '[role="menu"]' && menuOpen ? menu : null; },
  };
  const context = { document, PointerEvent: class PointerEvent {
    constructor(type, options) { Object.assign(this, options, { type }); }
  }, chrome: { runtime: { onMessage: { addListener() {} } } },
    setTimeout, clearTimeout, Date, console };
  vm.runInNewContext(`${script}\nthis.testApi = { setModel };`, context);
  return { setModel: context.testApi.setModel, state: () => ({ selected, menuOpen, pointerDowns }) };
}

test('model selection follows the rerendered button and closes its menu', async () => {
  const { setModel, state } = setup();
  await setModel();
  assert.deepEqual(state(), { selected: true, menuOpen: false, pointerDowns: 2 });
});

test('model selection retries when the first pointerdown is lost during page hydration', async () => {
  const { setModel, state } = setup({ ignoreFirstPointerDown: true });
  await setModel();
  assert.deepEqual(state(), { selected: true, menuOpen: false, pointerDowns: 3 });
});

test('finished MP4 is found while DaVinci still displays it as a processing item', () => {
  const prompt = 'A slow camera push-in';
  const media = { src: 'https://storage.googleapis.com/davinciweb-b8892.appspot.com/user-outputs/one/two.mp4?Signature=test' };
  const group = { querySelector(selector) {
    if (selector === 'button[title]') return { getAttribute: () => prompt };
    if (selector === 'video[src*="/user-outputs/"][src*=".mp4"]') return media;
    return null;
  } };
  const context = { document: { querySelectorAll(selector) {
    assert.equal(selector, '[class*="__row-layout__group"], [data-generation-process-ids]');
    return [group];
  } }, chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(`${script}\nthis.testApi = { readyVideo };`, context);
  assert.equal(context.testApi.readyVideo(prompt, 0), media);
  assert.equal(context.testApi.readyVideo(prompt, 1), null);
});
