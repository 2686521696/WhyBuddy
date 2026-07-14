import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const vitePackageJson = require.resolve('vite/package.json');
const viteBin = path.join(path.dirname(vitePackageJson), 'bin', 'vite.js');

const result = spawnSync(process.execPath, [viteBin, 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    GITHUB_PAGES: 'true',
    DEPLOY_TARGET: 'github-pages',
  },
});

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

// SPA 深链接兜底：演示进入后 URL 是 /agent-loop/sliderule 之类的深路径，
// GitHub Pages 静态托管上没有对应文件，刷新会 404。Pages 对未匹配路径会
// 返回仓库的 404.html——复制一份 index.html 充当它，前端路由接管后恢复原页面。
const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'public'
);
copyFileSync(path.join(distDir, 'index.html'), path.join(distDir, '404.html'));
console.log('[build-pages] 404.html fallback written for SPA deep links');

process.exit(0);
