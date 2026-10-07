import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fixture } from "./omp-fixture.mjs";

const docent = join(dirname(dirname(fileURLToPath(import.meta.url))), "bin/docent.mjs");
const doctor = (args, env) => new Promise((resolve) => {
	execFile(process.execPath, [docent, "doctor", ...args], { env: { ...process.env, ...env }, timeout: 60_000 }, (error, stdout) => resolve({ code: error?.code ?? 0, stdout }));
});

test("doctor reports a ready install with sessions and a real model probe, without exposing secrets", async (t) => {
	const f = await fixture(t);
	const port = new URL(f.address).port;
	const before = (await f.calls()).length;
	const { code, stdout } = await doctor(["--json", "--probe", "--port", port], { OMP_BIN: f.ompBin, TYPESAFE_API_KEY: "never-print-this-key" });
	const report = JSON.parse(stdout);
	assert.equal(code, 0);
	assert.equal(report.ok, true);
	assert.equal(report.omp.found, true);
	assert.equal(report.omp.chatModels, 2);
	assert.equal(report.server.running, true);
	assert.deepEqual(report.server.sessions, { claude: 1 });
	assert.equal(report.probe.ok, true);
	assert.equal(report.jev.configured, true);
	assert.deepEqual(report.next, []);
	assert.equal(stdout.includes("never-print-this-key"), false);
	assert.equal((await f.calls()).length - before, 1, "only --probe calls the model, exactly once");
});

test("doctor fails with next steps when omp is missing and the server is off", async () => {
	const { code, stdout } = await doctor(["--port", "1"], { OMP_BIN: "/nonexistent/omp" });
	assert.equal(code, 1);
	assert.match(stdout, /\[!!\] omp 없음/);
	assert.match(stdout, /omp를 설치하세요/);
	assert.match(stdout, /docent --no-open/);
});
