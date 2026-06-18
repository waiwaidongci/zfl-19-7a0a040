const http = require("http");

const PORT = Number(process.env.PORT || 3019);
const BASE_URL = `http://127.0.0.1:${PORT}`;

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

async function testConcurrentSectionCreation() {
  console.log("\n=== Test 1: 并发创建区间 ===");
  console.log("测试目标: 验证同时创建10个区间时不会丢失数据");

  const tuneId = "tune_demo";
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
          note: `并发测试区间 #${i + 1}`
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

  const getResponse = await request(`/tunes/${tuneId}/sections`);
  const allSections = getResponse.body.data;
  const testSections = allSections.filter((s) =>
    createdIds.includes(s.id)
  );

  console.log(`实际保存的区间数: ${testSections.length}`);
  console.log(`预期保存的区间数: ${successCount}`);

  if (testSections.length === successCount && successCount === concurrentCount) {
    console.log("✅ Test 1 PASSED: 所有并发创建的区间都已保存");
    return { passed: true, createdIds };
  } else {
    console.log("❌ Test 1 FAILED: 数据丢失");
    return { passed: false, createdIds };
  }
}

async function testConcurrentEditionCreation() {
  console.log("\n=== Test 2: 并发创建版次 ===");
  console.log("测试目标: 验证同时创建多个版次时版本号正确且不冲突");

  const tuneId = "tune_demo";
  const concurrentCount = 5;
  const requests = [];

  for (let i = 0; i < concurrentCount; i++) {
    requests.push(
      request(`/tunes/${tuneId}/editions`, {
        method: "POST",
        body: {
          description: `并发测试版次 #${i + 1}`,
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

  const tuneId = "tune_demo";

  const beforeResponse = await request(`/tunes/${tuneId}/sections`);
  const beforeCount = beforeResponse.body.data.length;
  console.log(`操作前区间数: ${beforeCount}`);

  const invalidRequests = [
    request(`/tunes/${tuneId}/sections`, {
      method: "POST",
      body: {
        startBeat: 200,
        endBeat: 209,
        laneRange: "1-20"
      }
    }),
    request(`/tunes/${tuneId}/sections`, {
      method: "POST",
      body: {
        startBeat: "invalid",
        endBeat: 219,
        laneRange: "1-20"
      }
    })
  ];

  const results = await Promise.all(invalidRequests);

  const successCount = results.filter((r) => r.status === 201).length;
  const failCount = results.filter((r) => r.status !== 201).length;
  console.log(`成功: ${successCount}, 失败: ${failCount}`);

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

async function testQueueOrder() {
  console.log("\n=== Test 4: 写入队列顺序 ===");
  console.log("测试目标: 验证写入按队列顺序执行");

  const tuneId = "tune_demo";
  const sectionIds = [];

  for (let i = 0; i < 5; i++) {
    const res = await request(`/tunes/${tuneId}/sections`, {
      method: "POST",
      body: {
        startBeat: 300 + i * 10,
        endBeat: 309 + i * 10,
        laneRange: "1-20",
        note: `顺序测试 #${i + 1}`
      }
    });
    if (res.status === 201) {
      sectionIds.push(res.body.data.id);
    }
  }

  const concurrentTasks = [];
  for (let i = 0; i < sectionIds.length; i++) {
    concurrentTasks.push(
      request(`/punch-tasks`, {
        method: "POST",
        body: {
          tuneId,
          sectionId: sectionIds[i],
          priority: "medium",
          assignee: `tester_${i}`
        }
      }).then(() =>
        request(`/punch-tasks/generate`, {
          method: "POST",
          body: { tuneId, sections: [sectionIds[i]] }
        })
      )
    );
  }

  await Promise.all(concurrentTasks);

  const healthRes = await request("/health");
  const pendingWrites = healthRes.body.writeQueue?.pendingWrites || 0;
  console.log(`队列中待处理写入: ${pendingWrites}`);

  await sleep(1000);

  const healthRes2 = await request("/health");
  const pendingWrites2 = healthRes2.body.writeQueue?.pendingWrites || 0;
  console.log(`1秒后队列中待处理写入: ${pendingWrites2}`);

  if (pendingWrites2 === 0) {
    console.log("✅ Test 4 PASSED: 队列正常处理");
    return { passed: true };
  } else {
    console.log("❌ Test 4 FAILED: 队列处理异常");
    return { passed: false };
  }
}

async function testCrossObjectAtomicity() {
  console.log("\n=== Test 5: 跨对象操作原子性 ===");
  console.log("测试目标: 验证创建版次并切换当前版次是原子的");

  const tuneId = "tune_demo";

  const beforeTuneRes = await request(`/tunes/${tuneId}`);
  const beforeCurrentEdition = beforeTuneRes.body.data.currentEditionId;
  console.log(`操作前当前版次: ${beforeCurrentEdition}`);

  const concurrentCount = 3;
  const requests = [];

  for (let i = 0; i < concurrentCount; i++) {
    requests.push(
      request(`/tunes/${tuneId}/editions`, {
        method: "POST",
        body: {
          description: `原子性测试版次 #${i + 1}`,
          setAsCurrent: true
        }
      })
    );
  }

  const results = await Promise.all(requests);

  const successResults = results.filter((r) => r.status === 201);
  console.log(`成功创建版次: ${successResults.length}`);

  const afterTuneRes = await request(`/tunes/${tuneId}`);
  const afterCurrentEdition = afterTuneRes.body.data.currentEditionId;
  console.log(`操作后当前版次: ${afterCurrentEdition}`);

  const editionsRes = await request(`/tunes/${tuneId}/editions`);
  const currentEdition = editionsRes.body.data.find((e) => e.isCurrent);

  const sectionsRes = await request(`/tunes/${tuneId}/sections`);
  const sections = sectionsRes.body.data;

  if (
    currentEdition &&
    currentEdition.id === afterCurrentEdition &&
    currentEdition.sectionsSnapshot.length === sections.length
  ) {
    console.log(
      "✅ Test 5 PASSED: 版次创建和切换是原子的，sections与snapshot一致"
    );
    return { passed: true };
  } else {
    console.log("❌ Test 5 FAILED: 版次切换非原子");
    return { passed: false };
  }
}

async function runAllTests() {
  console.log("========================================");
  console.log("并发写入验证测试");
  console.log("========================================");

  const health = await request("/health");
  console.log(`服务器状态: ${health.body.ok ? "正常" : "异常"}`);
  console.log(`数据版本: v${health.body.dataVersion}`);
  console.log(`缓存已加载: ${health.body.writeQueue?.cacheLoaded}`);

  const results = [];

  results.push(await testConcurrentSectionCreation());
  results.push(await testConcurrentEditionCreation());
  results.push(await testAtomicRollback());
  results.push(await testQueueOrder());
  results.push(await testCrossObjectAtomicity());

  console.log("\n========================================");
  console.log("测试结果汇总");
  console.log("========================================");

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log(`通过: ${passed}/${total}`);

  if (passed === total) {
    console.log("🎉 所有测试通过! 并发写入安全");
    process.exit(0);
  } else {
    console.log("⚠️  部分测试失败，请检查");
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("测试执行失败:", err.message);
  process.exit(1);
});
