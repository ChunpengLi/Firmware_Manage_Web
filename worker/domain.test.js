import test from "node:test";
import assert from "node:assert/strict";
import { buildObjectKey, buildRecordFromBody, DEFAULT_OPTIONS } from "./domain.js";

test("firmware records allow an empty optional grid mode", () => {
  const record = buildRecordFromBody({
    category: "firmware",
    model: "430X",
    scenario: "实验室",
    cpu1Version: "1",
    cpu2Version: "1",
    fpgaVersion: "1",
    armVersion: "1"
  }, {}, DEFAULT_OPTIONS);

  assert.equal(record.gridMode, "");
});

test("object keys remain unique for identical metadata and filenames", () => {
  const first = buildObjectKey({
    id: "record-a",
    category: "software",
    softwareName: "单机上位机",
    model: "430X",
    scenario: "实验室",
    version: "1.0",
    enableDate: "2026-11-02"
  }, "release.zip");
  const second = buildObjectKey({
    id: "record-b",
    category: "software",
    softwareName: "单机上位机",
    model: "430X",
    scenario: "实验室",
    version: "1.0",
    enableDate: "2026-11-02"
  }, "release.zip");

  assert.notEqual(first, second);
});
