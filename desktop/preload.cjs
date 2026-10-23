const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("captifyDesktop", {
  isDesktop: true,
  platform: process.platform,
  getRuntime: () => ipcRenderer.invoke("desktop:runtime"),
  workerRequest: (pathname, body) => ipcRenderer.invoke("desktop:worker-request", pathname, body),
  uploadChunk: (payload) => ipcRenderer.invoke("desktop:upload-chunk", payload),
  getJobStatus: (jobId) => ipcRenderer.invoke("desktop:job-status", jobId),
  getSettingsStatus: () => ipcRenderer.invoke("desktop:settings-status"),
  saveSettings: (settings) => ipcRenderer.invoke("desktop:save-settings", settings),
  openSettings: () => ipcRenderer.invoke("desktop:open-settings"),
  getFilePath: (file) => webUtils.getPathForFile(file)
});
