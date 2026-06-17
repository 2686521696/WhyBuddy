import assert from 'node:assert/strict';
import test from 'node:test';
import { markAllChecklistItemsDone, parseTaskChecklist, shouldRunDevFix } from '../src/taskChecklist.js';

test('parseTaskChecklist splits pending and done items', () => {
  const markdown = [
    '# Task',
    '',
    '### 状态清单',
    '',
    '- [ ] fallback chain',
    '- [x] config parity',
    '',
    '## 目标',
    '',
    'finish client parity',
    '',
  ].join('\n');

  const checklist = parseTaskChecklist(markdown);

  assert.equal(checklist.hasChecklist, true);
  assert.equal(checklist.hasPending, true);
  assert.deepEqual(checklist.pending, ['fallback chain']);
  assert.deepEqual(checklist.done, ['config parity']);
});

test('parseTaskChecklist returns empty when section is missing', () => {
  const checklist = parseTaskChecklist('# Task\n\n## 目标\n\nno checklist');

  assert.equal(checklist.hasChecklist, false);
  assert.equal(checklist.hasPending, false);
  assert.deepEqual(checklist.pending, []);
});

test('shouldRunDevFix skips green baseline and only targets red gate with pending checklist', () => {
  const checklist = parseTaskChecklist('### 状态清单\n\n- [ ] still open\n');

  assert.equal(shouldRunDevFix({ baselineGateOk: true, checklist, autoFix: true }), false);
  assert.equal(shouldRunDevFix({ baselineGateOk: false, checklist, autoFix: true }), true);
  assert.equal(shouldRunDevFix({ baselineGateOk: true, checklist, autoFix: false }), false);

  const doneOnly = parseTaskChecklist('### 状态清单\n\n- [x] done\n');
  assert.equal(shouldRunDevFix({ baselineGateOk: true, checklist: doneOnly, autoFix: true }), false);
  assert.equal(shouldRunDevFix({ baselineGateOk: false, checklist: doneOnly, autoFix: true }), false);
});

test('markAllChecklistItemsDone checks every pending checklist item', () => {
  const source = [
    '# Task',
    '',
    '### 状态清单',
    '',
    '- [ ] open one',
    '- [x] already done',
    '- [ ] open two',
    '',
    '## 目标',
    '',
  ].join('\n');

  const updated = markAllChecklistItemsDone(source);

  assert.match(updated, /- \[x\] open one/);
  assert.match(updated, /- \[x\] open two/);
  assert.doesNotMatch(updated, /- \[ \] open/);
});