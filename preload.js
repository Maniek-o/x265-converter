'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  openFilesDialog: () => ipcRenderer.invoke('open-files-dialog'),
  resolveDroppedFilePath: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch (_error) {
      return '';
    }
  }
});
