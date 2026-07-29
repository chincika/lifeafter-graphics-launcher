const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ProcessSchedulingService,
  normalizeProcessPolicies
} = require('./process-scheduling');
const { SettingsStore } = require('./settings-store');

const defaults = normalizeProcessPolicies({});
assert.equal(defaults['540p 25'].priority, 'idle');
assert.equal(defaults['540p 25'].cpuMode, 'efficiency');
assert.equal(defaults['2K 120'].priority, 'high');
assert.equal(defaults['2K 120'].cpuMode, 'all');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeafter-process-scheduling-'));
const store = new SettingsStore(path.join(temp, 'settings.json'));
const calls = [];
const topology = {
  ok: true,
  model: 'Test Hybrid CPU',
  physicalCoreCount: 2,
  logicalProcessorCount: 3,
  processorGroupCount: 1,
  heterogeneous: true,
  cpuSets: [
    { id: 100, group: 0, logicalProcessorIndex: 0, coreIndex: 0, coreType: 'performance' },
    { id: 101, group: 0, logicalProcessorIndex: 1, coreIndex: 0, coreType: 'performance' },
    { id: 102, group: 0, logicalProcessorIndex: 2, coreIndex: 2, coreType: 'efficiency' }
  ]
};

const runBackend = async args => {
  calls.push(args);
  if (args[0] === '--cpu-topology-json') {
    return { ok: true, text: JSON.stringify(topology) };
  }
  if (args[0] === '--apply-process-policy') {
    return {
      ok: true,
      text: JSON.stringify({
        ok: true,
        pid: Number(args[1]),
        priority: args[2],
        cpuSetIds: args[3] === '-' ? [] : args[3].split(',').map(Number)
      })
    };
  }
  return { ok: false, error: 'unexpected command' };
};

(async () => {
  const service = new ProcessSchedulingService({ runBackend, settingsStore: store });
  const saved = service.savePolicy('1080p 60', {
    priority: 'aboveNormal',
    cpuMode: 'custom',
    cpuSetIds: [101, 102]
  });
  assert.equal(saved.ok, true);
  assert.deepEqual(store.get().processPolicies['1080p 60'], {
    priority: 'aboveNormal',
    cpuMode: 'custom',
    cpuSetIds: [101, 102]
  });
  assert.equal(store.get().processPolicies['540p 25'].priority, 'idle');

  service.queueLaunch('540p 25', [10]);
  const changed = await service.handleSnapshot({
    capturedAt: Date.now(),
    instances: [
      { pid: 10, runningSeconds: 300 },
      { pid: 20, runningSeconds: 2 }
    ]
  });
  assert.equal(changed, true);
  const applyCall = calls.find(args => args[0] === '--apply-process-policy');
  assert.deepEqual(applyCall, ['--apply-process-policy', '20', 'idle', '102']);

  service.queueLaunch('2K 120', [20]);
  const highFrameChanged = await service.handleSnapshot({
    capturedAt: Date.now(),
    instances: [
      { pid: 20, runningSeconds: 300 },
      { pid: 30, runningSeconds: 2 }
    ]
  });
  assert.equal(highFrameChanged, true);
  const highFrameApplyCall = calls.filter(args => args[0] === '--apply-process-policy').at(-1);
  assert.deepEqual(highFrameApplyCall, ['--apply-process-policy', '30', 'high', '100,101,102']);

  const decorated = service.decorateSnapshot({
    capturedAt: Date.now(),
    instances: [{ pid: 20 }]
  });
  assert.equal(decorated.instances[0].scheduling.preset, '540p 25');
  assert.equal(decorated.instances[0].scheduling.priorityLabel, '低');
  assert.equal(decorated.instances[0].scheduling.cpuModeLabel, '能效核心');

  fs.rmSync(temp, { recursive: true, force: true });
  process.stdout.write('process-scheduling tests passed\n');
})().catch(error => {
  fs.rmSync(temp, { recursive: true, force: true });
  throw error;
});
