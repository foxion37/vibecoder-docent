import assert from "node:assert/strict";
import test from "node:test";
import { createHerdrReporter, resumeCommand } from "../app/terminal-herdr.mjs";

const inside = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2", HERDR_BIN_PATH: "/bin/herdr" };

function recorder() {
	const calls = [];
	const waiting = [];
	return {
		calls,
		run(bin, args) {
			calls.push({ bin, args });
			return new Promise((resolve) => waiting.push(resolve));
		},
		finishAll() { while (waiting.length) waiting.shift()(); return new Promise((resolve) => setImmediate(resolve)); },
	};
}
const flag = (args, name) => args[args.indexOf(name) + 1];

test("outside Herdr the reporter never runs the Herdr CLI", async () => {
	const r = recorder();
	for (const env of [{}, { HERDR_ENV: "1" }, { HERDR_ENV: "0", HERDR_PANE_ID: "w1:p2", HERDR_BIN_PATH: "/bin/herdr" }]) {
		const herdr = createHerdrReporter({ env, run: r.run });
		herdr.update("working", "설명");
		await herdr.release();
	}
	assert.equal(r.calls.length, 0);
});

test("state reports skip repeats, send only the latest pending state, and keep sequence numbers increasing", async () => {
	const r = recorder();
	let clock = 1000;
	const herdr = createHerdrReporter({ env: inside, run: r.run, now: () => clock });
	herdr.update("idle");
	herdr.update("idle");
	herdr.update("working", "질문을 살펴보는 중이에요");
	herdr.update("working", "설명을 쓰는 중이에요");
	assert.equal(r.calls.length, 1, "one report in flight at a time");
	await r.finishAll();
	await r.finishAll();
	assert.deepEqual(r.calls.map(({ args }) => [flag(args, "--state"), args.includes("--message") ? flag(args, "--message") : ""]), [["idle", ""], ["working", "설명을 쓰는 중이에요"]]);
	const first = r.calls[0].args;
	assert.equal(r.calls[0].bin, "/bin/herdr");
	assert.deepEqual(first.slice(0, 3), ["pane", "report-agent", "w1:p2"]);
	assert.equal(flag(first, "--source"), "vibecoder-docent");
	assert.equal(flag(first, "--agent"), "docent");
	assert.deepEqual(first.slice(first.indexOf("--") + 1), ["docent-tui"]);
	const seqs = r.calls.map(({ args }) => Number(flag(args, "--seq")));
	assert.ok(seqs[1] > seqs[0], "the clock did not move, but later reports must still win");
});

test("release clears the pane after the in-flight report and ignores later updates", async () => {
	const r = recorder();
	const herdr = createHerdrReporter({ env: inside, run: r.run });
	herdr.update("working", "설명을 쓰는 중이에요");
	const released = herdr.release();
	herdr.update("idle");
	await r.finishAll();
	await r.finishAll();
	await released;
	assert.deepEqual(r.calls.map(({ args }) => args[1]), ["report-agent", "release-agent"]);
	assert.ok(Number(flag(r.calls[1].args, "--seq")) > Number(flag(r.calls[0].args, "--seq")));
});

test("the resume command reconnects to a non-default server and rejects unsafe URLs", () => {
	assert.deepEqual(resumeCommand("http://127.0.0.1:4747"), ["docent-tui"]);
	assert.deepEqual(resumeCommand("https://mini.example.ts.net"), ["docent-tui", "--url", "https://mini.example.ts.net"]);
	assert.deepEqual(resumeCommand("http://x/'oops"), ["docent-tui"]);
});
