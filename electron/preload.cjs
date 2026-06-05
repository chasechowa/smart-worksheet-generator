const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invokeApiCall: (url, options) => ipcRenderer.invoke('api-call', url, options),
  fsRead: (id) => ipcRenderer.invoke('fs:read', id),
  fsWrite: (project) => ipcRenderer.invoke('fs:write', project),
  fsList: () => ipcRenderer.invoke('fs:list'),
  fsDelete: (id) => ipcRenderer.invoke('fs:delete', id),
  exportPDF: (html, filename) => ipcRenderer.invoke('export-pdf', html, filename),
});
