import { terminalSafeText } from "./terminal-input.mjs";

// OMP titanium-prompt-focus palette. Empty string means "inherit the terminal".
const COLORS = Object.freeze({
	statusBackground: "#0f1216",
	userBackground: "#243b53",
	userText: "#ffffff",
	customBackground: "#2a3038",
	accent: "#00b4ff",
	selectedBackground: "#0082b3",
	foreground: "#e8ecf4",
	muted: "#9ca3b0",
	dim: "#6b7280",
	gold: "#d4c090",
	amber: "#ffb347",
	green: "#00ff88",
	red: "#ff4757",
	border: "#2a3038",
});

// [foreground, background]; "" inherits the terminal. Only user/composer/status/
// custom/selected carry backgrounds: body text never paints a global background.
const ROLES = Object.freeze({
	text: ["", ""],
	title: ["accent", ""],
	muted: ["muted", ""],
	dim: ["dim", ""],
	border: ["border", ""],
	borderAccent: ["accent", ""],
	selected: ["foreground", "selectedBackground"],
	user: ["userText", "userBackground"],
	composer: ["", ""],
	status: ["muted", "statusBackground"],
	error: ["red", ""],
	success: ["green", ""],
	warning: ["amber", ""],
	custom: ["", "customBackground"],
	label: ["gold", ""],
	model: ["accent", ""],
	path: ["foreground", ""],
});

const ANSI_PALETTE = [
	[0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0],
	[0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
	[127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0],
	[92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
const XTERM_PALETTE = [
	...ANSI_PALETTE,
	...CUBE_LEVELS.flatMap((red) => CUBE_LEVELS.flatMap((green) => CUBE_LEVELS.map((blue) => [red, green, blue]))),
	...Array.from({ length: 24 }, (_, index) => {
		const gray = 8 + index * 10;
		return [gray, gray, gray];
	}),
];

function parseHex(color) {
	return [
		Number.parseInt(color.slice(1, 3), 16),
		Number.parseInt(color.slice(3, 5), 16),
		Number.parseInt(color.slice(5, 7), 16),
	];
}

function nearestIndex(rgb, palette) {
	let bestIndex = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let index = 0; index < palette.length; index += 1) {
		const [red, green, blue] = palette[index];
		const distance = (rgb[0] - red) ** 2 + (rgb[1] - green) ** 2 + (rgb[2] - blue) ** 2;
		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = index;
		}
	}
	return bestIndex;
}

function hasTrueColor(term, colorTerm) {
	return colorTerm === "truecolor" || colorTerm === "24bit" ||
		/(?:^|[-_])(direct|truecolor|24bit)(?:$|[-_])/.test(term) ||
		/^(?:xterm-)?(?:ghostty|kaku|kitty|wezterm|alacritty|foot)(?:[-.]|$)/.test(term);
}

function has256Colors(term) {
	return /(?:^|[-_])256(?:color)?(?:$|[-_])/.test(term);
}

function sgrColor(color, isBackground, mode) {
	if (mode === "truecolor") {
		const [red, green, blue] = parseHex(color);
		return `\u001b[${isBackground ? 48 : 38};2;${red};${green};${blue}m`;
	}

	const palette = mode === "256" ? XTERM_PALETTE : ANSI_PALETTE;
	const index = nearestIndex(parseHex(color), palette);
	if (mode === "256") return `\u001b[${isBackground ? 48 : 38};5;${index}m`;
	if (index < 8) return `\u001b[${(isBackground ? 40 : 30) + index}m`;
	return `\u001b[${(isBackground ? 100 : 90) + index - 8}m`;
}

const ATTRIBUTE_STYLES = Object.freeze({
	bold: ["1", "22"],
	italic: ["3", "23"],
	underline: ["4", "24"],
	strikethrough: ["9", "29"],
});

// Markdown semantic colors: OMP md* roles plus attribute-only text styles.
const MARKDOWN_COLORS = Object.freeze({
	heading: "accent",
	link: "accent",
	linkUrl: "selectedBackground",
	code: "green",
	codeBlock: "muted",
	codeBlockBorder: "border",
	quote: "muted",
	quoteBorder: "border",
	hr: "border",
	listBullet: "accent",
});

function createMarkdownTheme(enabled, mode) {
	const theme = {};
	for (const [name, colorKey] of Object.entries(MARKDOWN_COLORS)) {
		const prefix = enabled ? sgrColor(COLORS[colorKey], false, mode) : "";
		theme[name] = (text) => (enabled ? `${prefix}${text}\u001b[0m` : String(text));
	}
	for (const [name, [on, off]] of Object.entries(ATTRIBUTE_STYLES)) {
		theme[name] = (text) => (enabled ? `\u001b[${on}m${text}\u001b[${off}m` : String(text));
	}
	return theme;
}

export function createTerminalTheme(env = process.env) {
	const variables = env ?? {};
	const term = String(variables.TERM ?? "").toLowerCase();
	const colorTerm = String(variables.COLORTERM ?? "").toLowerCase();
	const enabled = !Object.hasOwn(variables, "NO_COLOR") && term !== "dumb";
	const mode = hasTrueColor(term, colorTerm) ? "truecolor" : has256Colors(term) ? "256" : "ansi";
	const styles = new Map();

	if (enabled) {
		for (const [role, [foreground, background]] of Object.entries(ROLES)) {
			styles.set(role, [
				foreground ? sgrColor(COLORS[foreground], false, mode) : "",
				background ? sgrColor(COLORS[background], true, mode) : "",
			]);
		}
	}

	const prefixOf = (role) => {
		const style = styles.get(role) ?? styles.get("text") ?? ["", ""];
		return style[0] + style[1];
	};

	return {
		enabled,
		markdown: createMarkdownTheme(enabled, mode),
		/** Full-row styling for untrusted text: sanitized, erase-to-EOL, hard reset. */
		paint(role, text) {
			const safeText = terminalSafeText(text);
			const prefix = prefixOf(role);
			if (!enabled || !prefix) return safeText;
			return `${prefix}${safeText}\u001b[K\u001b[0m`;
		},
		/** Inline styling for untrusted text: no erase-to-EOL; resets only what it set, so an outer background survives. */
		span(role, text) {
			const safeText = terminalSafeText(text);
			const [foreground, background] = styles.get(role) ?? styles.get("text") ?? ["", ""];
			if (!enabled) return safeText;
			const resets = [foreground ? "39" : "", background ? "49" : ""].filter(Boolean).join(";");
			return `${foreground}${background}${safeText}${resets ? `\u001b[${resets}m` : ""}`;
		},
		/** Full row for trusted, already-rendered ANSI content. Re-applies the role
		 * style after renderer resets so role backgrounds/colors span the whole row. */
		line(role, text) {
			const body = String(text ?? "");
			if (!enabled) return body;
			const prefix = prefixOf(role);
			const reapplied = prefix ? body.replace(/\u001b\[0m/g, `\u001b[0m${prefix}`) : body;
			return `${prefix}${reapplied}\u001b[K${prefix ? "\u001b[0m" : ""}`;
		},
	};
}
