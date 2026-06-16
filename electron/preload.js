const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  project: {
    selectFolder: () => ipcRenderer.invoke('project:selectFolder'),
    selectFile: () => ipcRenderer.invoke('project:selectFile'),
    probeFolder: (payload) => ipcRenderer.invoke('project:probe', payload),
    initFolder: (payload) => ipcRenderer.invoke('project:init', payload),
    saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
    loadProject: (payload) => ipcRenderer.invoke('project:load', payload),
    statProject: (payload) => ipcRenderer.invoke('project:stat', payload),
    readProjectFile: (payload) => ipcRenderer.invoke('project:readProjectFile', payload),
    writeProjectFile: (payload) => ipcRenderer.invoke('project:writeProjectFile', payload),
    deleteProjectFile: (payload) => ipcRenderer.invoke('project:deleteProjectFile', payload),
    statProjectPath: (payload) => ipcRenderer.invoke('project:statPath', payload),
    readFile: (payload) => ipcRenderer.invoke('project:readFile', payload),
    prepareVideoForEditing: (payload) => ipcRenderer.invoke('project:prepareVideoForEditing', payload),
    openFolder: (payload) => ipcRenderer.invoke('project:openFolder', payload),
    listSystemFonts: () => ipcRenderer.invoke('project:listSystemFonts'),
    exportVideo: (payload) => ipcRenderer.invoke('project:exportVideo', payload),
    exportStoryboardPdf: (payload) => ipcRenderer.invoke('project:exportStoryboardPdf', payload),
    onExportProgress: (callback) => ipcRenderer.on('export:progress', (_event, value) => callback(value)),
    removeExportProgressListener: () => ipcRenderer.removeAllListeners('export:progress'),
  },
  mcp: {
    init: () => ipcRenderer.invoke('mcp:init'),
    listTools: () => ipcRenderer.invoke('mcp:listTools'),
    callTool: (name, args) => ipcRenderer.invoke('mcp:callTool', { name, args }),
    listResources: () => ipcRenderer.invoke('mcp:listResources'),
    readResource: (uri) => ipcRenderer.invoke('mcp:readResource', { uri }),
  },
  comfyui: {
    start: (options) => ipcRenderer.invoke('comfyui:start', options),
    stop: () => ipcRenderer.invoke('comfyui:stop'),
    status: () => ipcRenderer.invoke('comfyui:status'),
    getLogs: () => ipcRenderer.invoke('comfyui:getLogs'),
    clearLogs: () => ipcRenderer.invoke('comfyui:clearLogs'),
  },
  audioRemaster: {
    status: () => ipcRenderer.invoke('audioRemaster:status'),
    setup: () => ipcRenderer.invoke('audioRemaster:setup'),
    process: (payload) => ipcRenderer.invoke('audioRemaster:process', payload),
  },
  audioMastering: {
    status: () => ipcRenderer.invoke('audioMastering:status'),
    setup: () => ipcRenderer.invoke('audioMastering:setup'),
    process: (payload) => ipcRenderer.invoke('audioMastering:process', payload),
  },
  corridorKey: {
    status: (payload) => ipcRenderer.invoke('corridorKey:status', payload),
    setup: (payload) => ipcRenderer.invoke('corridorKey:setup', payload),
    process: (payload) => ipcRenderer.invoke('corridorKey:process', payload),
  },
  surfaceMaps: {
    status: (payload) => ipcRenderer.invoke('surfaceMaps:status', payload),
    setup: (payload) => ipcRenderer.invoke('surfaceMaps:setup', payload),
    process: (payload) => ipcRenderer.invoke('surfaceMaps:process', payload),
  },
});
