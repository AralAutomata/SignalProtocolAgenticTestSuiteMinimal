const relayUrl = Deno.env.get("RELAY_URL") ?? "http://relay:8080";
const intervalMs = Number(Deno.env.get("METRICS_INTERVAL_MS") ?? "10000");

type Metrics = {
  cpuPct: number;
  memPct: number;
  swapPct: number;
  netInBytes: number;
  netOutBytes: number;
  load: [number, number, number];
  updatedAt: number;
};

async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

function parseLoadavg(text: string): [number, number, number] {
  const parts = text.trim().split(/\s+/).slice(0, 3).map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function parseMeminfo(text: string): { memPct: number; swapPct: number } {
  const lines = text.split("\n");
  const values = new Map<string, number>();
  for (const line of lines) {
    const [key, rest] = line.split(":");
    if (!key || !rest) continue;
    const num = Number(rest.trim().split(/\s+/)[0]);
    values.set(key, Number.isFinite(num) ? num : 0);
  }
  const memTotal = values.get("MemTotal") ?? 0;
  const memAvailable = values.get("MemAvailable") ?? 0;
  const swapTotal = values.get("SwapTotal") ?? 0;
  const swapFree = values.get("SwapFree") ?? 0;
  const memUsed = memTotal > 0 ? memTotal - memAvailable : 0;
  const swapUsed = swapTotal > 0 ? swapTotal - swapFree : 0;
  const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
  const swapPct = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0;
  return { memPct, swapPct };
}

function parseNetDev(text: string): { netInBytes: number; netOutBytes: number } {
  const lines = text.trim().split("\n").slice(2);
  let rx = 0;
  let tx = 0;
  for (const line of lines) {
    const parts = line.trim().split(/[:\s]+/);
    const iface = parts[0];
    if (!iface || iface === "lo") continue;
    const rxBytes = Number(parts[1] ?? 0);
    const txBytes = Number(parts[9] ?? 0);
    rx += Number.isFinite(rxBytes) ? rxBytes : 0;
    tx += Number.isFinite(txBytes) ? txBytes : 0;
  }
  return { netInBytes: rx, netOutBytes: tx };
}

let lastCpu: { idle: number; total: number } | null = null;

function parseCpuStat(text: string): { idle: number; total: number } {
  const line = text.split("\n")[0] ?? "";
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const total = parts.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
  return { idle, total };
}

function computeCpuPct(prev: { idle: number; total: number }, next: { idle: number; total: number }): number {
  const idleDelta = next.idle - prev.idle;
  const totalDelta = next.total - prev.total;
  if (totalDelta <= 0) return 0;
  const used = totalDelta - idleDelta;
  return (used / totalDelta) * 100;
}

async function sampleMetrics(): Promise<Metrics> {
  const [meminfo, loadavg, netdev, cpuStat] = await Promise.all([
    readText("/proc/meminfo"),
    readText("/proc/loadavg"),
    readText("/proc/net/dev"),
    readText("/proc/stat")
  ]);

  const { memPct, swapPct } = parseMeminfo(meminfo);
  const { netInBytes, netOutBytes } = parseNetDev(netdev);
  const load = parseLoadavg(loadavg);
  const cpu = parseCpuStat(cpuStat);
  let cpuPct = 0;
  if (lastCpu) {
    cpuPct = computeCpuPct(lastCpu, cpu);
  }
  lastCpu = cpu;

  return {
    cpuPct,
    memPct,
    swapPct,
    netInBytes,
    netOutBytes,
    load,
    updatedAt: Date.now()
  };
}

async function postMetrics(metrics: Metrics): Promise<void> {
  await fetch(`${relayUrl}/diagnostics/metrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metrics)
  });
}

async function loop(): Promise<void> {
  while (true) {
    try {
      const metrics = await sampleMetrics();
      await postMetrics(metrics);
    } catch (err) {
      console.error(err);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

await loop();
