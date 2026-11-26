const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('sonaDesktop', {
  isElectron: true,
  platform: process.platform,
});
