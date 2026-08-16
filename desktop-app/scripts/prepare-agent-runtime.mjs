import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(desktopRoot, '..');
const runtimeRoot = join(desktopRoot, 'src-tauri', 'runtime', 'agent-runtime');
const sidecarEntry = join(workspaceRoot, 'sidecars', 'agent-runtime', 'dist', 'main.js');
const esbuild = join(workspaceRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
const nodeBinary = process.env.APISAVERWRITER_NODE_BINARY || process.execPath;
const mobileTarget = ['android', 'ios'].includes(String(process.env.TAURI_ENV_PLATFORM || '').toLowerCase());

const copyPackage = (name) => {
  const source = join(workspaceRoot, 'node_modules', ...name.split('/'));
  const target = join(runtimeRoot, 'node_modules', ...name.split('/'));
  if (!existsSync(source)) throw new Error(`缺少 Agent 运行时依赖：${name}`);
  cpSync(source, target, { recursive: true });
};

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(runtimeRoot, { recursive: true });

// iOS and Android call the trusted Agent Gateway. Node child processes and
// native SQLite modules cannot run inside a mobile WebView bundle.
if (mobileTarget) {
  console.log(`Skipping desktop Agent sidecar for ${process.env.TAURI_ENV_PLATFORM}; mobile uses Agent Gateway.`);
  process.exit(0);
}

execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build', '--workspace', '@apisaverwriter/agent-runtime'], {
  cwd: workspaceRoot,
  stdio: 'inherit',
});
execFileSync(esbuild, [sidecarEntry, '--bundle', '--platform=node', '--format=cjs', '--target=node22', '--external:better-sqlite3', '--external:undici', '--external:iconv-lite', `--outfile=${join(runtimeRoot, 'main.cjs')}`], {
  cwd: workspaceRoot,
  stdio: 'inherit',
});

// better-sqlite3 is a native module. Keep it external to the single-file JS
// bundle and carry its matching prebuilt binary alongside the bundled runtime.
for (const dependency of ['better-sqlite3', 'bindings', 'file-uri-to-path', 'undici', 'iconv-lite', 'safer-buffer']) copyPackage(dependency);

const packagedNode = join(runtimeRoot, process.platform === 'win32' ? 'node.exe' : 'node');
if (!existsSync(nodeBinary)) throw new Error(`找不到用于打包的 Node.js：${nodeBinary}`);
copyFileSync(nodeBinary, packagedNode);
if (process.platform !== 'win32') chmodSync(packagedNode, 0o755);

console.log(`Agent runtime prepared: ${runtimeRoot}`);
