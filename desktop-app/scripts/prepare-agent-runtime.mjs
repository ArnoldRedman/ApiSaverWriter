import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(desktopRoot, '..');
const runtimeRoot = join(desktopRoot, 'src-tauri', 'runtime', 'agent-runtime');
const sidecarEntry = join(workspaceRoot, 'sidecars', 'agent-runtime', 'dist', 'main.js');
const nodeBinary = process.env.ZHIZHANG_NODE_BINARY || process.execPath;
const mobileTarget = ['android', 'ios'].includes(String(process.env.TAURI_ENV_PLATFORM || '').toLowerCase());
const sqliteCheck = "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close();";

const runNpm = (args) => {
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], { cwd: workspaceRoot, stdio: 'inherit' });
    return;
  }
  execFileSync('npm', args, { cwd: workspaceRoot, stdio: 'inherit' });
};

const ensureNativeDependencies = () => {
  try {
    execFileSync(nodeBinary, ['-e', sqliteCheck], { cwd: workspaceRoot, stdio: 'pipe' });
  } catch {
    console.log(`Rebuilding better-sqlite3 for Node ${process.version} (ABI ${process.versions.modules})...`);
    runNpm(['rebuild', 'better-sqlite3']);
    try {
      execFileSync(nodeBinary, ['-e', sqliteCheck], { cwd: workspaceRoot, stdio: 'pipe' });
    } catch (error) {
      throw new Error(`better-sqlite3 与打包 Node.js 不兼容，自动重编译后仍无法加载：${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

const copyPackage = (name) => {
  const source = join(workspaceRoot, 'node_modules', ...name.split('/'));
  const target = join(runtimeRoot, 'node_modules', ...name.split('/'));
  if (!existsSync(source)) throw new Error(`缺少 Agent 运行时依赖：${name}`);
  cpSync(source, target, { recursive: true });
};

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(runtimeRoot, { recursive: true });

// iOS and Android use Tauri's native HTTP plugin. Node child processes and
// native SQLite modules are only bundled for desktop targets.
if (mobileTarget) {
  console.log(`Skipping desktop Agent sidecar for ${process.env.TAURI_ENV_PLATFORM}; mobile uses direct native HTTP.`);
  process.exit(0);
}

runNpm(['run', 'build', '--workspace', '@zhizhang/agent-runtime']);
ensureNativeDependencies();
buildSync({
  entryPoints: [sidecarEntry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['better-sqlite3', 'undici', 'iconv-lite'],
  outfile: join(runtimeRoot, 'main.cjs'),
  logLevel: 'info',
});

// better-sqlite3 is a native module. Keep it external to the single-file JS
// bundle and carry its matching prebuilt binary alongside the bundled runtime.
for (const dependency of ['better-sqlite3', 'bindings', 'file-uri-to-path', 'undici', 'iconv-lite', 'safer-buffer']) copyPackage(dependency);

const packagedNode = join(runtimeRoot, process.platform === 'win32' ? 'node.exe' : 'node');
if (!existsSync(nodeBinary)) throw new Error(`找不到用于打包的 Node.js：${nodeBinary}`);
copyFileSync(nodeBinary, packagedNode);
if (process.platform !== 'win32') chmodSync(packagedNode, 0o755);
execFileSync(packagedNode, ['-e', sqliteCheck], { cwd: runtimeRoot, stdio: 'pipe' });

console.log(`Agent runtime prepared: ${runtimeRoot}`);
