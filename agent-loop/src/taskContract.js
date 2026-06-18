// Entry contract: every task must declare how "done" is judged via a non-empty
// `## 成功标准` section (derived from the spec). A task without it does not enter
// the loop — the engine HALTs immediately and kicks it back to be specified,
// rather than guessing completion with a runtime special-case.

const SUCCESS_CRITERIA_HEADING = '## 成功标准';

export function parseSuccessCriteria(taskText) {
  const lines = String(taskText ?? '').split('\n');
  const start = lines.findIndex((line) => line.trim() === SUCCESS_CRITERIA_HEADING);
  if (start < 0) return { hasCriteria: false, items: [] };

  const items = [];
  const paragraphLines = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;

    const trimmed = lines[index].trim();
    if (!trimmed) continue;

    const bullet = trimmed.match(/^[-*]\s+(.+\S)\s*$/);
    if (bullet) {
      items.push(bullet[1].trim());
      continue;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.+\S)\s*$/);
    if (numbered) {
      items.push(numbered[1].trim());
      continue;
    }

    paragraphLines.push(trimmed);
  }

  if (paragraphLines.length > 0) {
    items.push(paragraphLines.join(' '));
  }

  return { hasCriteria: items.length > 0, items };
}

export function checkTaskAdmission(taskText) {
  const { hasCriteria, items } = parseSuccessCriteria(taskText);
  if (!hasCriteria) {
    return { admissible: false, reason: 'NO_SUCCESS_CRITERIA', criteria: [] };
  }
  return { admissible: true, reason: null, criteria: items };
}