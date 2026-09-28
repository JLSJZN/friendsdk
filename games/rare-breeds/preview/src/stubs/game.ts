// Bundle stand-in for "@rarefriends/friendsdk/game" (tools/build-preview.mjs): only samplePreviewRoll is imported,
// by src/slingshot.ts. A uniform roll in 0-9999 from the browser's crypto, like the SDK's own preview roll.
const ROLLS = 10_000;
const LIMIT = Math.floor(0x1_0000_0000 / ROLLS) * ROLLS;

export function samplePreviewRoll(): number {
  const word = new Uint32Array(1);
  do crypto.getRandomValues(word); while (word[0] >= LIMIT);
  return word[0] % ROLLS;
}
