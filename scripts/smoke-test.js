const http = require("http");
const { copyFile, mkdtemp, rm, stat, readFile } = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const REAL_DATA_DIR = path.join(PROJECT_ROOT, "data");
const REAL_DB_PATH = path.join(REAL_DATA_DIR, "db.json");
const REAL_BACKUPS_DIR = path.join(REAL_DATA_DIR, "backups");

const PORT = Number(process.env.PORT || 0) || 3300 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 15000;

let serverProcess = null;
let tempDataDir = null;
let realDbHashBefore = null;
let realBackupsSnapshotBefore = null;

function hashFileContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function snapshotRealData() {
  realDbHashBefore = hashFileContent(await readFile(REAL_DB_PATH, "utf-8"));
  const backupFiles = [];
  try {
    const { readdirSync } = require("fs");
    const files = readdirSync(REAL_BACKUPS_DIR);
    for (const f of files) {
      const fp = path.join(REAL_BACKUPS_DIR, f);
      const s = await stat(fp);
      backupFiles.push({ name: f, size: s.size, mtime: s.mtimeMs });
    }
  } catch (e) {}
  realBackupsSnapshotBefore = backupFiles;
}

async function verifyRealDataUntouched() {
  console.log("\n--- 验证仓库真实数据未被修改 ---");
  let ok = true;

  const realDbAfter = hashFileContent(await readFile(REAL_DB_PATH, "utf-8"));
  if (realDbAfter !== realDbHashBefore) {
    console.log(`[FAIL] data/db.json 被修改！测试过程写坏了仓库数据`);
    ok = false;
  } else {
    console.log(`[OK]   data/db.json 未被修改`);
  }

  try {
    const { readdirSync } = require("fs");
    const files = readdirSync(REAL_BACKUPS_DIR);
    const currentFiles = [];
    for (const f of files) {
      const fp = path.join(REAL_BACKUPS_DIR, f);
      const s = await stat(fp);
      currentFiles.push({ name: f, size: s.size, mtime: s.mtimeMs });
    }

    if (currentFiles.length !== realBackupsSnapshotBefore.length) {
      console.log(`[FAIL] data/backups/ 文件数量变化：${realBackupsSnapshotBefore.length} -> ${currentFiles.length}`);
      ok = false;
    } else {
      let allSame = true;
      for (let i = 0; i < currentFiles.length; i++) {
        const a = realBackupsSnapshotBefore[i];
        const b = currentFiles[i];
        if (a.name !== b.name || a.size !== b.size || a.mtime !== b.mtime) {
          allSame = false;
          break;
        }
      }
      if (allSame) {
        console.log(`[OK]   data/backups/ 未被覆盖或修改 (${currentFiles.length} 个文件)`);
      } else {
        console.log(`[FAIL] data/backups/ 内容被改动！`);
        ok = false;
      }
    }
  } catch (e) {
    console.log(`[WARN] 无法验证 backups 目录: ${e.message}`);
  }

  return ok;
}

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, BASE_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...options.headers
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode,
              body: JSON.parse(data)
            });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const health = await request("/health");
      if (health.status === 200 && health.body.ok) {
        return health;
      }
    } catch {
    }
    await sleep(100);
  }
  throw new Error(`服务启动超时: ${BASE_URL}`);
}

