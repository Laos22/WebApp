import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  descriptionTimeline, buildDescriptionPrompt, parseDescriptionResult,
} from '../src/services/youtubeDescriptionService.js';

const blocks = [
  { id: 'b1', order: 1, sourceTitle: 'Вступление', adaptedText: 'Начало истории', audioStatus: 'ready', audioDurationSec: 31.6 },
  { id: 'b2', order: 2, sourceTitle: 'История озера', adaptedText: 'Основная история', audioStatus: 'ready', audioDurationSec: 42.4 },
  { id: 'b3', order: 3, sourceTitle: 'Тайна', adaptedText: 'Развязка', audioStatus: 'ready', audioDurationSec: 28.1 },
];
const project = {
  title: 'Карпатское озеро',
  script: { status: 'confirmed', revision: 2, content: 'Проверенный сценарий о Карпатском озере.' },
  referencePlan: { status: 'confirmed', revision: 1 },
  voiceover: { status: 'confirmed', sourceScriptRevision: 2, revision: 3, blocks },
  storyboard: { status: 'confirmed', sourceScriptRevision: 2, sourceReferencePlanRevision: 1, sourceVoiceoverRevision: 3,
    frames: blocks.map((block, index) => ({ id: `frame-${index}`, sourceVoiceoverBlockId: block.id, scriptText: block.adaptedText })) },
};

test('YouTube chapter times use DaVinci block offsets; provider chooses titles only', () => {
  const timeline = descriptionTimeline(project);
  assert.equal(timeline.ready, true);
  assert.deepEqual(timeline.chapters.map(item => item.timestamp), ['00:00', '00:31', '01:14']);
  const answer = JSON.stringify({ description: 'История озера.', chaptersTitle: 'Главы',
    chapters: [{ blockId: 'b3', title: 'Развязка' }, { blockId: 'b1', title: 'Начало' }, { blockId: 'b2', title: 'Путь к озеру' }], footer: '#Карпаты' });
  assert.equal(parseDescriptionResult(answer, timeline).content,
    'История озера.\n\nГлавы\n00:00 Начало\n00:31 Путь к озеру\n01:14 Развязка\n\n#Карпаты');
  assert.match(buildDescriptionPrompt({ project, timeline, instruction: 'На украинском' }), /Проверенный сценарий/);
  assert.throws(() => parseDescriptionResult(JSON.stringify({ description: 'История', chaptersTitle: 'Главы',
    chapters: [{ blockId: 'other', title: 'Выдуманная глава' }], footer: '' }), timeline));
});

test('No fabricated timecodes when voiceover is incomplete', () => {
  const timeline = descriptionTimeline({ ...project, voiceover: { ...project.voiceover, blocks: [{ ...blocks[0], audioDurationSec: null }, ...blocks.slice(1)] } });
  assert.equal(timeline.ready, false);
  assert.deepEqual(timeline.chapters, []);
  const content = parseDescriptionResult(JSON.stringify({ description: 'Описание без глав.', chaptersTitle: '', chapters: [], footer: '' }), timeline);
  assert.equal(content.content, 'Описание без глав.');
  assert.ok(content.warnings.length);
});
