/**
 * 一次性跑完所有静态检查 + 接口冒烟测试。
 *
 * 运行： node tools/check_all.mjs
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STEPS = [
  ['check_json.mjs', 'JSON 合法性'],
  ['check_wxml.mjs', 'WXML 结构'],
  ['check_fields.mjs', '数据字段 / 事件处理函数交叉核对'],
  ['check_icons.mjs', 'PNG 图标'],
  ['check_compat.mjs', '基础库 2.9 / Chrome 69 兼容性'],
  ['api_smoke.mjs', '后端 6 个接口冒烟测试']
];

let failed = 0;
for (const [script, label] of STEPS) {
  console.log('\n' + '#'.repeat(64));
  console.log('# ' + label + '  (' + script + ')');
  console.log('#'.repeat(64));
  const r = spawnSync(process.execPath, [join(__dirname, script)], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.log(`>>> ${label} 失败（exit ${r.status}）`);
  }
}

console.log('\n' + '='.repeat(64));
console.log(failed ? `${STEPS.length} 项检查，${failed} 项失败` : `${STEPS.length} 项检查全部通过`);
process.exit(failed ? 1 : 0);
