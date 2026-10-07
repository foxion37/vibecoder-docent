// Herdr agents 창에 도슨트 터미널을 알린다 (ADR 0043). Herdr 밖에서는 아무것도 하지 않는다.
// 공식 연동 방식: https://herdr.dev 의 "Add Herdr support to your agent" (report-agent / release-agent).
import { execFile } from "node:child_process";

export const HERDR_SOURCE = "vibecoder-docent";
export const HERDR_AGENT = "docent";
const DEFAULT_URL = "http://127.0.0.1:4747";

const runHerdr = (bin, args) => new Promise((resolve) => {
	const child = execFile(bin, args, { timeout: 2000 }, () => resolve());
	child.stdin?.end();
});

/** Herdr 재시작 뒤 같은 창에서 다시 띄울 명령. 첫 단어는 PATH 의 명령 이름, 작은따옴표와 제어 문자는 허용되지 않는다. */
export function resumeCommand(baseUrl) {
	const command = ["docent-tui"];
	if (baseUrl && baseUrl !== DEFAULT_URL && !/['\u0000-\u001f\u007f]/.test(baseUrl)) command.push("--url", baseUrl);
	return command;
}

/**
 * update(state, message): idle | working | blocked. 같은 값은 다시 보내지 않고, 보내는 중에 쌓인 변화는 마지막 것만 보낸다.
 * release(): 사용자가 종료할 때 창의 에이전트 표시를 지운다.
 */
export function createHerdrReporter({ env = process.env, baseUrl, run = runHerdr, now = Date.now } = {}) {
	const pane = env.HERDR_PANE_ID;
	const bin = env.HERDR_BIN_PATH;
	if (env.HERDR_ENV !== "1" || !pane || !bin) return { enabled: false, update() {}, release() { return Promise.resolve(); } };
	const resume = resumeCommand(baseUrl);
	let seq = 0;
	const nextSeq = () => (seq = Math.max(seq + 1, now()));
	let last = "";
	let pending = null;
	let flight = null;
	let released = false;

	function pump() {
		if (flight || !pending || released) return;
		const { state, message } = pending;
		pending = null;
		const args = ["pane", "report-agent", pane, "--source", HERDR_SOURCE, "--agent", HERDR_AGENT, "--state", state, "--seq", String(nextSeq())];
		if (message) args.push("--message", message);
		args.push("--", ...resume);
		flight = run(bin, args).catch(() => {}).finally(() => { flight = null; pump(); });
	}

	return {
		enabled: true,
		update(state, message = "") {
			const key = `${state}\n${message}`;
			if (released || key === last) return;
			last = key;
			pending = { state, message };
			pump();
		},
		async release() {
			if (released) return;
			released = true;
			pending = null;
			await flight;
			await run(bin, ["pane", "release-agent", pane, "--source", HERDR_SOURCE, "--agent", HERDR_AGENT, "--seq", String(nextSeq())]).catch(() => {});
		},
	};
}
