import { ProjectSyncConfig, ProjectSyncProvider } from '../types';
import { getValidCloudAuth } from './cloudAuthService';

type CloudSyncResult = {
  sync: ProjectSyncConfig;
  modifiedAt?: string;
  rev?: string;
};

type CloudSyncDownload = {
  content: string;
  sync: ProjectSyncConfig;
  modifiedAt?: string;
  rev?: string;
};

const DROPBOX_ROOT = '/AI Video Production Editor';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

const sanitizeName = (value: string) => value.trim().replace(/[\\/:*?"<>|]/g, '_');
const toArrayBuffer = (data: ArrayBuffer | Uint8Array) => {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};

const ensureDropboxPath = (sync: ProjectSyncConfig, projectName: string) => {
  if (sync.remotePath) return sync.remotePath;
  const safeName = sanitizeName(projectName || 'untitled-project');
  return `${DROPBOX_ROOT}/${safeName}/project.json`;
};

const getDropboxRootPath = (sync: ProjectSyncConfig, projectName: string) => {
  const projectPath = ensureDropboxPath(sync, projectName);
  return projectPath.replace(/\/project\.json$/i, '');
};

const dropboxRequest = async (endpoint: string, accessToken: string, body?: any) => {
  const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Dropbox API error: ${msg || response.statusText}`);
  }
  return response.json();
};

const uploadDropboxFile = async (path: string, accessToken: string, content: string) => {
  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode: 'overwrite',
        autorename: false,
        mute: true,
      }),
      'Content-Type': 'application/octet-stream',
    },
    body: content,
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Dropbox upload failed: ${msg || response.statusText}`);
  }
  return response.json();
};

const downloadDropboxFile = async (path: string, accessToken: string) => {
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Dropbox download failed: ${msg || response.statusText}`);
  }
  return response.text();
};

const getDropboxMetadata = async (path: string, accessToken: string) => {
  return dropboxRequest('files/get_metadata', accessToken, { path });
};

const driveRequest = async (
  endpoint: string,
  accessToken: string,
  opts?: { method?: string; query?: Record<string, string>; body?: any }
) => {
  const query = opts?.query ? `?${new URLSearchParams(opts.query).toString()}` : '';
  const response = await fetch(`https://www.googleapis.com/drive/v3/${endpoint}${query}`, {
    method: opts?.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Google Drive API error: ${msg || response.statusText}`);
  }
  return response.json();
};

const ensureDriveFolder = async (
  sync: ProjectSyncConfig,
  projectName: string,
  accessToken: string,
  createIfMissing: boolean
) => {
  if (sync.remoteFolderId) return { sync, folderId: sync.remoteFolderId };
  const safeName = sanitizeName(projectName || 'untitled-project');
  const existingId = await findDriveFile(safeName, 'root', accessToken, DRIVE_FOLDER_MIME);
  if (existingId) {
    return {
      sync: { ...sync, remoteFolderId: existingId },
      folderId: existingId,
    };
  }
  if (!createIfMissing) {
    throw new Error('Cloud folder not configured. Push first.');
  }
  const payload = await driveRequest('files', accessToken, {
    method: 'POST',
    body: {
      name: safeName,
      mimeType: DRIVE_FOLDER_MIME,
    },
  });
  return {
    sync: { ...sync, remoteFolderId: payload.id },
    folderId: payload.id,
  };
};

const findDriveFile = async (name: string, parentId: string, accessToken: string, mimeType?: string) => {
  const escapedName = name.replace(/'/g, "\\'");
  const typeFilter = mimeType ? ` and mimeType='${mimeType}'` : '';
  const query = `name='${escapedName}' and '${parentId}' in parents and trashed=false${typeFilter}`;
  const result = await driveRequest('files', accessToken, {
    query: { q: query, fields: 'files(id,name)' },
  });
  return result.files?.[0]?.id || null;
};

const ensureDriveFile = async (
  sync: ProjectSyncConfig,
  folderId: string,
  accessToken: string,
  createIfMissing: boolean
) => {
  if (sync.remoteFileId) return { sync, fileId: sync.remoteFileId };
  const existingId = await findDriveFile('project.json', folderId, accessToken);
  if (existingId) {
    return { sync: { ...sync, remoteFileId: existingId }, fileId: existingId };
  }
  if (!createIfMissing) {
    throw new Error('Cloud file not found. Push first.');
  }
  const payload = await driveRequest('files', accessToken, {
    method: 'POST',
    body: {
      name: 'project.json',
      parents: [folderId],
      mimeType: 'application/json',
    },
  });
  return {
    sync: { ...sync, remoteFileId: payload.id },
    fileId: payload.id,
  };
};

const ensureDriveFolderPath = async (
  rootId: string,
  segments: string[],
  accessToken: string,
  createIfMissing: boolean,
  cache: Map<string, string>,
) => {
  let currentId = rootId;
  for (const segment of segments) {
    const key = `${currentId}/${segment}`;
    if (cache.has(key)) {
      currentId = cache.get(key)!;
      continue;
    }
    const existingId = await findDriveFile(segment, currentId, accessToken, DRIVE_FOLDER_MIME);
    if (existingId) {
      cache.set(key, existingId);
      currentId = existingId;
      continue;
    }
    if (!createIfMissing) {
      throw new Error('Cloud folder path not found. Push first.');
    }
    const payload = await driveRequest('files', accessToken, {
      method: 'POST',
      body: {
        name: segment,
        parents: [currentId],
        mimeType: DRIVE_FOLDER_MIME,
      },
    });
    cache.set(key, payload.id);
    currentId = payload.id;
  }
  return currentId;
};

const uploadDriveFile = async (fileId: string, accessToken: string, content: string) => {
  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=modifiedTime`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: content,
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Google Drive upload failed: ${msg || response.statusText}`);
  }
  return response.json();
};

const downloadDriveFile = async (fileId: string, accessToken: string) => {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Google Drive download failed: ${msg || response.statusText}`);
  }
  return response.text();
};

