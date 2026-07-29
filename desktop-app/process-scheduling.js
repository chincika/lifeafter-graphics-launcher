const PRESET_NAMES = Object.freeze([
  '2K 120',
  '1080p 120',
  '1080p 60',
  '900p 120',
  '900p 60',
  '720p 60',
  '540p 60',
  '540p 25'
]);

const PRIORITIES = Object.freeze(['idle', 'belowNormal', 'normal', 'aboveNormal', 'high']);
const CPU_MODES = Object.freeze(['system', 'all', 'performance', 'efficiency', 'custom']);

const DEFAULT_PROCESS_POLICIES = Object.freeze({
  '2K 120': Object.freeze({ priority: 'high', cpuMode: 'all', cpuSetIds: [] }),
  '1080p 120': Object.freeze({ priority: 'high', cpuMode: 'all', cpuSetIds: [] }),
  '1080p 60': Object.freeze({ priority: 'normal', cpuMode: 'system', cpuSetIds: [] }),
  '900p 120': Object.freeze({ priority: 'high', cpuMode: 'all', cpuSetIds: [] }),
  '900p 60': Object.freeze({ priority: 'normal', cpuMode: 'system', cpuSetIds: [] }),
  '720p 60': Object.freeze({ priority: 'normal', cpuMode: 'system', cpuSetIds: [] }),
  '540p 60': Object.freeze({ priority: 'normal', cpuMode: 'system', cpuSetIds: [] }),
  '540p 25': Object.freeze({ priority: 'idle', cpuMode: 'efficiency', cpuSetIds: [] })
});

const PRIORITY_LABELS = Object.freeze({
  idle: '低',
  belowNormal: '低于正常',
  normal: '正常',
  aboveNormal: '高于正常',
  high: '高'
});

const CPU_MODE_LABELS = Object.freeze({
  system: '系统管理',
  all: '全部核心',
  performance: '性能核心',
  efficiency: '能效核心',
  custom: '自定义'
});

function normalizeCpuSetIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => Number(item))
    .filter(item => Number.isInteger(item) && item >= 0 && item <= 0xffffffff))]
    .sort((left, right) => left - right)
    .slice(0, 256);
}

function normalizeProcessPolicy(value, fallback = DEFAULT_PROCESS_POLICIES['540p 60']) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    priority: PRIORITIES.includes(source.priority) ? source.priority : fallback.priority,
    cpuMode: CPU_MODES.includes(source.cpuMode) ? source.cpuMode : fallback.cpuMode,
    cpuSetIds: normalizeCpuSetIds(source.cpuSetIds)
  };
}

function normalizeProcessPolicies(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(PRESET_NAMES.map(name => [
    name,
    normalizeProcessPolicy(source[name], DEFAULT_PROCESS_POLICIES[name])
  ]));
}

function publicPolicy(policy) {
  const normalized = normalizeProcessPolicy(policy);
  return {
    ...normalized,
    priorityLabel: PRIORITY_LABELS[normalized.priority],
    cpuModeLabel: CPU_MODE_LABELS[normalized.cpuMode]
  };
}

class ProcessSchedulingService {
  constructor(options) {
    this.runBackend = options.runBackend;
    this.settingsStore = options.settingsStore;
    this.topology = null;
    this.pending = [];
    this.applied = new Map();
    this.applyInFlight = new Set();
  }

  async loadTopology(force = false) {
    if (this.topology && !force) return this.topology;
    const result = await this.runBackend(['--cpu-topology-json'], 10000);
    if (!result?.ok) {
      this.topology = {
        ok: false,
        model: '未能读取 CPU 拓扑',
        physicalCoreCount: 0,
        logicalProcessorCount: 0,
        heterogeneous: false,
        cpuSets: [],
        error: result?.error || 'CPU 拓扑检测失败'
      };
      return this.topology;
    }
    try {
      const parsed = JSON.parse(result.text);
      parsed.cpuSets = Array.isArray(parsed.cpuSets) ? parsed.cpuSets : [];
      this.topology = parsed;
    } catch (error) {
      this.topology = {
        ok: false,
        model: '未能读取 CPU 拓扑',
        physicalCoreCount: 0,
        logicalProcessorCount: 0,
        heterogeneous: false,
        cpuSets: [],
        error: `CPU 拓扑数据解析失败：${error.message}`
      };
    }
    return this.topology;
  }

  async getState() {
    return {
      topology: await this.loadTopology(),
      policies: this.settingsStore.get().processPolicies
    };
  }

