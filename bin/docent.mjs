#!/usr/bin/env node
// `docent` — 웹앱을 켜고 브라우저를 연다. 이미 켜져 있으면 브라우저만 연다.
// 옵션: --no-open, --port N, --host <ip|tailscale>, --peer 이름=URL (반복 가능). ~/.docent/config.json 의 host/peers/port 가 기본값.
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.includes("-v") || args.includes("--version")) {
	const { readFileSync } = await import("node:fs");
	console.log(JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")).version);
	process.exit(0);
}
if (args[0] === "doctor") {
	const rest = args.slice(1);
	const unknown = rest.find((arg, i) => !["--json", "--probe", "--port"].includes(arg) && rest[i - 1] !== "--port");
	if (unknown) {
		console.error(`docent doctor: 알 수 없는 옵션이에요: ${unknown}\nusage: docent doctor [--json] [--probe] [--port N]`);
		process.exit(2);
	}
	const { diagnose, formatReport } = await import("../app/doctor.mjs");
	const { config } = await import("../app/store.mjs");
	const portArg = rest.includes("--port") ? Number(rest[rest.indexOf("--port") + 1]) : Number(process.env.DOCENT_PORT ?? (await config()).port ?? 4747);
	if (!Number.isInteger(portArg) || portArg < 1 || portArg > 65535) {
		console.error("docent doctor: 포트는 1에서 65535 사이 정수여야 해요.");
		process.exit(2);
	}
	const report = await diagnose({ port: portArg, probe: rest.includes("--probe") });
	console.log(rest.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
	process.exit(report.ok ? 0 : 1);
}
if (args[0] === "herdr") {
	const rest = args.slice(1);
	const value = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
	const known = new Set(["--session", "--session-file", "--cwd", "--port"]);
	const unknown = rest.find((arg, i) => !known.has(arg) && !known.has(rest[i - 1]));
	if (unknown || [...known].some((name) => rest.includes(name) && !value(name))) {
		console.error(`docent herdr: ${unknown ? `알 수 없는 옵션이에요: ${unknown}` : "옵션 뒤에 값이 필요해요."}\nusage: docent herdr [--session <id> | --session-file <경로>] [--cwd <폴더>] [--port N]`);
		process.exit(2);
	}
	const { launchInHerdr } = await import("../app/herdr-launch.mjs");
	const { config } = await import("../app/store.mjs");
	try {
		const result = await launchInHerdr({
			port: Number(value("--port") ?? process.env.DOCENT_PORT ?? (await config()).port ?? 4747),
			session: value("--session") ?? null,
			sessionFile: value("--session-file") ?? null,
			cwd: value("--cwd") ?? process.cwd(),
		});
		const where = result.session ? `세션 ${result.session}` : "세션 목록";
		console.log(result.action === "focused"
			? `이미 열린 도슨트 창(${result.pane})으로 이동했어요.`
			: `오른쪽 창(${result.pane})에 도슨트를 띄웠어요. ${where}을 열어요.${result.startedServer ? " 꺼져 있던 서버도 켰어요." : ""}`);
		process.exit(0);
	} catch (error) {
		console.error(`docent herdr: ${error.message}`);
		process.exit(error.code === "NOT_HERDR" ? 2 : 1);
	}
}
if (args.includes("-h") || args.includes("--help")) {
	console.log(
		[
			"usage: docent [--no-open] [--port N] [--host <ip|tailscale>] [--peer 이름=URL ...]",
			"       docent doctor [--json] [--probe] [--port N]   설치 상태 점검. --probe 는 모델을 한 번 불러 로그인까지 확인",
			"       docent herdr [--session <id> | --session-file <경로>]   Herdr 창 오른쪽에 도슨트 터미널을 띄움",
			"  --host tailscale     이 컴퓨터의 테일스케일 주소에도 열어 다른 컴퓨터의 docent 가 읽어 가게 한다",
			"  --peer book=http://peer-host.example:4747   그 컴퓨터의 세션을 내 목록에 합친다",
			"  ~/.docent/config.json  {\"host\":\"tailscale\",\"peers\":{\"book\":\"http://peer-host.example:4747\"}}",
			"  TYPESAFE_API_KEY     (선택) Jev 판정 사용",
			"  docent-tui [--url URL]  Ghostty, Kaku 등에서 터미널 화면으로 연결",
			"  docent-mobile [--enable]  모바일 PWA용 Tailscale 사설 HTTPS 연결 확인",
		].join("\n"),
	);
	process.exit(0);
}
const flag = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.DOCENT_PORT ?? 4747);
const url = `http://127.0.0.1:${port}/`;
const openBrowser = !args.includes("--no-open");
if (flag("--host")) process.env.DOCENT_HOST = flag("--host");
const peers = args.flatMap((a, i) => (a === "--peer" && args[i + 1] ? [args[i + 1]] : []));
if (peers.length) process.env.DOCENT_PEERS = [process.env.DOCENT_PEERS, ...peers].filter(Boolean).join(",");

// Windows 의 start 는 명령이 아니라 cmd 의 내장 명령이므로 cmd 로 부른다.
const openers = { darwin: ["open"], win32: ["cmd", "/c", "start", ""], linux: ["xdg-open"] };
const opener = openers[process.platform];
const open = () => {
  if (!openBrowser || !opener) return;
  execFile(opener[0], [...opener.slice(1), url], () => {});
};

const alive = await fetch(`${url}api/sessions`).then((r) => r.ok).catch(() => false);
if (alive) {
	console.log(`docent: 이미 켜져 있어요 → ${url}`);
	open();
	process.exit(0);
}

const missing = await new Promise((res) => execFile(process.env.OMP_BIN ?? "omp", ["--version"], (err) => res(Boolean(err))));
if (missing) {
	console.error("docent: omp 를 찾을 수 없어요. 도슨트는 설치된 omp 로 답을 만들어요. https://omp.sh 에서 설치하고 로그인한 뒤 다시 실행하세요.");
	process.exit(1);
}

process.env.DOCENT_PORT = String(port);
process.env.DOCENT_ON_LISTEN = openBrowser ? "open" : "";
await import(resolve(dirname(fileURLToPath(import.meta.url)), "../app/server.mjs"));
