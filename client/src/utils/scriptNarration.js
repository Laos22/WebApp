// Count only explicitly marked narration; unmarked scripts cannot be separated
// reliably from visual directions without guessing.
export function getNarrationStats(script = '') {
  const sections = [];
  let current = null;
  let hasNarration = false;
  const label = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\[?\s*(ДИКТОР|ДІКТОР|ВИЗУАЛ|ВІЗУАЛ|VISUAL|NARRATOR)\s*\]?(?:\*\*|__)?\s*(?::\s*(?:\*\*|__)?|$)\s*/iu;

  for (const line of String(script).replace(/\r\n?/g, '\n').split('\n')) {
    const match = line.match(label);
    if (match) {
      const narration = /^(?:ДИКТОР|ДІКТОР|NARRATOR)$/iu.test(match[1]);
      current = narration ? [] : null;
      if (narration) {
        hasNarration = true;
        sections.push(current);
        current.push(line.slice(match[0].length));
      }
      continue;
    }
    if (/^\s*(?:#{1,6}\s|(?:\*\*|__)?(?:БЛОК|BLOCK)\s+\d|(?:---+|\*\*\*+|___+)\s*$)/iu.test(line)) {
      current = null;
    } else if (current) {
      current.push(line);
    }
  }

  const characters = sections.reduce((sum, lines) => {
    const text = lines.join(' ').replace(/\*\*|__|`/g, '').replace(/\s+/gu, ' ').trim();
    return sum + Array.from(text).length;
  }, 0);
  return { characters, hasNarration };
}
