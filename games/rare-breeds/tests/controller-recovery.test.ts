import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createGamePreview, maximumPrize, parseChanceGame } from "../../../dist/game.js";
import { breedAvailability, purchaseBlocker } from "../src/economy.ts";

const definition = parseChanceGame(JSON.parse(await readFile(new URL("../game.json", import.meta.url), "utf8")));

test("the last affordable egg can finish hatching without another purchase", async () => {
  const { client } = createGamePreview(definition, {
    friendId: 7730n, rfBalance: definition.price, stake: maximumPrize(definition), draw: () => 0,
  });
  await client.buy(1n);
  const [play] = await client.play(1n);
  // The settle request has not succeeded yet. This is the recovery snapshot after a failed request.
  const snapshot = await client.read();
  assert.equal(snapshot.rfBalance, 0n);
  assert.equal(snapshot.consumables, 0n);
  assert.equal(purchaseBlocker(snapshot, definition), "balance", "the shop cannot sell another egg");
  const recovery = breedAvailability(snapshot, definition);
  assert.equal(recovery.pendingPlay?.id, play.id);
  assert.equal(recovery.needsEgg, false);
  assert.equal(recovery.blocker, null);
  assert.equal(recovery.canAfford, true);
  await client.settle(recovery.pendingPlay!.id);
  const settled = await client.read();
  assert.equal(settled.plays.length, 1, "recovery reuses the original play");
  assert.equal(settled.rfBalance, 0n, "recovery spends no additional RF");
  assert.equal(breedAvailability(settled, definition).blocker, "balance", "a new breed still requires an egg");
});

test("reserved backing permits recovery while the shop cannot sell another egg", async () => {
  const { client } = createGamePreview(definition, {
    friendId: 7730n, rfBalance: definition.price * 2n, stake: maximumPrize(definition), draw: () => 0,
  });
  await client.buy(1n);
  await client.play(1n);
  const snapshot = await client.read();
  assert.equal(purchaseBlocker(snapshot, definition), "backing");
  assert.equal(breedAvailability(snapshot, definition).blocker, null);
  assert.equal(breedAvailability(snapshot, definition).needsEgg, false);
});

test("without a pending play breeding retains purchase and loading guards", async () => {
  const { client } = createGamePreview(definition, {
    friendId: 7730n, rfBalance: 0n, stake: maximumPrize(definition), draw: () => 0,
  });
  const state = breedAvailability(await client.read(), definition);
  assert.equal(state.pendingPlay, null);
  assert.equal(state.needsEgg, true);
  assert.equal(state.canAfford, false);
  assert.equal(state.blocker, "balance");
  assert.equal(breedAvailability(null, definition).canAfford, false);
});
