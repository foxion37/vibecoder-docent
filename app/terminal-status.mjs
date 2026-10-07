// 터미널 상태줄. 항목, 아이콘, 색, 우선순위는 docs/terminal-status-line.md 표를 그대로 옮긴다 (ADR 0040).
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { THINKING } from "./depth.mjs";

/** OMP unicode 기호 세트 기준. "도슨트 추가"는 OMP에 같은 뜻의 아이콘이 없는 항목이다. */
export const STATUS_ICONS = Object.freeze({
	unicode: Object.freeze({
		working: null, disconnected: "⚠", cancelling: "⏹",
		folder: "📁", session: "🆔", conversation: "📄", scroll: "↕",
		model: "⬢", depth: "🎯", answers: "💬", learning: "⏱", saved: "💾", favorites: "📌", profile: "👤",
		thinking: Object.freeze({ low: "◔ low", medium: "◑ med", high: "◒ high" }),
	}),
	ascii: Object.freeze({
		working: "*", disconnected: "!", cancelling: "[]",
		folder: "[D]", session: "id", conversation: "[C]", scroll: "^v",
		model: "[M]", depth: "d:", answers: "qa:", learning: "t:", saved: "sv:", favorites: "fav:", profile: "@",
		thinking: Object.freeze({ low: "low", medium: "med", high: "high" }),
	}),
});

/** row 1 = 위치, row 2 = 설명과 학습. priority 숫자가 클수록 좁은 화면에서 먼저 뺀다. role 은 terminal-theme 역할. */
export const STATUS_RULES = Object.freeze([
	{ id: "activity", row: 1, priority: 1, role: "title" },
	{ id: "folder", row: 1, priority: 2, role: "path" },
	{ id: "session", row: 1, priority: 4, role: "muted" },
	{ id: "conversation", row: 1, priority: 3, role: "text" },
	{ id: "scroll", row: 1, priority: 5, role: "dim" },
	{ id: "model", row: 2, priority: 1, role: "model" },
	{ id: "depth", row: 2, priority: 2, role: "label" },
	{ id: "answers", row: 2, priority: 3, role: "text" },
	{ id: "learning", row: 2, priority: 4, role: "muted" },
	{ id: "saved", row: 2, priority: 6, role: "muted" },
	{ id: "favorites", row: 2, priority: 5, role: "label" },
	{ id: "profile", row: 2, priority: 7, role: "muted" },
]);

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SEPARATOR = " • ";

export function statusSymbols(env = process.env) {
	const preset = String(env?.DOCENT_SYMBOLS ?? "").toLowerCase();
	if (preset === "ascii" || preset === "unicode") return preset;
	return String(env?.TERM ?? "").toLowerCase() === "dumb" ? "ascii" : "unicode";
}

/** 60초 미만 "N초", 1시간 미만 "N분", 그 이상 "N시간 M분". */
export function formatDuration(ms) {
	const seconds = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
	if (seconds < 60) return `${seconds}초`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}분`;
	const rest = minutes % 60;
	return `${Math.floor(minutes / 60)}시간${rest ? ` ${rest}분` : ""}`;
}

/** 한 세션의 문답 기록(같은 프로필)에서 상태줄 수치를 계산한다. */
export function statusMetrics(history, thread, favorites) {
	const rows = Array.isArray(history) ? history : [];
	const threads = new Set();
	let learningMs = 0;
	let current = 0;
	for (const row of rows) {
		const key = row.thread || "";
		threads.add(key);
		if (key === thread) current++;
		const ms = Number(row.answer?.ms);
		if (!row.auto && Number.isFinite(ms) && ms > 0) learningMs += ms;
	}
	return {
		current, total: rows.length, saved: threads.size, learningMs,
		favorites: Array.isArray(favorites) ? new Set(favorites.map((entry) => entry.thread)).size : null,
	};
}
/**
 * view: { ask, spinnerFrame, session, conversation, scroll, modelName, depth, profileName, metrics }
 * 반환: 규칙 순서대로 { id, row, priority, role, text } (보이는 항목만).
 */
export function statusSegments(view, symbols = "unicode") {
	const icons = STATUS_ICONS[symbols] ?? STATUS_ICONS.unicode;
	const depth = view.depth || "NORMAL";
	const thinking = icons.thinking[THINKING[depth]] ?? THINKING[depth] ?? "";
	const ask = view.ask;
	const values = {
		activity: !ask ? null
			: ask.disconnected ? { text: `${icons.disconnected} 연결 끊김`, role: "warning" }
				: ask.cancelling ? { text: `${icons.cancelling} 멈추는 중`, role: "warning" }
					: { text: `${icons.working ?? SPINNER[view.spinnerFrame % SPINNER.length]} ${formatDuration(Date.now() - (ask.startedAt ?? Date.now()))}` },
		folder: { text: view.session ? `${icons.folder} ${view.session.project || view.session.provider || "작업 폴더 없음"}` : `${icons.folder} 세션을 고르세요 (@ 입력)` },
		session: view.session ? { text: `${icons.session} ${view.session.title || view.session.id}` } : null,
		conversation: view.session ? { text: `${icons.conversation} ${view.conversation}` } : null,
		scroll: view.scroll ? { text: `${icons.scroll} ${view.scroll}` } : null,
		model: { text: `${icons.model} ${view.modelName} ${thinking}`.trimEnd() },
		depth: { text: `${icons.depth} ${depth}` },
		answers: { text: `${icons.answers} 문답 ${view.metrics.current}/${view.metrics.total}` },
		learning: { text: `${icons.learning} 학습 ${formatDuration(view.metrics.learningMs)}` },
		saved: { text: `${icons.saved} 대화 ${view.metrics.saved}` },
		favorites: view.metrics.favorites === null ? null : { text: `${icons.favorites} 즐겨찾기 ${view.metrics.favorites}` },
		profile: { text: `${icons.profile} ${view.profileName}` },
	};
	return STATUS_RULES.flatMap((rule) => {
		const value = values[rule.id];
		return value ? [{ ...rule, role: value.role ?? rule.role, text: value.text.replace(/\s+/g, " ") }] : [];
	});
}

/** 한 줄을 폭에 맞춘다. 넘치면 우선순위 숫자가 큰 항목부터 통째로 빼고, 마지막에만 줄임표로 자른다. */
export function renderStatusRow(segments, width, theme) {
	const columns = Math.max(1, width - 1);
	let kept = [...segments];
	const plainWidth = (list) => visibleWidth(` ${list.map((segment) => segment.text).join(SEPARATOR)}`);
	while (kept.length > 1 && plainWidth(kept) > columns) {
		const drop = kept.reduce((worst, segment) => (segment.priority >= worst.priority ? segment : worst));
		kept = kept.filter((segment) => segment !== drop);
	}
	const line = ` ${kept.map((segment) => theme.span(segment.role, segment.text)).join(theme.span("border", SEPARATOR))}`;
	return truncateToWidth(line, columns, "…");
}
