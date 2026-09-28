import { promises as fs } from "node:fs";
import path from "node:path";
import * as tar from "tar";

/** Extracts a cPanel backup archive (.tar.gz / .tgz) into a fresh temp directory and returns its path. */
export async function extractBackupArchive(archivePath: string, workDir: string): Promise<string> {
  const destination = path.join(workDir, path.basename(archivePath).replace(/\.(tar\.gz|tgz|tar)$/i, ""));
  await fs.mkdir(destination, { recursive: true });
  await tar.x({ file: archivePath, cwd: destination, strip: 0 });
  return destination;
}
