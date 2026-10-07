import { terminalSafeText } from "./terminal-input.mjs";

export class TerminalApiError extends Error {
	constructor(message, status = 0) {
		super(message);
		this.name = "TerminalApiError";
		this.status = status;
	}
}

function apiMessage(value, fallback) {
	if (value && typeof value === "object" && typeof value.error === "string" && value.error.trim()) return value.error;
	if (typeof value === "string" && value.trim()) return value;
	return fallback;
}

export class TerminalClient {
	constructor(baseUrl, fetchImpl = globalThis.fetch) {
		if (typeof fetchImpl !== "function") throw new Error("이 Node.js 에서는 fetch 를 사용할 수 없어요.");
		this.baseUrl = String(baseUrl).replace(/\/+$/, "");
		this.fetch = fetchImpl;
	}

	url(path) {
		return new URL(String(path).replace(/^\/+/, ""), `${this.baseUrl}/`);
	}

	async responseError(response, fallback) {
		const raw = await response.text().catch(() => "");
		let value = raw;
		try { value = raw ? JSON.parse(raw) : null; } catch {}
		return new TerminalApiError(`${apiMessage(value, fallback)} (HTTP ${response.status})`, response.status);
	}

	async json(path, { method = "GET", body, signal } = {}) {
		let response;
		try {
			response = await this.fetch(this.url(path), {
				method,
				headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal,
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			throw new TerminalApiError(terminalSafeText(error?.message || "연결할 수 없어요."));
		}
		if (!response.ok) throw await this.responseError(response, "도슨트 서버가 요청을 처리하지 못했어요.");
		try { return await response.json(); }
		catch { throw new TerminalApiError(`서버 응답을 읽을 수 없어요 (${response.status}).`, response.status); }
	}

	profiles(signal) { return this.json("/api/profiles", { signal }); }
	sessions(signal) { return this.json("/api/sessions", { signal }); }
	models(signal) { return this.json("/api/models", { signal }); }
	updateProfile(id, patch) { return this.json(`/api/profiles/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }); }
	favorites(sessionId, profileId, signal) {
		const query = new URLSearchParams({ profileId, id: sessionId });
		return this.json(`/api/favorites?${query}`, { signal });
	}

	history(sessionId, profileId, signal) {
		const query = new URLSearchParams({ id: sessionId, profileId });
		return this.json(`/api/history?${query}`, { signal });
	}
	jobs(sessionId, profileId, signal) {
		const query = new URLSearchParams({ id: sessionId, profileId });
		return this.json(`/api/jobs?${query}`, { signal });
	}


	async events(sessionId, profileId, signal, onEvent) {
		const query = new URLSearchParams({ id: sessionId, profileId });
		let response;
		try {
			response = await this.fetch(this.url(`/api/live?${query}`), { headers: { accept: "text/event-stream" }, signal });
		} catch (error) {
			if (signal?.aborted) return;
			throw new TerminalApiError(terminalSafeText(error?.message || "실시간 연결을 열 수 없어요."));
		}
		if (!response.ok) throw await this.responseError(response, "실시간 기록을 열 수 없어요.");
		if (!response.body) throw new TerminalApiError("실시간 응답 본문이 비어 있어요.");

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "", data = [];
		const dispatch = () => {
			if (!data.length) return;
			const payload = data.join("\n");
			data = [];
			try { onEvent(JSON.parse(payload)); }
			catch (error) {
				if (error instanceof SyntaxError) return;
				throw error;
			}
		};
		const line = (value) => {
			const text = value.endsWith("\r") ? value.slice(0, -1) : value;
			if (!text) { dispatch(); return; }
			if (text[0] === ":") return;
			const colon = text.indexOf(":");
			const field = colon < 0 ? text : text.slice(0, colon);
			if (field === "data") data.push(colon < 0 ? "" : text.slice(colon + (text[colon + 1] === " " ? 2 : 1)));
		};
		try {
			for (;;) {
				const { done, value } = await reader.read();
				buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
				let offset;
				while ((offset = buffer.indexOf("\n")) >= 0) {
					line(buffer.slice(0, offset));
					buffer = buffer.slice(offset + 1);
				}
				if (done) break;
			}
			if (buffer) line(buffer);
			dispatch();
		} finally {
			reader.releaseLock();
		}
	}

	async ask(body, signal, onEvent) {
		let response;
		try {
			response = await this.fetch(this.url("/api/ask"), {
				method: "POST",
				headers: { "content-type": "application/json", accept: "application/x-ndjson" },
				body: JSON.stringify(body),
				signal,
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			throw new TerminalApiError(terminalSafeText(error?.message || "설명 요청을 전송하지 못했어요."));
		}
		if (!response.ok) throw await this.responseError(response, "설명 요청을 처리하지 못했어요.");
		if (!response.body) throw new TerminalApiError("설명 응답 본문이 비어 있어요.");
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "", outcome = null;
		const consume = (raw) => {
			const text = raw.trim();
			if (!text) return;
			let event;
			try { event = JSON.parse(text); }
			catch { return; }
			onEvent(event);
			if (["answer", "error", "cancelled"].includes(event?.type)) outcome = event;
		};
		try {
			for (;;) {
				const { done, value } = await reader.read();
				buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
				let offset;
				while ((offset = buffer.indexOf("\n")) >= 0) {
					consume(buffer.slice(0, offset));
					buffer = buffer.slice(offset + 1);
				}
				if (done) break;
			}
			consume(buffer);
		} finally {
			reader.releaseLock();
		}
		if (!outcome) throw new TerminalApiError("설명이 끝나기 전에 연결이 닫혔어요.");
		return outcome;
	}

	cancel(profileId, requestId) {
		return this.json("/api/ask/cancel", { method: "POST", body: { profileId, requestId } });
	}

	steer(profileId, requestId, message) {
		return this.json("/api/ask/steer", { method: "POST", body: { profileId, requestId, message } });
	}
}
