const http = require("http");
const { copyFile, mkdtemp, rm, readFile, stat } = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const PROJECT_ROOT = path.resolve(__dirname);
const REAL_DB_PATH = path.join(PROJECT_ROOT, "data", "db.json");
const REAL_BACKUPS_DIR = path.join(PROJECT_ROOT, "data", "backups");

const PORT = Number(process.env.PORT || 0) || 3100 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_PREFIX = "zfl_concurrent_test_";
const TEST_TUNE_TITLE = "并发写入隔离测试曲目";
const SERVER_START_TIMEOUT_MS = 10000;

let serverProcess = null;
let tempDataDir = null;
let testTuneId = null;
let createdSectionIds = [];
let createdEditionIds = [];
let createdIssueIds = [];
let createdSessionIds = [];
let createdTaskIds = [];

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
        if (a.name !== b.name || a.size !== b.size || a.mtime !== b.mtime) { allSame = false; break; }
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

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
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
  throw new Error(`测试服务启动超时: ${BASE_URL}`);
}

async function startIsolatedServer() {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "zfl-concurrent-"));
  await copyFile(
    path.join(__dirname, "data", "db.json"),
    path.join(tempDataDir, "db.json")
  );
  console.log(`临时数据目录: ${tempDataDir}`);

  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
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
      console.error(`[server] exited with code ${code}`);
    } else if (signal) {
      console.log(`[server] stopped by ${signal}`);
    }
  });

  await waitForServer();
}

async function stopIsolatedServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1000);
      serverProcess.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  serverProcess = null;

  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    console.log(`临时数据目录已清理: ${tempDataDir}`);
    tempDataDir = null;
  }
}

async function setupIsolatedTestData() {
  console.log("\n=== 数据隔离：创建独立测试环境 ===");

  const res = await request("/tunes", {
    method: "POST",
    body: {
      title: `${TEST_TUNE_TITLE}_${Date.now()}`,
      composer: "测试机器人",
      stripSpec: {
        widthMm: 70,
        scale: "20音",
        tempoBpm: 80,
        paperType: "测试纸带"
      }
    }
  });

  if (res.status !== 201) {
    throw new Error(`创建测试曲目失败: ${res.status} ${JSON.stringify(res.body)}`);
  }

  testTuneId = res.body.data.id;
  console.log(`创建测试曲目: ${testTuneId}`);
  return testTuneId;
}

async function cleanupIsolatedTestData() {
  console.log("\n=== 数据隔离：清理测试数据 ===");
  let cleanedCount = 0;

  try {
    const sectionsRes = await request(`/tunes/${testTuneId}/sections`);
    if (sectionsRes.status === 200 && sectionsRes.body.data) {
      cleanedCount += sectionsRes.body.data.length;
    }
  } catch (e) {}

  try {
    const editionsRes = await request(`/tunes/${testTuneId}/editions`);
    if (editionsRes.status === 200 && editionsRes.body.data) {
      cleanedCount += editionsRes.body.data.length;
    }
  } catch (e) {}

  try {
    const issuesRes = await request(`/issues?tuneId=${testTuneId}`);
    if (issuesRes.status === 200 && issuesRes.body.data) {
      cleanedCount += issuesRes.body.data.length;
    }
  } catch (e) {}

  try {
    const tasksRes = await request(`/punch-tasks?tuneId=${testTuneId}`);
    if (tasksRes.status === 200 && tasksRes.body.data) {
      cleanedCount += tasksRes.body.data.length;
    }
  } catch (e) {}

  try {
    await request(`/tunes/${testTuneId}/archive`, { method: "PATCH" });
    console.log(`测试曲目已归档: ${testTuneId}`);
  } catch (e) {
    console.log(`归档测试曲目失败: ${e.message}`);
  }

  console.log(`清理完成，涉及约 ${cleanedCount} 条关联数据`);
  createdSectionIds = [];
  createdEditionIds = [];
  createdIssueIds = [];
  createdSessionIds = [];
  createdTaskIds = [];
}

