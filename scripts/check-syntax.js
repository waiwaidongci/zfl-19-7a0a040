const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PROJECT_ROOT = path.resolve(__dirname, "..");

const TARGET_FILES = [
  "server.js",
  "test-concurrent.js",
  "test-edition-protection.js",
  "scripts/check-syntax.js",
  "scripts/smoke-test.js",
  "scripts/migration-compat.js"
];

function checkFileSyntax(filePath) {
  const result = spawnSync(
    process.execPath,
    ["--check", filePath],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf-8"
    }
  );

  if (result.error) {
    return {
      ok: false,
      file: filePath,
      error: result.error.message
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      file: filePath,
      error: (result.stderr || result.stdout || "unknown syntax error").trim()
    };
  }

  return {
    ok: true,
    file: filePath
  };
}

function checkJsonSyntax(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    JSON.parse(content);
    return { ok: true, file: filePath };
  } catch (e) {
    return {
      ok: false,
      file: filePath,
      error: e.message
    };
  }
}

console.log("========================================");
console.log("语法检查 (node --check + JSON parse)");
console.log("========================================");

const jsResults = [];
for (const file of TARGET_FILES) {
  const fullPath = path.join(PROJECT_ROOT, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`[SKIP] ${file} (文件不存在，跳过)`);
    continue;
  }
  const result = checkFileSyntax(fullPath);
  jsResults.push(result);
  if (result.ok) {
    console.log(`[OK]   ${file}`);
  } else {
    console.log(`[FAIL] ${file}`);
    console.log(`       ${result.error.split("\n").join("\n       ")}`);
  }
}

const jsonResults = [];
const jsonFiles = ["package.json", "data/db.json", "data/migration-log.json"];
for (const file of jsonFiles) {
  const fullPath = path.join(PROJECT_ROOT, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`[SKIP] ${file} (文件不存在，跳过)`);
    continue;
  }
  const result = checkJsonSyntax(fullPath);
  jsonResults.push(result);
  if (result.ok) {
    console.log(`[OK]   ${file} (JSON格式)`);
  } else {
    console.log(`[FAIL] ${file} (JSON格式)`);
    console.log(`       ${result.error}`);
  }
}

const allResults = [...jsResults, ...jsonResults];
const failed = allResults.filter((r) => !r.ok);
const passed = allResults.filter((r) => r.ok);

console.log("\n========================================");
console.log("语法检查结果汇总");
console.log("========================================");
console.log(`通过: ${passed.length}/${allResults.length}`);

if (failed.length > 0) {
  console.log(`\n❌ ${failed.length} 个文件存在语法错误，请修复后重试`);
  process.exit(1);
} else {
  console.log("\n✅ 所有文件语法检查通过");
  process.exit(0);
}
