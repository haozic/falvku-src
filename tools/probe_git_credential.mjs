/**
 * 验证 git 凭据助手能否静默返回凭据（不需要弹窗交互）。
 *
 * 背景：git push 卡在「等待账号密码输入」是因为 credential helper 配置有误。
 * 正确写法是 `!'C:/Program Files/GitHub CLI/gh.exe' auth git-credential`
 * —— **必须以 ! 开头**（告诉 git 这是 shell 命令而不是 helper 名），
 * **路径必须带引号**（路径里有空格）。少了任一样，git 会把
 * `credential-C:/Program Files/...` 当成子命令去找，报
 * 「'credential-...' is not a git command」，然后回退到交互式弹窗。
 *
 * 这个脚本做**两段**验证：
 *   ① 直接调 gh.exe（确认 gh 自己能出凭据）
 *   ② 走真实的 `git credential fill`（确认 git 能按配置调到它）
 * 只有 ② 也通过，才算真的能静默 push。
 *
 * 运行：node tools/probe_git_credential.mjs
 */
import { spawnSync } from 'node:child_process';

const GH = 'C:/Program Files/GitHub CLI/gh.exe';
const input = 'protocol=https\nhost=github.com\n\n';

/* ---------- ① 直接调 gh ---------- */

const r = spawnSync(GH, ['auth', 'git-credential', 'get'], {
  input,
  encoding: 'utf8',
  shell: false
});

console.log('=== ① 直接调用 gh.exe ===');
console.log('exit code :', r.status);
console.log('stderr    :', (r.stderr || '').trim() || '(空)');
console.log('stdout    :');
for (const line of (r.stdout || '').split(/\r?\n/)) {
  if (!line.trim()) continue;
  if (line.startsWith('password=')) console.log('  password=***REDACTED***  (长度 ' + (line.length - 9) + ')');
  else console.log('  ' + line);
}

const ghOk = r.status === 0 && (r.stdout || '').includes('username=');

/* ---------- ② 走 git 真实的凭据协议 ---------- */

console.log('\n=== ② 走 git credential fill（git 实际会走的路径） ===');

const g = spawnSync('git', ['credential', 'fill'], {
  input,
  encoding: 'utf8',
  shell: false
});

const gitOut = g.stdout || '';
console.log('exit code :', g.status);
console.log('stderr    :', (g.stderr || '').trim() || '(空)');
for (const line of gitOut.split(/\r?\n/)) {
  if (!line.trim()) continue;
  if (line.startsWith('password=')) console.log('  password=***REDACTED***  (长度 ' + (line.length - 9) + ')');
  else console.log('  ' + line);
}

const gitOk = g.status === 0 && gitOut.includes('username=') && gitOut.includes('password=');

if (!ghOk) {
  console.log('\n结论：gh.exe 本身不可用 —— 先跑 gh auth login。');
  process.exit(1);
}
if (!gitOk) {
  console.log('\n结论：git 调不到凭据助手 —— 配置有误。');
  console.log('正确写法（注意 ! 前缀与路径两侧的单引号）：');
  console.log("  git config --replace-all credential.helper \"!'C:/Program Files/GitHub CLI/gh.exe' auth git-credential\"");
  process.exit(1);
}
console.log('\n结论：凭据助手可用，git push 可以静默完成。');
