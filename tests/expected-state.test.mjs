import assert from "node:assert/strict";
import test from "node:test";
import { generateState } from "./expected-state.mjs";

test("state generator uses rejection sampling and returns eight alphanumeric characters", () => {
  const scripted = [255, 249, 0, 1, 2, 3, 4, 5, 6, 7];
  let index = 0;
  const value = generateState(() => scripted[index++]);
  assert.equal(value, "ABCDEFGH");
  assert.equal(index, scripted.length);
  for (let round = 0; round < 40; round += 1) {
    const generated = generateState();
    assert.match(generated, /^[A-Za-z0-9]{8}$/);
  }
});

test("generator refuses bytes outside a single octet", () => {
  assert.throws(() => generateState(() => 256), /out of range/);
  assert.throws(() => generateState(() => -1), /out of range/);
});