async function testConcurrentSectionCreation() {
  console.log("\n=== Test 1: 并发创建区间 ===");
  console.log("测试目标: 验证同时创建10个区间时不会丢失数据");

  const tuneId = testTuneId;
  const concurrentCount = 10;
  const requests = [];

  for (let i = 0; i < concurrentCount; i++) {
    const startBeat = 100 + i * 10;
    requests.push(
      request(`/tunes/${tuneId}/sections`, {
        method: "POST",
        body: {
          startBeat,
          endBeat: startBeat + 9,
          laneRange: "1-20",
          note: `${TEST_PREFIX}section_${i + 1}`
        }
      })
    );
  }

  const results = await Promise.all(requests);

  const successCount = results.filter((r) => r.status === 201).length;
  console.log(`成功创建: ${successCount}/${concurrentCount}`);

  const createdIds = results
    .filter((r) => r.status === 201)
    .map((r) => r.body.data.id);
  createdSectionIds.push(...createdIds);

  const getResponse = await request(`/tunes/${tuneId}/sections`);
  const allSections = getResponse.body.data;
  const testSections = allSections.filter((s) =>
    createdIds.includes(s.id)
  );

  console.log(`实际保存的区间数: ${testSections.length}`);
  console.log(`预期保存的区间数: ${successCount}`);

  if (testSections.length === successCount && successCount === concurrentCount) {
    console.log("✅ Test 1 PASSED: 所有并发创建的区间都已保存");
    return { passed: true };
  } else {
    console.log("❌ Test 1 FAILED: 数据丢失");
    return { passed: false };
  }
}

async function testConcurrentEditionCreation() {
  console.log("\n=== Test 2: 并发创建版次 ===");
  console.log("测试目标: 验证同时创建多个版次时版本号正确且不冲突");

  const tuneId = testTuneId;
  const concurrentCount = 5;
  const requests = [];

  for (let i = 0; i < concurrentCount; i++) {
    requests.push(
      request(`/tunes/${tuneId}/editions`, {
        method: "POST",
        body: {
          description: `${TEST_PREFIX}edition_${i + 1}`,
          setAsCurrent: false
        }
      })
    );
  }

  const results = await Promise.all(requests);

  const successCount = results.filter((r) => r.status === 201).length;
  console.log(`成功创建: ${successCount}/${concurrentCount}`);

  const versions = results
    .filter((r) => r.status === 201)
    .map((r) => r.body.data.version)
    .sort((a, b) => a - b);

  createdEditionIds.push(
    ...results.filter((r) => r.status === 201).map((r) => r.body.data.id)
  );

  console.log(`创建的版本号: ${versions.join(", ")}`);

  const uniqueVersions = new Set(versions);
  const getResponse = await request(`/tunes/${tuneId}/editions`);
  const allEditions = getResponse.body.data;
  const maxVersion = Math.max(...allEditions.map((e) => e.version));

  const expectedVersions = [];
  for (let i = maxVersion - concurrentCount + 1; i <= maxVersion; i++) {
    expectedVersions.push(i);
  }

  if (
    uniqueVersions.size === versions.length &&
    versions.length === concurrentCount &&
    versions.every((v, i) => v === expectedVersions[i])
  ) {
    console.log("✅ Test 2 PASSED: 版本号正确且无重复");
    return { passed: true };
  } else {
    console.log("❌ Test 2 FAILED: 版本号冲突或重复");
    return { passed: false };
  }
}

async function testAtomicRollback() {
  console.log("\n=== Test 3: 事务回滚 ===");
  console.log("测试目标: 验证创建区间失败时不会部分写入");

  const tuneId = testTuneId;

  const beforeResponse = await request(`/tunes/${tuneId}/sections`);
  const beforeCount = beforeResponse.body.data.length;
  console.log(`操作前区间数: ${beforeCount}`);

  const invalidRequests = [
    request(`/tunes/${tuneId}/sections`, {
      method: "POST",
      body: {
        startBeat: 500,
        endBeat: 509,
        laneRange: "1-20",
        note: `${TEST_PREFIX}valid_section`
      }
    }),
    request(`/tunes/${tuneId}/sections`, {
      method: "POST",
      body: {
        startBeat: "invalid",
        endBeat: 519,
        laneRange: "1-20",
        note: `${TEST_PREFIX}invalid_section`
      }
    })
  ];

  const results = await Promise.all(invalidRequests);

  const successCount = results.filter((r) => r.status === 201).length;
  const failCount = results.filter((r) => r.status !== 201).length;
  console.log(`成功: ${successCount}, 失败: ${failCount}`);

  results
    .filter((r) => r.status === 201)
    .forEach((r) => createdSectionIds.push(r.body.data.id));

  const afterResponse = await request(`/tunes/${tuneId}/sections`);
  const afterCount = afterResponse.body.data.length;
  console.log(`操作后区间数: ${afterCount}`);

  if (afterCount === beforeCount + successCount) {
    console.log("✅ Test 3 PASSED: 失败的事务正确回滚");
    return { passed: true };
  } else {
    console.log("❌ Test 3 FAILED: 部分数据写入或回滚失败");
    return { passed: false };
  }
}