  savePolicy(preset, policy) {
    if (!PRESET_NAMES.includes(preset)) {
      return { ok: false, error: '未知画质预设' };
    }
    const current = this.settingsStore.get().processPolicies;
    const normalized = normalizeProcessPolicy(policy, DEFAULT_PROCESS_POLICIES[preset]);
    const processPolicies = normalizeProcessPolicies({
      ...current,
      [preset]: normalized
    });
    this.settingsStore.update({ processPolicies });
    return { ok: true, preset, policy: publicPolicy(processPolicies[preset]) };
  }

  queueLaunch(preset, existingPids) {
    if (!PRESET_NAMES.includes(preset)) return;
    const policy = this.settingsStore.get().processPolicies[preset];
    this.pending.push({
      preset,
      policy,
      existingPids: new Set((existingPids || []).map(Number)),
      createdAt: Date.now(),
      expiresAt: Date.now() + 120000
    });
    if (this.pending.length > 8) this.pending.splice(0, this.pending.length - 8);
  }

  resolveCpuSetIds(policy) {
    const available = this.topology?.cpuSets || [];
    if (policy.cpuMode === 'system') return [];
    if (policy.cpuMode === 'all') {
      return available
        .map(item => Number(item.id))
        .filter(Number.isInteger);
    }
    if (policy.cpuMode === 'custom') {
      const valid = new Set(available.map(item => Number(item.id)));
      return normalizeCpuSetIds(policy.cpuSetIds).filter(id => valid.has(id));
    }
    return available
      .filter(item => item.coreType === policy.cpuMode)
      .map(item => Number(item.id))
      .filter(Number.isInteger);
  }

  effectivePolicy(policy) {
    if (
      (policy.cpuMode === 'performance' || policy.cpuMode === 'efficiency') &&
      !this.resolveCpuSetIds(policy).length
    ) {
      return { ...policy, cpuMode: 'system', cpuSetIds: [] };
    }
    return policy;
  }

  async handleSnapshot(snapshot) {
    const instances = Array.isArray(snapshot?.instances) ? snapshot.instances : [];
    const active = new Set(instances.map(item => Number(item.pid)));
    for (const pid of this.applied.keys()) {
      if (!active.has(pid)) this.applied.delete(pid);
    }
    this.pending = this.pending.filter(item => item.expiresAt > Date.now());
    if (!this.pending.length || !instances.length) return false;
    await this.loadTopology();

    let changed = false;
    for (const intent of [...this.pending]) {
      const candidate = instances
        .filter(item => {
          const pid = Number(item.pid);
          return pid > 0 &&
            !intent.existingPids.has(pid) &&
            !this.applied.has(pid) &&
            !this.applyInFlight.has(pid);
        })
        .sort((left, right) =>
          Number(left.runningSeconds || 0) - Number(right.runningSeconds || 0))[0];
      if (!candidate) continue;

      const pid = Number(candidate.pid);
      this.applyInFlight.add(pid);
      const effectivePolicy = this.effectivePolicy(intent.policy);
      const cpuSetIds = this.resolveCpuSetIds(effectivePolicy);
      const cpuArgument = cpuSetIds.length ? cpuSetIds.join(',') : '-';
      const result = await this.runBackend([
        '--apply-process-policy',
        String(pid),
        effectivePolicy.priority,
        cpuArgument
      ], 10000);
      this.applyInFlight.delete(pid);
      this.pending = this.pending.filter(item => item !== intent);

      if (result?.ok) {
        let applied = {};
        try { applied = JSON.parse(result.text); } catch { }
        this.applied.set(pid, {
          preset: intent.preset,
          ...publicPolicy(effectivePolicy),
          cpuSetIds,
          appliedAt: Date.now(),
          ok: true,
          ...applied
        });
        changed = true;
      } else {
        this.applied.set(pid, {
          preset: intent.preset,
          ...publicPolicy(effectivePolicy),
          cpuSetIds,
          appliedAt: Date.now(),
          ok: false,
          error: result?.error || '进程调度应用失败'
        });
        changed = true;
      }
    }
    return changed;
  }

  decorateSnapshot(snapshot) {
    return {
      ...(snapshot || {}),
      instances: (snapshot?.instances || []).map(item => ({
        ...item,
        scheduling: this.applied.get(Number(item.pid)) || null
      }))
    };
  }
}

module.exports = {
  CPU_MODE_LABELS,
  CPU_MODES,
  DEFAULT_PROCESS_POLICIES,
  PRESET_NAMES,
  PRIORITIES,
  PRIORITY_LABELS,
  ProcessSchedulingService,
  normalizeProcessPolicies,
  normalizeProcessPolicy,
  publicPolicy
};
