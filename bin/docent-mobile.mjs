#!/usr/bin/env node
// Explicit operator command: never enable network sharing on app startup.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config as loadConfig } from '../app/store.mjs';
const exec = promisify(execFile);
const args = process.argv.slice(2);
const usage = '사용법: docent-mobile [--port 4747] [--enable]\n기본은 연결 상태만 확인해요. --enable은 Tailscale Serve의 HTTPS 공유를 켜요.\n휴대폰에도 같은 사설망의 Tailscale이 필요해요. 공개 Funnel은 사용하지 않아요.';
if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0); }
try {
  let port = Number(process.env.DOCENT_PORT ?? (await loadConfig()).port ?? 4747), enable = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = Number(args[++i]);
    else if (args[i] === '--enable') enable = true;
    else throw new Error(`알 수 없는 옵션: ${args[i]}\n${usage}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('포트는 1에서 65535 사이 정수여야 해요.');
  const target = `http://127.0.0.1:${port}`;
  const response = await fetch(`${target}/api/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!response?.ok || (await response.json()).app !== 'vibecoder-docent') throw new Error(`먼저 docent --no-open --port ${port} 명령으로 도슨트를 켜세요.`);
  const tailscale = process.env.TAILSCALE_BIN || 'tailscale';
  const run = async (flags) => (await exec(tailscale, flags, { timeout: 20000, maxBuffer: 1024 * 1024 })).stdout;
  const status = JSON.parse(await run(['status', '--json']));
  if (status.BackendState !== 'Running' || !status.Self?.DNSName) throw new Error('Tailscale에 로그인하고 MagicDNS를 켠 뒤 다시 실행하세요.');
  const dns = status.Self.DNSName.replace(/\.$/, '');
  const authority = `${dns}:443`;
  const config = JSON.parse(await run(['serve', 'status', '--json']));
  if (Object.values(config.AllowFunnel ?? {}).some(Boolean)) throw new Error('공개 Funnel이 켜져 있어요. 공개 노출을 먼저 해제해야 도슨트를 공유할 수 있어요.');
  const handler = config.Web?.[authority]?.Handlers?.['/'];
  const matches = handler?.Proxy?.replace(/\/$/, '') === target;
  if (handler && !matches) throw new Error('이 HTTPS 주소는 다른 서비스가 사용 중이에요. 기존 설정을 덮어쓰지 않았어요.');
  if (!matches && Object.keys(config.TCP ?? {}).includes('443')) throw new Error('443 포트에 기존 공유 설정이 있어요. 기존 설정을 덮어쓰지 않았어요.');
  if (!matches && enable) {
    await run(['serve', '--bg', '--https=443', target]);
    const verified = JSON.parse(await run(['serve', 'status', '--json']));
    if (verified.Web?.[authority]?.Handlers?.['/']?.Proxy?.replace(/\/$/, '') !== target || Object.values(verified.AllowFunnel ?? {}).some(Boolean)) throw new Error('사설 HTTPS 공유 설정을 확인하지 못했어요. tailscale serve status로 확인하세요.');
    console.log('Tailscale 사설 HTTPS 공유를 켰어요.');
  } else if (!matches) {
    console.log(`HTTPS 공유가 아직 꺼져 있어요. 켜려면 docent-mobile --port ${port} --enable을 실행하세요.`);
    process.exit(0);
  }
  console.log(`휴대폰에서 열 주소: https://${dns}/\nSafari 공유 메뉴 또는 Chrome 메뉴에서 홈 화면에 추가하세요.\n컴퓨터와 도슨트가 켜져 있어야 해요. 공유를 끄려면 tailscale serve --https=443 off를 실행하세요.`);
} catch (error) {
  console.error(`docent-mobile: ${error.code === 'ENOENT' ? 'Tailscale 명령을 찾지 못했어요. Tailscale CLI를 설치하거나 TAILSCALE_BIN을 지정하세요.' : error.message}`);
  process.exitCode = 1;
}
