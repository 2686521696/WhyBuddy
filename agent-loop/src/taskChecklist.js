const CHECKLIST_HEADING = '### 状态清单';
const CHECKLIST_ITEM_RE = /^-\s+\[( |x|X)\]\s+(.+)$/;

export function parseTaskChecklist(taskText) {
  const text = String(taskText ?? '');
  const section = extractChecklistSection(text);
  if (!section) {
    return { items: [], pending: [], done: [], hasPending: false, hasChecklist: false };
  }

  const items = [];
  for (const line of section.split('\n')) {
    const match = line.match(CHECKLIST_ITEM_RE);
    if (!match) continue;
    const done = match[1].toLowerCase() === 'x';
    const label = match[2].trim();
    items.push({ label, done });
  }

  const pending = items.filter((item) => !item.done).map((item) => item.label);
  const done = items.filter((item) => item.done).map((item) => item.label);

  return {
    items,
    pending,
    done,
    hasPending: pending.length > 0,
    hasChecklist: items.length > 0,
  };
}

export function shouldRunDevFix({ baselineGateOk, checklist, autoFix }) {
  if (!autoFix) return false;
  if (!checklist?.hasPending) return false;
  return Boolean(baselineGateOk);
}

function extractChecklistSection(taskText) {
  const lines = taskText.split('\n');
  const start = lines.findIndex((line) => line.trim() === CHECKLIST_HEADING);
  if (start < 0) return null;

  const sectionLines = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line)) break;
    sectionLines.push(line);
  }
  return sectionLines.join('\n');
}