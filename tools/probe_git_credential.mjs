/**
 * 验证 git 凭据助手能否静默返回凭据（不需要弹窗交互）。
 *
 * 背景：git push 卡在「等待账号密码输入」是因为 credential helper 配置有误
 * （路径没加引号，gh.exe 启动失败 → git 回退到交互式弹窗）。
 * 这个脚本用 Node 精确喂 stdin 给 gh，模拟 git 调用凭据助手的方式。
 *
 * 运行：node tools/probe_git_credential.mjs
 */
import { spawnSync } from 'node:child_process';

const GH = 'C:/Program Files/GitHub CLI/gh.exe';
const input = 'protocol=https\nhost=github.com\n\n';

const r = spawnSync(GH, ['auth', 'git-credential', 'get'], {
  input,
  encoding: 'utf8',
  shell: false
});

console.log('exit code :', r.status);
console.log('stderr    :', (r.stderr || '').trim() || '(空)');
console.log('stdout    :');
for (const line of (r.stdout || '').split(/\r?\n/)) {
  if (!line.trim()) continue;
  if (line.startsWith('password=')) console.log('  password=***REDACTED***  (长度 ' + (line.length - 9) + ')');
  else console.log('  ' + line);
}

if (r.status !== 0 || !(r.stdout || '').includes('username=')) {
  console.log('\n结论：凭据助手不可用 —— git push 会卡在交互式弹窗。');
  process.exit(1);
}
console.log('\n结论：凭据助手可用，git push 可以静默完成。');
