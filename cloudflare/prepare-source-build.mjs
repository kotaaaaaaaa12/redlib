import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, modify, applyEdits, printParseErrorCode } from "jsonc-parser";

export function prepareSourceBuild(configPath) {
  const original = readFileSync(configPath, "utf8");
  const errors = [];
  const config = parse(original, errors, { allowTrailingComma: true });
  if (errors.length) {
    throw new Error(`Cannot update Wrangler configuration: ${errors.map((error) => printParseErrorCode(error.error)).join(", ")}`);
  }
  const matches = Array.isArray(config?.containers)
    ? config.containers.map((container, index) => ({ container, index }))
        .filter(({ container }) => container.class_name === "RedlibContainer")
    : [];
  if (matches.length !== 1) {
    throw new Error("Expected one existing RedlibContainer entry in wrangler.jsonc. Apply the original overlay before this update.");
  }

  const index = matches[0].index;
  const formattingOptions = {
    insertSpaces: true,
    tabSize: 2,
    eol: original.includes("\r\n") ? "\r\n" : "\n",
  };
  let updated = original;
  for (const [key, value] of [
    ["image", "./cloudflare/Dockerfile"],
    ["image_build_context", "."],
  ]) {
    const edits = modify(updated, ["containers", index, key], value, { formattingOptions });
    updated = applyEdits(updated, edits);
  }
  if (updated !== original) {
    const temporaryPath = `${configPath}.source-build.tmp`;
    writeFileSync(temporaryPath, updated, "utf8");
    renameSync(temporaryPath, configPath);
  }
  return updated !== original;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
  try {
    const changed = prepareSourceBuild(configPath);
    console.log(changed
      ? "Configured Redlib to compile repository source using the root Docker build context."
      : "Redlib source build configuration is already ready.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
