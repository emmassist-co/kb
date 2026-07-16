export function summarizeDiff(before: string, after: string): string[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const max = Math.max(beforeLines.length, afterLines.length);
  const changes: string[] = [];
  for (let index = 0; index < max; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      changes.push(`Line ${index + 1}: ${beforeLines[index] === undefined ? 'added' : afterLines[index] === undefined ? 'removed' : 'changed'}`);
    }
    if (changes.length >= 8) break;
  }
  if (changes.length === 8 && max > 8) changes.push('Additional changes omitted from preview.');
  return changes;
}
