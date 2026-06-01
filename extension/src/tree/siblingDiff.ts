/**
 * Compute the 1–2 most distinctive tokens for each member of a regenerate
 * sibling group. Pure.
 *
 * Given the assistant text of N siblings (where the user clicked regenerate
 * and got N different answers to the same question), we want to surface what
 * makes EACH answer different — the user should be able to glance at a card
 * and know "this is the one that mentioned indigo" vs "the one that mentioned
 * forest green".
 */

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','else','of','for','to','in','on',
  'at','by','with','from','as','is','are','was','were','be','been','being','am',
  'do','does','did','have','has','had','having','it','its','this','that','these',
  'those','i','you','he','she','we','they','me','him','her','us','them','my',
  'your','his','their','our','will','would','can','could','should','may','might',
  'so','not','no','yes','also','than','too','very','just','more','most','some',
  'any','all','here','there','what','which','who','when','where','why','how',
  'one','two','three','about','into','out','up','down','over','under','again',
  'further','only','own','same','such','because','while','through','during',
  'before','after','between','against','above','below',
]);

const TOKEN_RE = /[A-Za-z][A-Za-z0-9'-]*/g;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const tok = m[0].toLowerCase();
    if (tok.length < 3) continue;
    if (STOPWORDS.has(tok)) continue;
    tokens.push(tok);
  }
  return tokens;
}

function counts(tokens: string[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const t of tokens) c.set(t, (c.get(t) ?? 0) + 1);
  return c;
}

/**
 * For each sibling text, returns the 1-2 tokens that are most distinctive
 * to THAT sibling: tokens that appear in this sibling but NOT in any other,
 * picked by frequency. Outputs are lower-cased.
 *
 * Returned arrays have the same length as `siblingTexts`. Empty arrays
 * are returned for siblings with no distinctive tokens.
 */
export function siblingHighlights(siblingTexts: string[], perCard = 2): string[][] {
  if (siblingTexts.length < 2) return siblingTexts.map(() => []);

  const tokenSets = siblingTexts.map((t) => new Set(tokenize(t)));
  const tokenCounts = siblingTexts.map((t) => counts(tokenize(t)));

  return siblingTexts.map((_, i) => {
    const mine = tokenCounts[i]!;
    // unique = tokens in mine NOT present in any other sibling
    const unique: Array<{ tok: string; freq: number }> = [];
    for (const [tok, freq] of mine) {
      let isUnique = true;
      for (let j = 0; j < tokenSets.length; j++) {
        if (j === i) continue;
        if (tokenSets[j]!.has(tok)) {
          isUnique = false;
          break;
        }
      }
      if (isUnique) unique.push({ tok, freq });
    }
    unique.sort((a, b) => b.freq - a.freq || a.tok.localeCompare(b.tok));
    return unique.slice(0, perCard).map((u) => u.tok);
  });
}
