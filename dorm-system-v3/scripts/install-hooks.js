import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Do not accidentally change hooks on a parent repository when installing a ZIP.
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
if (result.status === 0 && resolve(result.stdout.trim()) === resolve(root)) {
  chmodSync(resolve(root, '.githooks/pre-commit'), 0o755);
  const install = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (install.status !== 0) process.exit(1);
  console.log('pre-commit 已安装：格式检查、ESLint、单元测试和接口测试。');
} else {
  console.log('当前目录不是独立 Git 仓库；git init 后执行 npm run prepare 安装提交检查。');
}
