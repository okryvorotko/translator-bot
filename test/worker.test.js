import test from "node:test";
import assert from "node:assert/strict";
import { containsThai, splitMessage } from "../src/worker.js";

test("detects Thai characters", () => {
  assert.equal(containsThai("สวัสดีครับ"), true);
  assert.equal(containsThai("Hello world"), false);
  assert.equal(containsThai("Hello สวัสดี"), true);
});

test("splits messages without breaking Unicode code points", () => {
  assert.deepEqual(splitMessage("abcdef", 4), ["abcd", "ef"]);
  assert.deepEqual(splitMessage("😀😀😀", 2), ["😀😀", "😀"]);
});