async function testWriteQueueRecovery() {
  console.log("\n=== Test 4: 写入队列失败后恢复 ===");
  console.log("测试目标: 验证单个写入失败后队列不卡死，后续写入仍可成功");

  const tuneId = testTuneId;

  const healthBefore = await request("/health");
  const pendingBefore = healthBefore.body.writeQueue?.pendingWrites || 0;
  console.log(`测试前待处理写入: ${pendingBefore}`);

  const failPromise = request(`/tunes/${tuneId}/sections`, {
    method: "POST",
    body: {
      startBeat: undefined,
      endBeat: undefined,
      laneRange: undefined
    }
  });

  const successPromises = [];
  for (let i = 0; i < 5; i++) {
    successPromises.push(
      request(`/tunes/${tuneId}/sections`, {
        method: "POST",
        body: {
          startBeat: 600 + i * 10,
          endBeat: 609 + i * 10,
          laneRange: "1-20",
          note: `${TEST_PREFIX}recovery_${i + 1}`
        }
      })
    );
  }

  const failResult = await failPromise;
  console.log(`预期失败的请求状态: ${failResult.status} (期望非201)`);

  const successResults = await Promise.all(successPromises);
  const successAfterFail = successResults.filter((r) => r.status === 201).length;
  console.log(`失败请求后成功写入数: ${successAfterFail}/${successPromises.length}`);

  successResults
    .filter((r) => r.status === 201)
    .forEach((r) => createdSectionIds.push(r.body.data.id));

  await sleep(500);
  const healthFinal = await request("/health");
  const pendingFinal = healthFinal.body.writeQueue?.pendingWrites || 0;
  console.log(`最终待处理写入: ${pendingFinal} (期望0)`);

  if (
    failResult.status !== 201 &&
    successAfterFail === 5 &&
    pendingFinal === 0
  ) {
    console.log("✅ Test 4 PASSED: 写入队列在失败后正确恢复");
    return { passed: true };
  } else {
    console.log("❌ Test 4 FAILED: 写入队列在失败后卡死或异常");
    return { passed: false };
  }
}

async function testCrossObjectAtomicity() {
  console.log("\n=== Test 5: 跨对象操作原子性 ===");
  console.log("测试目标: 验证创建版次并切换当前版次是原子的");

  const tuneId = testTuneId;

  const beforeTuneRes = await request(`/tunes/${tuneId}`);
  const beforeCurrentEdition = beforeTuneRes.body.data.currentEditionId;
  console.log(`操作前当前版次: ${beforeCurrentEdition || "(无)"}`);

  const concurrentCount = 3;
  const requests = [];

  for (let i = 0; i < concurrentCount; i++) {
    requests.push(
      request(`/tunes/${tuneId}/editions`, {
        method: "POST",
        body: {
          description: `${TEST_PREFIX}atomic_edition_${i + 1}`,
          setAsCurrent: true
        }
      })
    );
  }

  const results = await Promise.all(requests);

  const successResults = results.filter((r) => r.status === 201);
  console.log(`成功创建版次: ${successResults.length}/${concurrentCount}`);

  successResults.forEach((r) => createdEditionIds.push(r.body.data.id));

  const afterTuneRes = await request(`/tunes/${tuneId}`);
  const afterCurrentEdition = afterTuneRes.body.data.currentEditionId;
  console.log(`操作后当前版次: ${afterCurrentEdition}`);

  const editionsRes = await request(`/tunes/${tuneId}/editions`);
  const currentEdition = editionsRes.body.data.find((e) => e.isCurrent);

  const sectionsRes = await request(`/tunes/${tuneId}/sections`);
  const sections = sectionsRes.body.data;

  const editionFromResults = successResults.find(
    (r) => r.body.data.id === afterCurrentEdition
  );
  const isCurrentInResults = editionFromResults
    ? editionFromResults.body.data.isCurrent
    : false;

  const currentCount = editionsRes.body.data.filter(
    (e) => e.isCurrent && e.tuneId === tuneId
  ).length;

  if (
    currentEdition &&
    currentEdition.id === afterCurrentEdition &&
    currentCount === 1 &&
    currentEdition.sectionsSnapshot.length === sections.length
  ) {
    console.log(
      "✅ Test 5 PASSED: 版次创建和切换是原子的，只有一个current，sections与snapshot一致"
    );
    return { passed: true };
  } else {
    console.log(
      `❌ Test 5 FAILED: 版次切换非原子 (currentCount=${currentCount}, expected=1)`
    );
    return { passed: false };
  }
}

