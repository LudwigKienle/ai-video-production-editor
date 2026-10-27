/**
 * Writes text files into the open project folder (desktop app), e.g.
 * exports/<name>.cube or exports/<name>.fcpxml. Tests replace the writer.
 */
import type { StudioToolContext } from './toolModules.ts';

type Writer = (folderPath: string, relativePath: string, data: string) => Promise<boolean>;

const electronWriter: Writer = async (folderPath, relativePath, data) => {
  const api = (globalThis as { window?: { electron?: { project?: { writeProjectFile?: (p: { folderPath: string; relativePath: string; data: string; encoding?: 'utf8' }) => Promise<{ ok: boolean }> } } } }).window?.electron?.project;
  if (!api?.writeProjectFile) return false;
  const result = await api.writeProjectFile({ folderPath, relativePath, data, encoding: 'utf8' });
  return Boolean(result?.ok);
};

let writer: Writer = electronWriter;

/** Tests only. */
export function overrideProjectFileWriter(next: Writer | null): void {
  writer = next ?? electronWriter;
}

export const safeFileName = (value: string, fallback = 'export') =>
  (value || fallback).replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || fallback;

/** Returns the absolute path, or null when no project is open or the app cannot write files. */
export async function writeProjectTextFile(ctx: StudioToolContext, relativePath: string, text: string): Promise<string | null> {
  const projectPath = ctx.getState().projectPath;
  if (!projectPath) return null;
  const ok = await writer(projectPath, relativePath, text);
  return ok ? `${projectPath.replace(/\/$/, '')}/${relativePath}` : null;
}
