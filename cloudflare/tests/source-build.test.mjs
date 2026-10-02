import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { prepareSourceBuild } from "../prepare-source-build.mjs";

function withConfig(content, callback) {
  const directory = mkdtempSync(join(tmpdir(), "redlib-source-test-"));
  const path = join(directory, "wrangler.jsonc");
  writeFileSync(path, content);
  try { callback(path); } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("the upgrade preserves the deployed name, bindings, variables, and comments", () => {
  const original = `{
  // Keep the deployed Worker name.
  "name": "redlib",
  "vars": { "REDLIB_DEFAULT_THEME": "dark", "CUSTOM_SETTING": "keep" },
  "containers": [
    { "class_name": "OtherContainer", "image": "./other/Dockerfile" },
    {
      "class_name": "RedlibContainer",
      "image": "./cloudflare/Dockerfile",
      "instance_type": "basic",
      "max_instances": 1,
      "constraints": { "regions": ["APAC"] },
    },
  ],
  "durable_objects": { "bindings": [{ "name": "REDLIB", "class_name": "RedlibContainer" }] },
  "exports": { "RedlibContainer": { "type": "durable-object", "storage": "sqlite" } },
}`;
  withConfig(original, (path) => {
    assert.equal(prepareSourceBuild(path), true);
    const updatedText = readFileSync(path, "utf8");
    const updated = parse(updatedText);
    assert.equal(updated.containers[1].image_build_context, ".");
    delete updated.containers[1].image_build_context;
    assert.deepEqual(updated, parse(original));
    assert.ok(updatedText.includes("// Keep the deployed Worker name."));
    assert.equal(prepareSourceBuild(path), false);
    assert.equal(readFileSync(path, "utf8"), updatedText);
  });
});

test("invalid JSONC is rejected without modifying the configuration", () => {
  withConfig('{ "containers": [ ', (path) => {
    assert.throws(() => prepareSourceBuild(path), /Cannot update Wrangler/);
    assert.equal(readFileSync(path, "utf8"), '{ "containers": [ ');
  });
});

test("missing or ambiguous container entries are rejected without modification", () => {
  for (const config of [
    { name: "redlib" },
    { containers: [{ class_name: "RedlibContainer" }, { class_name: "RedlibContainer" }] },
  ]) {
    const text = JSON.stringify(config);
    withConfig(text, (path) => {
      assert.throws(() => prepareSourceBuild(path), /Expected one existing/);
      assert.equal(readFileSync(path, "utf8"), text);
    });
  }
});
