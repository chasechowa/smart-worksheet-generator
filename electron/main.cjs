const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');

const isDev = !app.isPackaged;
const PROJECTS_DIR = 'D:\\\\WorkingStuff\\\\TOOLS';

async function fetchWithProxy(url, options) {
  let proxyUri = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;

  if (!proxyUri) {
    try {
      const proxyString = await session.defaultSession.resolveProxy(url);
      if (proxyString && proxyString !== 'DIRECT') {
        const match = proxyString.match(/PROXY\s+([^;\s]+)/);
        if (match) proxyUri = `http://${match[1]}`;
      }
    } catch (e) {
      console.warn('[fetchWithProxy] resolveProxy failed:', e.message);
    }
  }

  if (proxyUri) {
    try {
      const agent = new HttpsProxyAgent(proxyUri);
      return await fetch(url, { ...options, agent });
    } catch (proxyErr) {
      console.warn('[fetchWithProxy] Proxy fetch failed, falling back to direct:', proxyErr.message);
    }
  }

  return fetch(url, options);
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// IPC: API proxy (existing)
ipcMain.handle('api-call', async (_event, url, options) => {
  try {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[api-call] ${options?.method || 'GET'} ${url}`);
    }

    const isKimi = url.includes('kimi.com') || url.includes('moonshot.cn');
    const mergedOptions = {
      ...options,
      headers: {
        ...(options?.headers || {}),
        ...(isKimi ? {
          'User-Agent': 'Kimi-CLI/1.0',
          'X-Kimi-Client': 'cli',
        } : {}),
      },
    };
    const response = await fetchWithProxy(url, mergedOptions);
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  } catch (error) {
    console.error('[api-call] fetch error:', error);
    throw new Error(error.message || 'Network request failed');
  }
});

// IPC: File system for project persistence
ipcMain.handle('fs:list', async () => {
  try {
    await fs.mkdir(PROJECTS_DIR, { recursive: true });
    const files = await fs.readdir(PROJECTS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const metas = await Promise.all(
      jsonFiles.map(async (filename) => {
        const filePath = path.join(PROJECTS_DIR, filename);
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(raw);
          return {
            id: data.id,
            title: data.title || 'Untitled',
            difficulty: data.difficulty || 'B2',
            createdAt: data.createdAt || 0,
            updatedAt: data.updatedAt || 0,
            worksheetCount: Array.isArray(data.worksheets) ? data.worksheets.length : 0,
          };
        } catch {
          return null;
        }
      })
    );
    return metas.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.error('[fs:list] error:', error);
    throw new Error('Failed to list projects');
  }
});

ipcMain.handle('fs:read', async (_event, id) => {
  const filePath = path.join(PROJECTS_DIR, `${id}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('[fs:read] error:', error);
    throw new Error(`Failed to read project ${id}`);
  }
});

ipcMain.handle('fs:write', async (_event, project) => {
  try {
    await fs.mkdir(PROJECTS_DIR, { recursive: true });
    const filePath = path.join(PROJECTS_DIR, `${project.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(project, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('[fs:write] error:', error);
    throw new Error('Failed to save project');
  }
});

ipcMain.handle('fs:delete', async (_event, id) => {
  const filePath = path.join(PROJECTS_DIR, `${id}.json`);
  try {
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    console.error('[fs:delete] error:', error);
    throw new Error(`Failed to delete project ${id}`);
  }
});

// IPC: Export worksheet to PDF via hidden window + printToPDF
ipcMain.handle('export-pdf', async (_event, htmlContent, defaultFilename) => {
  const tmpDir = path.join(app.getPath('temp'), 'smart-worksheet-generator');
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `export_${Date.now()}.html`);

  try {
    await fs.writeFile(tmpFile, htmlContent, 'utf-8');

    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 1600,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    await win.loadFile(tmpFile);
    // CSS is now inline (self-contained HTML, no CDN deps), short render delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const pdfBuffer = await win.webContents.printToPDF({
      marginsType: 0,              // default — let CSS @page margins control layout
      printBackground: true,
      pageSize: 'A4',
      preferCSSPageSize: true,     // respect CSS @page { size: A4 }
      landscape: false,
    });

    win.destroy();

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: defaultFilename,
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    });

    if (filePath) {
      await fs.writeFile(filePath, pdfBuffer);
      return { success: true, path: filePath };
    }
    return { success: false, cancelled: true };
  } catch (error) {
    console.error('[export-pdf] error:', error);
    throw new Error('Failed to export PDF: ' + error.message);
  } finally {
    try { await fs.unlink(tmpFile); } catch { /* ignore */ }
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