async function testPlaySessionEndAtomicity() {
  console.log("\n=== Test 6: 结束试奏+创建问题原子性 ===");
  console.log("测试目标: 验证部分问题失败时整个操作回滚");

  const tuneId = testTuneId;

  const sectionsRes = await request(`/tunes/${tuneId}/sections`);
  const sections = sectionsRes.body.data.slice(0, 3);
  if (sections.length < 3) {
    console.log("⚠️  区间不足，跳过此测试");
    return { passed: true, skipped: true };
  }

  const beforeIssuesRes = await request("/issues");
  const beforeIssues = (beforeIssuesRes.body.data || []).filter(
    (i) => i.tuneId === tuneId
  ).length;
  const beforeSessionsRes = await request(`/tunes/${tuneId}/play-sessions`);
  const beforeSessions = (beforeSessionsRes.body.data || []).length;

  const sessionRes = await request(`/tunes/${tuneId}/play-sessions`, {
    method: "POST",
    body: {
      startSectionId: sections[0].id,
      assignee: "测试机器人"
    }
  });

  if (sessionRes.status !== 201) {
    console.log("⚠️  创建试奏会话失败，跳过此测试");
    return { passed: true, skipped: true };
  }

  const sessionId = sessionRes.body.data.id;
  createdSessionIds.push(sessionId);

  const endRes = await request(`/play-sessions/${sessionId}/end`, {
    method: "PATCH",
    body: {
      endSectionId: sections[2].id,
      issues: [
        {
          sectionId: sections[0].id,
          type: "漏孔",
          description: `${TEST_PREFIX}valid_issue`,
          beat: 10,
          lane: 5
        },
        {
          sectionId: "NONEXISTENT_SECTION_ID",
          type: "错孔",
          description: `${TEST_PREFIX}invalid_issue`
        }
      ]
    }
  });

  console.log(`结束试奏状态: ${endRes.status} (期望409)`);

  const afterIssuesRes = await request("/issues");
  const afterIssues = (afterIssuesRes.body.data || []).filter(
    (i) => i.tuneId === tuneId && i.description && i.description.includes(TEST_PREFIX)
  ).length;

  const sessionCheckRes = await request(`/play-sessions/${sessionId}`);
  const sessionStatus = sessionCheckRes.body.data?.status;

  console.log(`以${TEST_PREFIX}开头的问题数: ${afterIssues} (期望0)`);
  console.log(`会话状态: ${sessionStatus} (期望active/非ended)`);

  if (endRes.status === 409 && afterIssues === 0 && sessionStatus !== "ended") {
    console.log("✅ Test 6 PASSED: 部分问题失败时整个操作正确回滚");
    return { passed: true };
  } else {
    console.log("❌ Test 6 FAILED: 原子回滚未生效");
    return { passed: false };
  }
}

