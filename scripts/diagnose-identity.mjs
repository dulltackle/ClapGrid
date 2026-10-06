import { parseArgs } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import { readPluginIdentity } from './plugin-identity.mjs';

const unknown = (reason) => ({ status: 'unknown', reason });
const unreachable = (reason) => ({ status: 'unreachable', reason });
function identity(value) {
  if (value?.schemaVersion !== 1 || value.state !== 'known'
    || typeof value.contentFingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.contentFingerprint)
    || !['clean', 'dirty', 'unknown'].includes(value.source?.state)
    || !(value.source.commit === null || (typeof value.source.commit === 'string' && /^[a-f0-9]{40,64}$/.test(value.source.commit)))) return null;
  // 仅输出用于判定的定型字段，不转发接口中的路径、令牌或任意元数据。
  return { contentFingerprint: value.contentFingerprint,
    source: { commit: value.source.commit, state: value.source.state } };
}
function compare(value, reference) {
  const current = identity(value);
  if (!current) return unknown('缺少有效内容指纹');
  const base = identity(reference);
  if (!base) return { ...unknown('构建基准未知，无法比较'), identity: current };
  const match = current.contentFingerprint === base.contentFingerprint;
  return { status: match ? 'match' : 'mismatch', identity: current,
    comparedFields: ['contentFingerprint'], referenceFingerprint: base.contentFingerprint,
    reason: match ? '内容指纹一致' : '内容指纹不同' };
}
async function mcpEvidence(path, reference) {
  if (!path) return unknown('未提供宿主实际调用证据；不会启动替代 MCP');
  try {
    const evidence = JSON.parse(await readFile(path, 'utf8'));
    if (!['actual-host', 'controlled-test'].includes(evidence.source)) return unknown('证据来源无效');
    const timestamp = Date.parse(evidence.observedAt);
    if (!Number.isFinite(timestamp)) return unknown('证据采集时间无效');
    const ageSeconds = Math.floor((Date.now() - timestamp) / 1000);
    const provenance = { source: evidence.source, observedAt: new Date(timestamp).toISOString(), ageSeconds,
      live: false, scope: '仅表示留存调用时刻，不能证明当前宿主已重载' };
    if (ageSeconds < 0 || ageSeconds > 300) return { ...unknown('证据过期或来自未来，请重新调用宿主诊断'), ...provenance };
    if (evidence.status === 'unreachable') return { ...unreachable('留存证据记录宿主入口不可达'), ...provenance };
    if (evidence.status !== 'reachable') return { ...unknown('证据调用状态无效'), ...provenance };
    return { ...compare(evidence.response?.buildIdentity, reference), ...provenance };
  } catch { return unknown('证据文件不可读取或格式无效'); }
}
async function serviceIdentity(address, workspace, reference) {
  if (!address) return unknown('未指定现存服务地址；不会启动服务');
  let url;
  try {
    url = new URL(address);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') return unknown('仅接受不含凭据的本机 HTTP 服务根地址');
  } catch { return unknown('服务地址无效'); }
  if (!workspace) return unknown('须指定当前工作空间才能核对现存服务归属');
  let expected;
  try { expected = await realpath(workspace); } catch { return unknown('当前工作空间不可读取'); }
  try {
    const response = await fetch(new URL('/api/identity', url), { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return unreachable('现存服务身份接口未成功响应');
    const value = await response.json();
    if (value.application !== 'clapgrid' || value.workspace !== expected) return unknown('服务应用或工作空间归属不符；不会切换工作空间');
    return { ...compare(value.buildIdentity, reference), source: 'existing-service', observedAt: new Date().toISOString() };
  } catch { return unreachable('现存服务身份接口不可达或响应无效'); }
}
try {
  const { values } = parseArgs({ options: {
    build: { type: 'string', default: 'dist/plugin/clapgrid' }, installed: { type: 'string' },
    'mcp-evidence': { type: 'string' }, 'service-url': { type: 'string' }, workspace: { type: 'string' },
  } });
  const build = await readPluginIdentity(values.build);
  const installed = values.installed ? compare(await readPluginIdentity(values.installed), build) : unknown('未指定安装包目录');
  const mcp = await mcpEvidence(values['mcp-evidence'], build);
  const service = await serviceIdentity(values['service-url'], values.workspace, build);
  const nextSteps = [];
  if (installed.status === 'mismatch') nextSteps.push('确认目标构建后手动更新安装包，再重新核对。');
  if (mcp.status === 'mismatch') nextSteps.push('先核对安装包，再由用户重载插件，重新调用宿主 clapgrid_host_context 并留存证据。');
  if (mcp.status === 'unknown' || mcp.status === 'unreachable') nextSteps.push('从当前聊天实际宿主调用 clapgrid_host_context，保存调用时间和结构化结果；入口不可达时保留未验证。');
  if (service.status === 'mismatch') nextSteps.push('确认当前工作空间无运行任务后，由用户决定是否重启现存服务，再核对身份。');
  if (service.status === 'unreachable') nextSteps.push('核实现存服务地址；本命令不会启动服务。');
  console.log(JSON.stringify({ schemaVersion: 1, observedAt: new Date().toISOString(),
    build: { ...compare(build, build), role: 'reference' }, installed, mcp, service, nextSteps }, null, 2));
} catch {
  console.error('诊断参数无效。可用参数：--build --installed --mcp-evidence --workspace --service-url。');
  process.exitCode = 1;
}
