// Dev tool: snapshot canonical on-chain sprite frames for a pool of real Generations Friends.
// Output is bundled with the game so matchmaking needs no runtime RPC and works in mock tests.
import { writeFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import { FAMILIES_REGISTRY_ABI, GENERATION_SPRITE_MANIFEST as M, GENERATION_FAMILY_NAMES } from "../dist/generation-sprites.js";

const PER_FAMILY = Number(process.argv[2] ?? 8);
const client = createPublicClient({ transport: http(M.rpcUrl) });
const read = (functionName, args) => client.readContract({ address: M.registry, abi: FAMILIES_REGISTRY_ABI, functionName, args });
const pool = new Map(GENERATION_FAMILY_NAMES.map((_, i) => [i, []]));
let s = 0x9e3779b9;
const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
const extra = (process.argv[3] ?? "").split(",").filter(Boolean).map(BigInt);
const friends = [];
async function add(id) {
  const familyId = Number(await read("familyOf", [id]));
  const seed = Number(await read("seedOf", [id]));
  const frames = await read("frames", [familyId, seed]);
  return { id: id.toString(), familyId, family: GENERATION_FAMILY_NAMES[familyId], seed, frames: frames.map(f => f.toString(16).padStart(64, "0")) };
}
for (const id of extra) friends.push({ ...(await add(id)), pinned: true });
let tries = 0;
while ([...pool.values()].some(list => list.length < PER_FAMILY) && tries++ < 4000) {
  const id = BigInt(1 + (next() % 320000));
  const familyId = Number(await read("familyOf", [id]));
  if (pool.get(familyId).length >= PER_FAMILY) continue;
  const entry = await add(id);
  pool.get(familyId).push(entry);
}
for (const list of pool.values()) friends.push(...list);
const out = { source: "Rare Friends Generations canonical sprites via FamiliesRegistry " + M.registry + " on chain " + M.chainId, fetchedAt: new Date().toISOString(), friends };
await writeFile(new URL("../games/rare-breeds/data/wild-friends.json", import.meta.url), JSON.stringify(out));
console.log("families:", [...pool.entries()].map(([k, v]) => `${GENERATION_FAMILY_NAMES[k]}=${v.length}`).join(" "), "total", friends.length, "tries", tries);
