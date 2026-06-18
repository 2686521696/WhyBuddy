import assert from 'node:assert/strict';
import test from 'node:test';
import { checkTaskAdmission, parseSuccessCriteria } from '../src/taskContract.js';

test('parseSuccessCriteria accepts bullet lists', () => {
  const taskText = [
    '# Task',
    '',
    '## 成功标准',
    '',
    '- gate 全绿',
    '- 不能改测试',
  ].join('\n');

  const parsed = parseSuccessCriteria(taskText);
  assert.equal(parsed.hasCriteria, true);
  assert.deepEqual(parsed.items, ['gate 全绿', '不能改测试']);
});

test('parseSuccessCriteria accepts numbered lists', () => {
  const taskText = [
    '## 成功标准',
    '',
    '1. gate 全绿',
    '2. 不改测试',
  ].join('\n');

  const parsed = parseSuccessCriteria(taskText);
  assert.equal(parsed.hasCriteria, true);
  assert.deepEqual(parsed.items, ['gate 全绿', '不改测试']);
});

test('parseSuccessCriteria accepts plain paragraphs', () => {
  const taskText = [
    '## 成功标准',
    '',
    'gate 全绿，并且 Python/Node 行为一致。',
  ].join('\n');

  const parsed = parseSuccessCriteria(taskText);
  assert.equal(parsed.hasCriteria, true);
  assert.deepEqual(parsed.items, ['gate 全绿，并且 Python/Node 行为一致。']);
});

test('parseSuccessCriteria rejects an empty success criteria section', () => {
  const taskText = [
    '## 成功标准',
    '',
    '## 允许修改的文件',
    '',
    '- `src/a.py`',
  ].join('\n');

  const parsed = parseSuccessCriteria(taskText);
  assert.equal(parsed.hasCriteria, false);
  assert.deepEqual(parsed.items, []);
});

test('checkTaskAdmission admits tasks with paragraph success criteria', () => {
  const admission = checkTaskAdmission('## 成功标准\n\ngate 全绿。');
  assert.equal(admission.admissible, true);
  assert.equal(admission.reason, null);
  assert.deepEqual(admission.criteria, ['gate 全绿。']);
});