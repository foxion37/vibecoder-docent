import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createTerminalTheme } from "../app/terminal-theme.mjs";
import { formatDuration, renderStatusRow, statusMetrics, statusSegments, statusSymbols } from "../app/terminal-status.mjs";

const theme = createTerminalTheme({ COLORTERM: "truecolor" });
const history = [
	{ thread: "", answer: { ms: 30_000 } },
	{ thread: "", auto: true, answer: { ms: 600_000 } },
	{ thread: "card-a", answer: { ms: 95_000 } },
	{ thread: "card-a", answer: {} },
	{ thread: "card-b", answer: { ms: 5_000 } },
];
const view = (overrides = {}) => ({
	ask: null, spinnerFrame: 0, scroll: "",
	session: { title: "결제 화면 만들기", project: "shop-app", provider: "claude" },
	conversation: "결제 수단 계획", modelName: "Opus 5.5", depth: "HARD", profileName: "기본",
	metrics: statusMetrics(history, "card-a", [{ thread: "card-a" }, { thread: "card-a" }, { thread: "" }]),
	...overrides,
});

test("status metrics count the current thread, saved threads, favorites, and only measured manual learning time", () => {
	const metrics = statusMetrics(history, "card-a", [{ thread: "card-a" }, { thread: "card-a" }, { thread: "" }]);
	assert.deepEqual(metrics, { current: 2, total: 5, saved: 3, learningMs: 130_000, favorites: 2 });
	assert.equal(formatDuration(metrics.learningMs), "2분");
	assert.equal(formatDuration(59_999), "59초");
	assert.equal(formatDuration(3_780_000), "1시간 3분");
});

test("status line shows each rule's icon and the server's thinking level for the explanation depth", () => {
	const segments = statusSegments(view());
	const text = Object.fromEntries(segments.map((segment) => [segment.id, segment.text]));
	assert.equal(text.model, "⬢ Opus 5.5 ◑ med");
	assert.equal(text.depth, "🎯 HARD");
	assert.equal(text.answers, "💬 문답 2/5");
	assert.equal(text.learning, "⏱ 학습 2분");
	assert.equal(text.saved, "💾 대화 3");
	assert.equal(text.favorites, "📌 즐겨찾기 2");
	assert.equal(statusSegments(view({ depth: "EASY" })).find((segment) => segment.id === "model").text, "⬢ Opus 5.5 ◔ low");
	assert.equal(statusSegments(view({ metrics: { ...view().metrics, favorites: null } })).some((segment) => segment.id === "favorites"), false, "an unknown favorites count must not be shown as 0");
});

test("a narrow status row drops the lowest-priority items whole, keeps order, and never exceeds the width", () => {
	const row = statusSegments(view()).filter((segment) => segment.row === 2);
	const full = stripVTControlCharacters(renderStatusRow(row, 200, theme));
	assert.ok(full.includes("👤 기본"));
	const narrow = stripVTControlCharacters(renderStatusRow(row, 60, theme));
	assert.ok(visibleWidth(narrow) <= 59, narrow);
	assert.ok(narrow.includes("⬢ Opus 5.5") && narrow.includes("🎯 HARD"), narrow);
	assert.equal(narrow.includes("👤"), false, "profile has the lowest priority and leaves first");
	assert.ok(narrow.indexOf("⬢") < narrow.indexOf("🎯"), "remaining items keep their rule order");
	assert.ok(visibleWidth(stripVTControlCharacters(renderStatusRow(row, 12, theme))) <= 11);
});

test("dumb terminals and DOCENT_SYMBOLS=ascii switch to ASCII icons while colors stay a separate choice", () => {
	assert.equal(statusSymbols({ TERM: "dumb" }), "ascii");
	assert.equal(statusSymbols({ TERM: "xterm-256color", DOCENT_SYMBOLS: "ascii" }), "ascii");
	assert.equal(statusSymbols({ TERM: "xterm-ghostty", NO_COLOR: "" }), "unicode");
	const text = statusSegments(view(), "ascii").map((segment) => segment.text).join(" ");
	assert.doesNotMatch(text, /[^\x20-\x7e가-힣ㄱ-ㅎ]/u, text);
	assert.ok(text.includes("[M] Opus 5.5 med"), text);
});