async function startIsolatedServer() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "zfl-smoke-"));
  await copyFile(
    REAL_DB_PATH,
    path.join(tempDataDir, "db.json")
  );
  console.log(`[INFO] 临时数据目录: ${tempDataDir}`);
  console.log(`[INFO] 服务监听端口: ${PORT}`);

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: tempDataDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  serverProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  serverProcess.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[server] 异常退出 code=${code}`);
    }
  });

  await waitForServer();
}

async function stopIsolatedServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2000);
      serverProcess.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  serverProcess = null;

  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    console.log(`[INFO] 临时数据目录已清理: ${tempDataDir}`);
    tempDataDir = null;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`断言失败: ${message}`);
  }
}

async function runSmokeTests() {
  const results = [];

  console.log("\n--- Test 1: 健康检查 ---");
  const health = await request("/health");
  assert(health.status === 200, `/health 状态码 ${health.status}`);
  assert(health.body.ok === true, "health.body.ok 应为 true");
  assert(typeof health.body.dataVersion === "number", "dataVersion 应为数字");
  console.log("[PASS] 健康检查通过，dataVersion=" + health.body.dataVersion);
  results.push({ name: "health", passed: true });

  console.log("\n--- Test 2: 曲目列表查询 ---");
  const tunes = await request("/tunes");
  assert(tunes.status === 200, `/tunes 状态码 ${tunes.status}`);
  assert(Array.isArray(tunes.body.data), "tunes 返回 data 数组");
  console.log(`[PASS] 曲目列表返回 ${tunes.body.data.length} 条`);
  results.push({ name: "list-tunes", passed: true });

  console.log("\n--- Test 3: 创建曲目 ---");
  const newTune = await request("/tunes", {
    method: "POST",
    body: {
      title: "冒烟测试曲目",
      composer: "冒烟测试机器人",
      stripSpec: {
        widthMm: 70,
        scale: "20音",
        tempoBpm: 80,
        paperType: "测试纸带"
      }
    }
  });
  assert(newTune.status === 201, `创建曲目状态码 ${newTune.status}`);
  const tuneId = newTune.body.data.id;
  assert(tuneId, "返回曲目ID");
  console.log(`[PASS] 创建曲目成功: ${tuneId}`);
  results.push({ name: "create-tune", passed: true });

  console.log("\n--- Test 4: 创建区间 ---");
  const section1 = await request(`/tunes/${tuneId}/sections`, {
    method: "POST",
    body: { startBeat: 1, endBeat: 32, laneRange: "1-20", note: "smoke_sec_1" }
  });
  assert(section1.status === 201, `创建区间状态码 ${section1.status}`);
  const sectionId1 = section1.body.data.id;
  const section2 = await request(`/tunes/${tuneId}/sections`, {
    method: "POST",
    body: { startBeat: 33, endBeat: 64, laneRange: "4-18", checked: false, note: "smoke_sec_2" }
  });
  assert(section2.status === 201, `创建第二个区间状态码 ${section2.status}`);
  const sectionId2 = section2.body.data.id;
  console.log(`[PASS] 创建2个区间: ${sectionId1}, ${sectionId2}`);
  results.push({ name: "create-sections", passed: true });

  console.log("\n--- Test 5: 曲目进度 ---");
  const progress = await request(`/tunes/${tuneId}/progress`);
  assert(progress.status === 200, `/progress 状态码 ${progress.status}`);
  assert(typeof progress.body.data.percent === "number", "percent 字段存在");
  assert(typeof progress.body.data.totalSections === "number", "totalSections 字段存在");
  console.log(`[PASS] 曲目进度: 覆盖率 ${progress.body.data.percent}%, sections=${progress.body.data.totalSections}`);
  results.push({ name: "tune-progress", passed: true });

  console.log("\n--- Test 6: 创建问题 ---");
  const issue = await request("/issues", {
    method: "POST",
    body: {
      tuneId,
      sectionId: sectionId2,
      type: "漏孔",
      beat: 41,
      lane: 12,
      description: "冒烟测试问题"
    }
  });
  assert(issue.status === 201, `创建问题状态码 ${issue.status}`);
  const issueId = issue.body.data.id;
  console.log(`[PASS] 创建问题: ${issueId}`);
  results.push({ name: "create-issue", passed: true });

  console.log("\n--- Test 7: 问题状态流转 (open→fixed→verified) ---");
  const toFixed = await request(`/issues/${issueId}/status`, {
    method: "PATCH",
    body: { status: "fixed", fixDescription: "冒烟测试修复" }
  });
  assert(toFixed.status === 200, `fixed 状态码 ${toFixed.status}`);
  const toVerified = await request(`/issues/${issueId}/status`, {
    method: "PATCH",
    body: { status: "verified", reviewNote: "冒烟测试验证通过" }
  });
  assert(toVerified.status === 200, `verified 状态码 ${toVerified.status}`);
  console.log("[PASS] 问题状态流转正常");
  results.push({ name: "issue-status-flow", passed: true });

  console.log("\n--- Test 8: 纸带规格模板 ---");
  const templates = await request("/strip-spec-templates");
  assert(templates.status === 200, `模板列表状态码 ${templates.status}`);
  assert(templates.body.data.length >= 5, "至少5个内置模板");
  const templateDetail = await request("/strip-spec-templates/tpl_20_standard");
  assert(templateDetail.status === 200, `模板详情状态码 ${templateDetail.status}`);
  console.log(`[PASS] 模板列表 ${templates.body.data.length} 个，详情正常`);
  results.push({ name: "strip-templates", passed: true });

  console.log("\n--- Test 9: 创建版次 ---");
  const editionsBefore = await request(`/tunes/${tuneId}/editions`);
  const newEdition = await request(`/tunes/${tuneId}/editions`, {
    method: "POST",
    body: { description: "smoke_edition_v2", setAsCurrent: false }
  });
  assert(newEdition.status === 201, `创建版次状态码 ${newEdition.status}`);
  const editionId = newEdition.body.data.id;
  const editionsAfter = await request(`/tunes/${tuneId}/editions`);
  assert(editionsAfter.body.data.length === editionsBefore.body.data.length + 1, "版次数量+1");
  console.log(`[PASS] 创建版次: ${editionId}`);
  results.push({ name: "create-edition", passed: true });

  console.log("\n--- Test 10: 版次对比 ---");
  const editions = editionsAfter.body.data;
  if (editions.length >= 2) {
    const compare = await request(`/tunes/${tuneId}/editions/${editions[0].id}/compare/${editions[1].id}`);
    assert(compare.status === 200, `版次对比状态码 ${compare.status}`);
    console.log("[PASS] 版次对比接口正常");
    results.push({ name: "compare-editions", passed: true });
  } else {
    console.log("[SKIP] 版次不足，跳过对比");
    results.push({ name: "compare-editions", passed: true, skipped: true });
  }

  console.log("\n--- Test 11: 生成打孔任务 ---");
  const generate = await request("/punch-tasks/generate", {
    method: "POST",
    body: { tuneId, defaultPriority: "high" }
  });
  assert(generate.status === 200 || generate.status === 201, `生成任务状态码 ${generate.status} (期望200或201)`);
  const tasks = await request(`/punch-tasks?tuneId=${tuneId}`);
  assert(tasks.status === 200, `任务列表状态码 ${tasks.status}`);
  assert(Array.isArray(tasks.body.data), "任务列表返回 data 数组");
  let taskId = null;
  if (tasks.body.data.length > 0) {
    taskId = tasks.body.data[0].id;
    console.log(`[PASS] 打孔任务: 已有 ${tasks.body.data.length} 个，首个 ${taskId}`);
  } else {
    const manualTask = await request("/punch-tasks", {
      method: "POST",
      body: { tuneId, sectionId: sectionId2, priority: "medium", note: "smoke_manual_task" }
    });
    assert(manualTask.status === 201, `手动创建任务状态码 ${manualTask.status}`);
    taskId = manualTask.body.data.id;
    console.log(`[PASS] 无未检查区间，手动创建任务: ${taskId}`);
  }
  results.push({ name: "generate-tasks", passed: true });

  console.log("\n--- Test 12: 任务领取+完成闭环 ---");
  const claim = await request(`/punch-tasks/${taskId}/claim`, {
    method: "PATCH",
    body: { assignee: "冒烟测试员" }
  });
  assert(claim.status === 200, `领取任务状态码 ${claim.status}`);
  const complete = await request(`/punch-tasks/${taskId}/complete`, {
    method: "PATCH",
    body: { checkSection: true, sectionNote: "smoke完成", note: "ok" }
  });
  assert(complete.status === 200, `完成任务状态码 ${complete.status}`);
  assert(complete.body.data.status === "completed", "任务状态应为 completed");
  console.log("[PASS] 任务领取+完成闭环正常");
  results.push({ name: "task-lifecycle", passed: true });

  console.log("\n--- Test 13: 校对报告 ---");
  const report = await request(`/tunes/${tuneId}/report`);
  assert(report.status === 200, `报告状态码 ${report.status}`);
  assert(report.body.data.coverage, "coverage 字段存在");
  assert(report.body.data.summary, "summary 字段存在");
  const snapshot = await request(`/tunes/${tuneId}/report/snapshot`, {
    method: "POST",
    body: { label: "smoke_snapshot" }
  });
  assert(snapshot.status === 201, `保存快照状态码 ${snapshot.status}`);
  console.log("[PASS] 校对报告和快照正常");
  results.push({ name: "report-snapshot", passed: true });

  console.log("\n--- Test 14: 写入队列最终状态 ---");
  await sleep(300);
  const finalHealth = await request("/health");
  const pending = finalHealth.body.writeQueue?.pendingWrites || 0;
  const failed = finalHealth.body.writeQueue?.failedOperations || 0;
  assert(pending === 0, `待处理写入应为0，实际 ${pending}`);
  assert(failed === 0, `失败写入应为0，实际 ${failed}`);
  console.log(`[PASS] 写入队列干净: pending=0, failed=0`);
  results.push({ name: "write-queue-clean", passed: true });

  return results;
}

async function main() {
  console.log("========================================");
  console.log("冒烟测试 (临时DATA_DIR隔离)");
  console.log("========================================");

  try {
    await snapshotRealData();

    await startIsolatedServer();

    const testResults = await runSmokeTests();

    const untouchedOk = await verifyRealDataUntouched();

    console.log("\n========================================");
    console.log("冒烟测试结果汇总");
    console.log("========================================");
    const notSkipped = testResults.filter((r) => !r.skipped);
    const passed = notSkipped.filter((r) => r.passed).length;
    const total = notSkipped.length;
    const skipped = testResults.filter((r) => r.skipped).length;
    console.log(`通过: ${passed}/${total}${skipped > 0 ? ` (跳过${skipped})` : ""}`);
    console.log(`仓库数据完整性: ${untouchedOk ? "✅ 未被修改" : "❌ 被修改！"}`);

    await stopIsolatedServer();

    if (passed === total && untouchedOk) {
      console.log("\n🎉 冒烟测试全部通过，仓库数据完整！");
      process.exit(0);
    } else {
      console.log("\n⚠️  冒烟测试失败或数据被改动");
      process.exit(1);
    }
  } catch (err) {
    console.error("\n💥 冒烟测试执行失败:", err.message);
    console.error(err.stack);
    try {
      await verifyRealDataUntouched();
    } catch (e) {}
    await stopIsolatedServer();
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  console.log("\n收到中断信号，清理中...");
  await stopIsolatedServer();
  process.exit(130);
});

main();