const getDriveMetadata = async (fileId: string, accessToken: string) => {
  return driveRequest(`files/${fileId}`, accessToken, {
    query: { fields: 'id,modifiedTime,version' },
  });
};

export const uploadProjectJsonToCloud = async (
  provider: ProjectSyncProvider,
  sync: ProjectSyncConfig,
  projectName: string,
  content: string,
): Promise<CloudSyncResult> => {
  const auth = await getValidCloudAuth(provider);
  if (!auth?.accessToken) {
    throw new Error('Cloud provider is not connected.');
  }

  if (provider === 'dropbox') {
    const path = ensureDropboxPath(sync, projectName);
    const payload = await uploadDropboxFile(path, auth.accessToken, content);
    return {
      sync: {
        ...sync,
        remotePath: path,
        remoteRev: payload.rev,
        remoteModifiedAt: payload.server_modified,
        lastSyncAt: new Date().toISOString(),
      },
      modifiedAt: payload.server_modified,
      rev: payload.rev,
    };
  }

  const folderResult = await ensureDriveFolder(sync, projectName, auth.accessToken, true);
  const fileResult = await ensureDriveFile(folderResult.sync, folderResult.folderId, auth.accessToken, true);
  const payload = await uploadDriveFile(fileResult.fileId, auth.accessToken, content);
  return {
    sync: {
      ...fileResult.sync,
      remoteModifiedAt: payload.modifiedTime,
      lastSyncAt: new Date().toISOString(),
    },
    modifiedAt: payload.modifiedTime,
  };
};

export const fetchCloudProjectMeta = async (
  provider: ProjectSyncProvider,
  sync: ProjectSyncConfig,
  projectName: string,
): Promise<CloudSyncResult | null> => {
  const auth = await getValidCloudAuth(provider);
  if (!auth?.accessToken) {
    throw new Error('Cloud provider is not connected.');
  }

  if (provider === 'dropbox') {
    const path = ensureDropboxPath(sync, projectName);
    const payload = await getDropboxMetadata(path, auth.accessToken);
    return {
      sync: { ...sync, remotePath: path, remoteRev: payload.rev, remoteModifiedAt: payload.server_modified },
      modifiedAt: payload.server_modified,
      rev: payload.rev,
    };
  }

  const folderResult = await ensureDriveFolder(sync, projectName, auth.accessToken, false);
  const fileResult = await ensureDriveFile(folderResult.sync, folderResult.folderId, auth.accessToken, false);
  const meta = await getDriveMetadata(fileResult.fileId, auth.accessToken);
  return {
    sync: { ...fileResult.sync, remoteModifiedAt: meta.modifiedTime },
    modifiedAt: meta.modifiedTime,
  };
};

export const downloadProjectJsonFromCloud = async (
  provider: ProjectSyncProvider,
  sync: ProjectSyncConfig,
  projectName: string,
): Promise<CloudSyncDownload> => {
  const auth = await getValidCloudAuth(provider);
  if (!auth?.accessToken) {
    throw new Error('Cloud provider is not connected.');
  }

  if (provider === 'dropbox') {
    const path = ensureDropboxPath(sync, projectName);
    const content = await downloadDropboxFile(path, auth.accessToken);
    const meta = await getDropboxMetadata(path, auth.accessToken);
    return {
      content,
      sync: { ...sync, remotePath: path, remoteRev: meta.rev, remoteModifiedAt: meta.server_modified },
      modifiedAt: meta.server_modified,
      rev: meta.rev,
    };
  }

  const folderResult = await ensureDriveFolder(sync, projectName, auth.accessToken, false);
  const fileResult = await ensureDriveFile(folderResult.sync, folderResult.folderId, auth.accessToken, false);
  const content = await downloadDriveFile(fileResult.fileId, auth.accessToken);
  const meta = await getDriveMetadata(fileResult.fileId, auth.accessToken);
  return {
    content,
    sync: { ...fileResult.sync, remoteModifiedAt: meta.modifiedTime },
    modifiedAt: meta.modifiedTime,
  };
};