async function testCompleteTaskAtomicity() {
  console.log("\n=== Test 7: 完成任务+勾选区间原子性 ===");
  console.log("测试目标: 验证任务完成和区间勾选是原子的");

  const tuneId = testTuneId;

  const sectionsRes = await request(`/tunes/${tuneId}/sections`);
  const uncheckedSections = sectionsRes.body.data.filter((s) => !s.checked);
  if (uncheckedSections.length < 1) {
    console.log("⚠️  未勾选区间不足，跳过此测试");
    return { passed: true, skipped: true };
  }

  const targetSection = uncheckedSections[0];

  const taskRes = await request("/punch-tasks", {
    method: "POST",
    body: {
      tuneId,
      sectionId: targetSection.id,
      priority: "medium",
      assignee: "测试机器人",
      note: `${TEST_PREFIX}atomic_task`
    }
  });

  if (taskRes.status !== 201) {
    console.log("⚠️  创建任务失败，跳过此测试");
    return { passed: true, skipped: true };
  }

  const taskId = taskRes.body.data.id;
  createdTaskIds.push(taskId);

  const claimRes = await request(`/punch-tasks/${taskId}/claim`, {
    method: "PATCH",
    body: { assignee: "测试机器人" }
  });
  if (claimRes.status !== 200) {
    console.log("⚠️  领取任务失败，跳过此测试");
    return { passed: true, skipped: true };
  }

  const beforeSectionRes = await request(`/tunes/${tuneId}/sections`);
  const beforeChecked = beforeSectionRes.body.data.find(
    (s) => s.id === targetSection.id
  )?.checked;
  console.log(`操作前区间checked状态: ${beforeChecked}`);

  const completeRes = await request(`/punch-tasks/${taskId}/complete`, {
    method: "PATCH",
    body: {
      checkSection: true,
      sectionNote: `${TEST_PREFIX}completed_note`
    }
  });

  console.log(`完成任务状态: ${completeRes.status}`);

  const afterSectionRes = await request(`/tunes/${tuneId}/sections`);
  const afterSection = afterSectionRes.body.data.find(
    (s) => s.id === targetSection.id
  );
  const afterChecked = afterSection?.checked;
  const noteMatch = afterSection?.note?.includes(TEST_PREFIX);

  const currentEditionRes = await request(`/tunes/${tuneId}/editions`);
  const currentEdition = currentEditionRes.body.data.find((e) => e.isCurrent);
  const snapSection = currentEdition?.sectionsSnapshot?.find(
    (s) => s.id === targetSection.id
  );

  const taskData = completeRes.body.data;
  const taskCompleted = taskData?.status === "completed";

  console.log(`操作后区间checked: ${afterChecked}, 任务completed: ${taskCompleted}`);
  console.log(`版次快照同步: ${snapSection?.checked === afterChecked}`);

  if (
    completeRes.status === 200 &&
    afterChecked === true &&
    taskCompleted === true &&
    noteMatch &&
    (!currentEdition || snapSection?.checked === afterChecked)
  ) {
    console.log(
      "✅ Test 7 PASSED: 任务完成、区间勾选、版次快照更新是原子的"
    );
    return { passed: true };
  } else {
    console.log("❌ Test 7 FAILED: 原子性被破坏");
    return { passed: false };
  }
}

async function runAllTests() {
  console.log("========================================");
  console.log("并发写入验证测试（数据隔离版）");
  console.log("========================================");

  try {
    await snapshotRealData();

    await startIsolatedServer();

    const health = await request("/health");
    console.log(`服务器状态: ${health.body.ok ? "正常" : "异常"}`);
    console.log(`数据版本: v${health.body.dataVersion}`);
    console.log(
      `写入队列: pending=${health.body.writeQueue?.pendingWrites}, failed=${health.body.writeQueue?.failedOperations}`
    );

    await setupIsolatedTestData();

    const results = [];

    results.push(await testConcurrentSectionCreation());
    results.push(await testConcurrentEditionCreation());
    results.push(await testAtomicRollback());
    results.push(await testWriteQueueRecovery());
    results.push(await testCrossObjectAtomicity());
    results.push(await testPlaySessionEndAtomicity());
    results.push(await testCompleteTaskAtomicity());

    console.log("\n========================================");
    console.log("测试结果汇总");
    console.log("========================================");

    const notSkipped = results.filter((r) => !r.skipped);
    const passed = notSkipped.filter((r) => r.passed).length;
    const total = notSkipped.length;
    const skipped = results.filter((r) => r.skipped).length;

    console.log(`通过: ${passed}/${total}${skipped > 0 ? ` (跳过${skipped})` : ""}`);

    await cleanupIsolatedTestData();

    const finalHealth = await request("/health");
    console.log(
      `\n最终队列状态: pending=${finalHealth.body.writeQueue?.pendingWrites}, failed=${finalHealth.body.writeQueue?.failedOperations}`
    );

    const untouchedOk = await verifyRealDataUntouched();

    if (passed === total && untouchedOk) {
      console.log("\n🎉 所有测试通过! 并发写入安全，数据隔离有效");
      await stopIsolatedServer();
      process.exit(0);
    } else {
      if (!untouchedOk) {
        console.log("\n⚠️  仓库数据被修改！隔离机制可能失效");
      }
      console.log("⚠️  部分测试失败，请检查");
      await stopIsolatedServer();
      process.exit(1);
    }
  } catch (err) {
    console.error("测试执行失败:", err.message);
    console.error(err.stack);

    if (testTuneId) {
      try {
        await cleanupIsolatedTestData();
      } catch (e) {
        console.error("清理失败:", e.message);
      }
    }

    try { await verifyRealDataUntouched(); } catch (e) {}
    await stopIsolatedServer();
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  console.log("\n收到中断信号，正在清理测试数据...");
  if (testTuneId) {
    try {
      await cleanupIsolatedTestData();
    } catch (e) {}
  }
  await stopIsolatedServer();
  process.exit(0);
});

runAllTests();
