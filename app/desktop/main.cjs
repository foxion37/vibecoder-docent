"use strict";

const { execFile } = require("node:child_process");
const { access, readFile } = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const {
  app,
  BrowserWindow,
  dialog,
  Menu,
  shell,
  utilityProcess,
} = require("electron");

const execFileAsync = promisify(execFile);
const APP_TITLE = "바이브코더 도슨트";
const STARTUP_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;
const MAX_SERVER_LOG_CHARS = 8_000;

let appWindow = null;
let appUrl = null;
let serverChild = null;
let isQuitting = false;
let errorShown = false;
let secondLaunchRequested = false;

app.setName(APP_TITLE);

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`DOCENT_PORT 값이 올바르지 않아요: ${String(value)}. 1부터 65535 사이의 포트를 사용하세요.`);
  }
  return port;
}

function appendLog(state, key, chunk) {
  state[key] = `${state[key]}${String(chunk)}`.slice(-MAX_SERVER_LOG_CHARS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isHealthyDocent(baseUrl) {
  try {
    const response = await fetch(new URL("/api/health", baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health?.app === "vibecoder-docent" && typeof health.version === "string";
  } catch {
    return false;
  }
}

function getSearchPath(home) {
  const inherited = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const additions = [
    path.join(home, ".local", "bin"),
    path.join(home, ".bun", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return [...new Set([...inherited, ...additions])].join(path.delimiter);
}

async function findExecutable(command, home, searchPath) {
  const expanded = command.startsWith("~/") ? path.join(home, command.slice(2)) : command;
  const candidates = path.isAbsolute(expanded)
    ? [expanded]
    : expanded.includes(path.sep)
      ? [path.resolve(home, expanded)]
      : searchPath.split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, expanded));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking through Finder's limited PATH plus the usual user install locations.
    }
  }
  return null;
}

async function startupSettings() {
  const home = process.env.HOME || app.getPath("home");
  const docentHome = process.env.DOCENT_HOME || path.join(home, ".docent");
  const configPath = path.isAbsolute(docentHome)
    ? path.join(docentHome, "config.json")
    : path.resolve(home, docentHome, "config.json");
  let config = {};
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    // The server follows the same behavior: missing or malformed config falls back to defaults.
  }

  const port = parsePort(process.env.DOCENT_PORT ?? config.port ?? 4747);
  const searchPath = getSearchPath(home);
  const env = {
    ...process.env,
    HOME: home,
    PATH: searchPath,
    DOCENT_PORT: String(port),
    DOCENT_ON_LISTEN: "",
  };
  const configuredOmp = process.env.OMP_BIN;
  const ompCommand = configuredOmp === undefined ? "omp" : configuredOmp;
  const ompPath = ompCommand ? await findExecutable(ompCommand, home, searchPath) : null;
  const ompError = !ompPath
    ? configuredOmp === undefined
      ? "omp를 찾을 수 없어요. ~/.local/bin 또는 ~/.bun/bin에 설치되어 있는지 확인하세요."
      : configuredOmp
        ? `OMP_BIN으로 지정한 실행 파일을 찾거나 실행할 수 없어요: ${configuredOmp}`
        : "OMP_BIN이 비어 있어요."
    : null;
  if (ompPath) env.OMP_BIN = ompPath;
  return { home, port, env, ompPath, ompError };
}

async function checkOmp(ompPath, env) {
  try {
    await execFileAsync(ompPath, ["--version"], {
      cwd: env.HOME,
      env,
      timeout: 10_000,
      maxBuffer: 1_000_000,
    });
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`omp를 실행할 수 없어요. 설치 상태와 로그인을 확인하세요.\n\n${detail}`);
  }
}

function addServerMessage(state, data, port) {
  appendLog(state, "stdout", data);
  state.announcedListening ||= state.stdout.split(/\r?\n/)
    .some((line) => line.startsWith("docent: http://") && line.includes(`:${port}/`));
}

function addServerError(state, data) {
  appendLog(state, "stderr", data);
}