const uploadDropboxAsset = async (
  rootPath: string,
  relativePath: string,
  accessToken: string,
  data: ArrayBuffer | Uint8Array
) => {
  const buffer = toArrayBuffer(data);
  const path = `${rootPath}/${relativePath}`.replace(/\\/g, '/');
  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode: 'overwrite',
        autorename: false,
        mute: true,
      }),
      'Content-Type': 'application/octet-stream',
    },
    body: buffer as any,
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Dropbox asset upload failed: ${msg || response.statusText}`);
  }
  return response.json();
};

const downloadDropboxAsset = async (rootPath: string, relativePath: string, accessToken: string) => {
  const path = `${rootPath}/${relativePath}`.replace(/\\/g, '/');
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Dropbox asset download failed: ${msg || response.statusText}`);
  }
  return response.arrayBuffer();
};

const uploadDriveAsset = async (
  rootId: string,
  relativePath: string,
  accessToken: string,
  data: ArrayBuffer | Uint8Array,
  cache: Map<string, string>,
) => {
  const buffer = toArrayBuffer(data);
  const parts = relativePath.split('/').filter(Boolean);
  const fileName = parts.pop() || 'asset';
  const folderId = await ensureDriveFolderPath(rootId, parts, accessToken, true, cache);
  const existingId = await findDriveFile(fileName, folderId, accessToken);
  const fileId = existingId
    ? existingId
    : (await driveRequest('files', accessToken, {
      method: 'POST',
      body: { name: fileName, parents: [folderId] },
    })).id;

  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
    },
    body: buffer as any,
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Google Drive asset upload failed: ${msg || response.statusText}`);
  }
  return fileId;
};

const downloadDriveAsset = async (
  rootId: string,
  relativePath: string,
  accessToken: string,
  cache: Map<string, string>,
) => {
  const parts = relativePath.split('/').filter(Boolean);
  const fileName = parts.pop() || 'asset';
  const folderId = await ensureDriveFolderPath(rootId, parts, accessToken, false, cache);
  const fileId = await findDriveFile(fileName, folderId, accessToken);
  if (!fileId) {
    throw new Error(`Cloud asset not found: ${relativePath}`);
  }
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const msg = await response.text().catch(() => '');
    throw new Error(`Google Drive asset download failed: ${msg || response.statusText}`);
  }
  return response.arrayBuffer();
};

export const uploadProjectAssetToCloud = async (
  provider: ProjectSyncProvider,
  sync: ProjectSyncConfig,
  projectName: string,
  relativePath: string,
  data: ArrayBuffer | Uint8Array,
): Promise<ProjectSyncConfig> => {
  const auth = await getValidCloudAuth(provider);
  if (!auth?.accessToken) {
    throw new Error('Cloud provider is not connected.');
  }
  if (provider === 'dropbox') {
    const rootPath = getDropboxRootPath(sync, projectName);
    await uploadDropboxAsset(rootPath, relativePath, auth.accessToken, data);
    return { ...sync, remotePath: ensureDropboxPath(sync, projectName) };
  }
  const folderResult = await ensureDriveFolder(sync, projectName, auth.accessToken, true);
  const cache = new Map<string, string>();
  await uploadDriveAsset(folderResult.folderId, relativePath, auth.accessToken, data, cache);
  return folderResult.sync;
};

export const downloadProjectAssetFromCloud = async (
  provider: ProjectSyncProvider,
  sync: ProjectSyncConfig,
  projectName: string,
  relativePath: string,
): Promise<{ data: ArrayBuffer; sync: ProjectSyncConfig }> => {
  const auth = await getValidCloudAuth(provider);
  if (!auth?.accessToken) {
    throw new Error('Cloud provider is not connected.');
  }
  if (provider === 'dropbox') {
    const rootPath = getDropboxRootPath(sync, projectName);
    const data = await downloadDropboxAsset(rootPath, relativePath, auth.accessToken);
    return { data, sync: { ...sync, remotePath: ensureDropboxPath(sync, projectName) } };
  }
  const folderResult = await ensureDriveFolder(sync, projectName, auth.accessToken, false);
  const cache = new Map<string, string>();
  const data = await downloadDriveAsset(folderResult.folderId, relativePath, auth.accessToken, cache);
  return { data, sync: folderResult.sync };
};
