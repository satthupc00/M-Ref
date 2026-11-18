const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('api', {
  getInit: () => ipcRenderer.invoke('init'),
  setSettings: (patch) => ipcRenderer.send('settings', patch),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  saveFile: (p, data, name) => ipcRenderer.invoke('save-file', p, data, name),
  pickImages: () => ipcRenderer.invoke('pick-images'),
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  setAlwaysOnTop: (b) => ipcRenderer.send('always-on-top', b),
  setOpacity: (v) => ipcRenderer.send('opacity', v),
  toggleFullscreen: () => ipcRenderer.send('fullscreen'),
  minimize: () => ipcRenderer.send('minimize'),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  closeNow: () => ipcRenderer.send('close-now'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.send('update-download'),
  installUpdate: () => ipcRenderer.send('update-install'),
  onUpdate: on('update'),
  onCloseRequest: on('close-request'),
  onOpenPath: on('open-path'),
  nativeMenu: (tpl) => ipcRenderer.send('native-menu', tpl),
  onMenuCmd: on('menu-cmd'),
});