function startServer({ home, port, env }) {
  const root = app.getAppPath();
  const serverPath = path.join(root, "app", "server.mjs");
  const state = {
    announcedListening: false,
    stdout: "",
    stderr: "",
    exited: false,
    exitCode: null,
  };
  const child = utilityProcess.fork(serverPath, [], {
    cwd: home,
    env,
    serviceName: "Docent local server",
    stdio: "pipe",
  });
  serverChild = child;
  child.stdout?.on("data", (chunk) => addServerMessage(state, chunk, port));
  child.stderr?.on("data", (chunk) => addServerError(state, chunk));
  child.on("exit", (code) => {
    state.exited = true;
    state.exitCode = code;
    if (serverChild === child) serverChild = null;
    if (!isQuitting && !errorShown && app.isReady() && appUrl) {
      showFatalError(
        "도슨트 로컬 서버가 종료됐어요.",
        state.stderr.trim() || `종료 코드: ${code ?? "알 수 없음"}`,
      );
    }
  });
  child.on("error", (error) => addServerError(state, error.stack || error.message));
  return { child, state };
}

function serverStartupError(state, port) {
  const details = state.stderr.trim() || state.stdout.trim();
  return new Error(
    `로컬 서버를 포트 ${port}에서 시작하지 못했어요. 다른 프로그램이 이 포트를 사용 중인지 확인하세요.`
      + (details ? `\n\n서버 메시지:\n${details}` : ""),
  );
}

async function waitForOwnedServer({ state, port, baseUrl }) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (state.exited) throw serverStartupError(state, port);
    if (state.announcedListening && await isHealthyDocent(baseUrl)) return;
    await sleep(250);
  }
  throw new Error(
    `로컬 서버가 ${STARTUP_TIMEOUT_MS / 1_000}초 안에 준비되지 않았어요.`
      + (state.stderr.trim() ? `\n\n서버 메시지:\n${state.stderr.trim()}` : ""),
  );
}

async function stopOwnedServer(child) {
  if (serverChild === child) serverChild = null;
  if (child.pid === undefined) return;
  child.kill();
  const deadline = Date.now() + 2_000;
  while (child.pid !== undefined && Date.now() < deadline) await sleep(50);
}

async function ensureServer() {
  const settings = await startupSettings();
  const baseUrl = `http://127.0.0.1:${settings.port}/`;
  if (await isHealthyDocent(baseUrl)) return { baseUrl };

  if (!settings.ompPath) throw new Error(settings.ompError);
  await checkOmp(settings.ompPath, settings.env);
  const { child, state } = startServer({ ...settings });
  try {
    await waitForOwnedServer({ state, port: settings.port, baseUrl });
    return { baseUrl };
  } catch (error) {
    await stopOwnedServer(child);
    // Another local docent may have won the port race while this child was starting.
    if (await isHealthyDocent(baseUrl)) return { baseUrl };
    throw error;
  }
}

function isAppOrigin(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin === new URL(appUrl).origin && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function safeExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (appUrl && parsed.origin === new URL(appUrl).origin) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function openExternal(rawUrl) {
  const external = safeExternalUrl(rawUrl);
  if (external) void shell.openExternal(external).catch(() => {});
}

function configureWindow(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppOrigin(url)) {
      createAppWindow(url);
    } else {
      openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppOrigin(url)) event.preventDefault();
  });
  win.webContents.on("will-redirect", (event, url) => {
    if (!isAppOrigin(url)) event.preventDefault();
  });
}

function createAppWindow(targetUrl = appUrl) {
  const win = new BrowserWindow({
    title: APP_TITLE,
    width: 1_440,
    height: 960,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: "#f6f6f4",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  if (!appWindow) appWindow = win;
  configureWindow(win);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (appWindow === win) appWindow = null;
  });
  void win.loadURL(targetUrl).catch((error) => {
    if (!isQuitting) showFatalError("화면을 열지 못했어요.", error.message);
  });
  return win;
}

function showFatalError(message, detail) {
  if (errorShown || isQuitting) return;
  errorShown = true;
  dialog.showErrorBox(APP_TITLE, `${message}\n\n${detail}`);
  app.quit();
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: APP_TITLE,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "편집",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]));
}

async function boot() {
  installMenu();
  const server = await ensureServer();
  appUrl = server.baseUrl;
  createAppWindow();
  if (secondLaunchRequested && appWindow) {
    appWindow.show();
    appWindow.focus();
    secondLaunchRequested = false;
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (appWindow) {
      if (appWindow.isMinimized()) appWindow.restore();
      appWindow.show();
      appWindow.focus();
    } else {
      secondLaunchRequested = true;
    }
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && appUrl) createAppWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    isQuitting = true;
    if (serverChild) {
      const ownedChild = serverChild;
      serverChild = null;
      ownedChild.kill();
    }
  });
  app.whenReady().then(boot).catch((error) => {
    showFatalError("도슨트를 시작하지 못했어요.", error.message || String(error));
  });
}
