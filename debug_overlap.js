// 直接调试 detectConflictsForBatchSections 内部重叠逻辑
const fs = require('fs');
const path = require('path');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/db.json'), 'utf8'));

function makeId(p) { return p + '_test_' + Math.random().toString(36).slice(2, 8); }
function findTune(db, id) { return db.tunes.find(t => t.id === id); }
function parseScale(scale) { const m = String(scale).match(/(\d+)/); return m ? Number(m[1]) : null; }
function resolveTuneEdition(db, tuneId, editionId) {
  const tune = findTune(db, tuneId);
  const id = editionId || tune.currentEditionId || null;
  if (!id) return null;
  return db.tapeEditions.find(e => e.id === id) || null;
}
function parseLaneRange(lr) { const m = lr.match(/^(\d+)-(\d+)$/); return m ? { startLane: Number(m[1]), endLane: Number(m[2]) } : null; }
function checkOverlap(s1, s2) { return !(s1.endBeat < s2.startBeat || s2.endBeat < s1.startBeat); }
function buildConflict(type, severity, message, details) {
  return { type, severity, message, details, detectedAt: new Date().toISOString(), ...details };
}
function detectLaneRangeOutOfScale(section, maxLanes) {
  const lanes = parseLaneRange(section.laneRange);
  if (!lanes || !maxLanes) return null;
  if (lanes.startLane < 1 || lanes.endLane > maxLanes) {
    return buildConflict('lane_range_out_of_scale', 'error',
      `音轨范围 ${section.laneRange} 超出纸带规格 ${maxLanes} 音的能力范围`,
      { sectionId: section.id, laneRange: section.laneRange, startLane: lanes.startLane, endLane: lanes.endLane, maxLanes });
  }
  return null;
}
function detectSectionOverlap(section1, section2) {
  if (section1.id && section2.id && section1.id === section2.id) return null;
  const hasOverlap = checkOverlap(section1, section2);
  if (hasOverlap) {
    const lanes1 = parseLaneRange(section1.laneRange);
    const lanes2 = parseLaneRange(section2.laneRange);
    const laneOverlap = lanes1 && lanes2 && !(lanes1.endLane < lanes2.startLane || lanes2.endLane < lanes1.startLane);
    return buildConflict('section_overlap', 'error',
      `区间 ${section1.startBeat}-${section1.endBeat}(${section1.laneRange}) 与区间 ${section2.startBeat}-${section2.endBeat}(${section2.laneRange}) 存在${laneOverlap ? '完全' : '拍点'}重叠`,
      { section1: { id: section1.id, startBeat: section1.startBeat, endBeat: section1.endBeat, laneRange: section1.laneRange },
        section2: { id: section2.id, startBeat: section2.startBeat, endBeat: section2.endBeat, laneRange: section2.laneRange },
        laneOverlap });
  }
  return null;
}
function detectBeatGap(sections) {
  const conflicts = [];
  const sorted = [...sections].sort((a, b) => a.startBeat - b.startBeat);
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i], next = sorted[i + 1];
    if (current.endBeat + 1 < next.startBeat) {
      conflicts.push(buildConflict('beat_gap', 'warning',
        `区间 ${current.startBeat}-${current.endBeat} 与下一区间 ${next.startBeat}-${next.endBeat} 之间存在拍点断裂`,
        { sectionId: current.id, nextSectionId: next.id, gapStart: current.endBeat + 1, gapEnd: next.startBeat - 1, gapSize: next.startBeat - current.endBeat - 1 }));
    }
  }
  return conflicts;
}

const tuneId = 'tune_demo';
const tune = findTune(db, tuneId);
const maxLanes = parseScale(tune.stripSpec.scale);
const edition = resolveTuneEdition(db, tuneId, null);
const existingSections = edition ? edition.sectionsSnapshot : db.sections.filter(s => s.tuneId === tuneId);
console.log('existingSections from', edition ? 'edition.sectionsSnapshot' : 'db.sections', 'count:', existingSections.length);
console.log('existing:', existingSections.map(s => `${s.startBeat}-${s.endBeat}(${s.laneRange})`));

const newSections = [
  { id: makeId('section'), tuneId, startBeat: 200, endBeat: 210, laneRange: '1-30' },
  { id: makeId('section'), tuneId, startBeat: 110, endBeat: 120, laneRange: '1-10' },
  { id: makeId('section'), tuneId, startBeat: 115, endBeat: 125, laneRange: '1-10' },
  { id: makeId('section'), tuneId, startBeat: 140, endBeat: 150, laneRange: '1-10' },
];
console.log('newSections:', newSections.map(s => `${s.id}:${s.startBeat}-${s.endBeat}(${s.laneRange})`));

const errors = [];
const warnings = [];
const addConflict = (c) => { if (!c) return; if (c.severity === 'error') errors.push(c); else warnings.push(c); };

for (const s of newSections) addConflict(detectLaneRangeOutOfScale(s, maxLanes));

const allSections = [...existingSections];
for (let i = 0; i < newSections.length; i++) {
  const newS = newSections[i];
  console.log(`\n--- processing new section ${i} ${newS.startBeat}-${newS.endBeat}(${newS.laneRange}) ---`);
  for (const existing of existingSections) {
    const c = detectSectionOverlap(newS, existing);
    if (c) { console.log(`  overlap with existing ${existing.startBeat}-${existing.endBeat}(${existing.laneRange}):`, c.message); addConflict(c); }
  }
  for (let j = 0; j < i; j++) {
    const c = detectSectionOverlap(newS, newSections[j]);
    if (c) { console.log(`  overlap with new[${j}] ${newSections[j].startBeat}-${newSections[j].endBeat}(${newSections[j].laneRange}):`, c.message); addConflict(c); }
  }
  allSections.push(newS);
}

console.log('\n=== errors ===');
for (const e of errors) console.log(' ', e.type, ':', e.message);
console.log('\n=== warnings ===');
for (const w of warnings) console.log(' ', w.type, ':', w.message);
