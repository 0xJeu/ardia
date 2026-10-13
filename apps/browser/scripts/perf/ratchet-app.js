const P = globalThis.acPerf;
const bench = globalThis.acBench;
if (!P || !bench) throw new Error("load bench-app.js first (and turn the perf probe on)");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);

const extra = {
  async launch({ quietMs = 2500, timeoutMs = 30000 } = {}) {
    const state = () => {
      const s = P.read();
      return `${s.commits}:${sum(s.storeUpdates)}:${sum(s.writes)}`;
    };
    const end = Date.now() + timeoutMs;
    let last = state();
    let since = Date.now();
    while (Date.now() < end) {
      await sleep(250);
      const now = state();
      if (now !== last) {
        last = now;
        since = Date.now();
      } else if (Date.now() - since >= quietMs) break;
    }
    return { stats: P.read(), settled: Date.now() < end, firstCommitMounts: P.firstCommitMounts ?? null };
  },
};

bench.names.push(...Object.keys(extra));
const run = bench.run;
bench.run = (name, options) => (name in extra ? extra[name](options ?? {}) : run(name, options));
return bench.names;
