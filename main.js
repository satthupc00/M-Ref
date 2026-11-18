const { app, BrowserWindow, ipcMain, dialog, screen, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_TITLE = 'M Ref';
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

let win = null;
let forceClose = false;
let dragTimer = null;
let autoUpdater = null;

/* ---------- cài đặt ---------- */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { alwaysOnTop: true, opacity: 1, bg: '#2B2D31', grid: true, textColor: '#E8E9EC', lastSeenVersion: '' };
function loadSettings() {
  try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch { /* lần đầu chạy */ }
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* bỏ qua */ }
  }, 200);
}

const mrefFromArgv = (argv) => argv.slice(1).find((a) => /\.mref$/i.test(a) && fs.existsSync(a)) || null;

function validBounds(b) {
  if (!b || !b.width || !b.height) return null;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y < a.y + a.height - 60 && b.y + b.height > a.y - 10;
  });
  return visible ? b : null;
}

function createWindow() {
  const b = validBounds(settings.bounds) || { width: 1100, height: 700 };
  win = new BrowserWindow({
    ...b,
    minWidth: 220,
    minHeight: 160,
    title: APP_TITLE,
    frame: false,
    resizable: true,
    backgroundColor: settings.bg || '#2B2D31',
    alwaysOnTop: !!settings.alwaysOnTop,
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenu(null);
  if (settings.opacity && settings.opacity < 1) win.setOpacity(settings.opacity);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('blur', stopDrag);
  win.on('close', (e) => {
    if (!win.isFullScreen() && !win.isMaximized() && !win.isMinimized()) settings.bounds = win.getBounds();
    try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* bỏ qua */ }
    if (!forceClose) { e.preventDefault(); win.webContents.send('close-request'); }
  });
  win.on('closed', () => { win = null; });
}

function stopDrag() { clearInterval(dragTimer); dragTimer = null; }

/* ---------- IPC ---------- */
ipcMain.handle('init', () => ({
  version: app.getVersion(),
  packaged: app.isPackaged,
  settings,
  openPath: mrefFromArgv(process.argv),
  whatsnew: (() => { try { return require('./whatsnew.json'); } catch { return null; } })(),
}));
ipcMain.on('settings', (_e, patch) => { Object.assign(settings, patch); saveSettings(); });

ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Mở file M Ref', properties: ['openFile'], filters: [{ name: 'M Ref', extensions: ['mref'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], data: await fs.promises.readFile(r.filePaths[0]) };
});
ipcMain.handle('read-file', async (_e, p) => {
  if (typeof p !== 'string' || !/\.mref$/i.test(p)) return null;
  return { path: p, data: await fs.promises.readFile(p) };
});
ipcMain.handle('save-file', async (_e, p, data, name) => {
  if (!p) {
    const r = await dialog.showSaveDialog(win, { title: 'Lưu file M Ref', defaultPath: name || 'ref.mref', filters: [{ name: 'M Ref', extensions: ['mref'] }] });
    if (r.canceled || !r.filePath) return null;
    p = /\.mref$/i.test(r.filePath) ? r.filePath : r.filePath + '.mref';
  }
  const tmp = p + '.tmp';
  await fs.promises.writeFile(tmp, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  await fs.promises.rename(tmp, p);
  return p;
});
ipcMain.handle('pick-images', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Thêm ảnh', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Ảnh', extensions: IMAGE_EXT }] });
  if (r.canceled) return [];
  const out = [];
  for (const f of r.filePaths) {
    const ext = path.extname(f).slice(1).toLowerCase();
    if (!MIME[ext]) continue;
    out.push({ name: path.basename(f), mime: MIME[ext], data: await fs.promises.readFile(f) });
  }
  return out;
});
ipcMain.handle('fetch-image', async (_e, url) => {
  try {
    if (!/^https?:\/\//i.test(url)) return null;
    const res = await net.fetch(url);
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok || !/^image\/(png|jpeg|gif|webp|bmp)$/.test(mime)) return null;
    return { name: decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image'), mime, data: Buffer.from(await res.arrayBuffer()) };
  } catch { return null; }
});

ipcMain.on('always-on-top', (_e, b) => { if (win) win.setAlwaysOnTop(!!b); settings.alwaysOnTop = !!b; saveSettings(); });
ipcMain.on('opacity', (_e, v) => { v = Math.min(1, Math.max(0.2, +v || 1)); if (win) win.setOpacity(v); settings.opacity = v; saveSettings(); });
ipcMain.on('fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.on('minimize', () => { if (win) win.minimize(); });
ipcMain.on('close-now', () => { forceClose = true; if (win) win.close(); });

// Giữ chuột phải kéo = di chuyển cửa sổ: cửa sổ bám theo con trỏ cho tới khi nhả chuột
ipcMain.on('drag-start', () => {
  if (!win || win.isFullScreen() || win.isMaximized()) return;
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const off = { x: c.x - b.x, y: c.y - b.y };
  stopDrag();
  dragTimer = setInterval(() => {
    if (!win) return stopDrag();
    const p = screen.getCursorScreenPoint();
    win.setBounds({ x: p.x - off.x, y: p.y - off.y, width: b.width, height: b.height });
  }, 8);
});
ipcMain.on('drag-end', stopDrag);

// Cửa sổ quá nhỏ để chứa menu vẽ trong app: dùng menu của Windows (không bị cắt theo khung cửa sổ)
ipcMain.on('native-menu', (_e, tpl) => {
  const conv = (list) => list.map((m) => m.sep ? { type: 'separator' } : {
    label: String(m.label), enabled: !m.off, accelerator: undefined,
    type: m.chk !== undefined ? 'checkbox' : 'normal', checked: !!m.chk,
    submenu: m.sub ? conv(m.sub) : undefined,
    click: m.cmd ? () => { if (win) win.webContents.send('menu-cmd', String(m.cmd)); } : undefined,
  });
  if (win && Array.isArray(tpl)) Menu.buildFromTemplate(conv(tpl)).popup({ window: win });
});

/* ---------- tự cập nhật ---------- */
const sendUpdate = (data) => { if (win) win.webContents.send('update', data); };
function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
    autoUpdater.on('update-available', (i) => sendUpdate({ state: 'available', version: i.version }));
    autoUpdater.on('update-not-available', () => sendUpdate({ state: 'latest' }));
    autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => sendUpdate({ state: 'downloaded', version: i.version }));
    autoUpdater.on('error', () => sendUpdate({ state: 'error' }));
  } catch { autoUpdater = null; }
}
ipcMain.handle('update-check', async () => {
  if (!autoUpdater) return 'dev';
  try { await autoUpdater.checkForUpdates(); } catch { sendUpdate({ state: 'error' }); }
  return 'ok';
});
ipcMain.on('update-download', () => { if (autoUpdater) autoUpdater.downloadUpdate().catch(() => sendUpdate({ state: 'error' })); });
ipcMain.on('update-install', () => { if (autoUpdater) { forceClose = true; autoUpdater.quitAndInstall(true, true); } });

/* ---------- khởi động ---------- */
app.whenReady().then(() => {
  loadSettings();
  createWindow();
  setupUpdater();
});
app.on('window-all-closed', () => app.quit());
