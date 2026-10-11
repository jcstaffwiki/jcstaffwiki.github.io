#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {validateWorkStaff, validateStaff} = require('./check-data.js');
const root = path.resolve(__dirname, '..');
const app = {window:{addEventListener(){}},document:{addEventListener(){}},console,URL,Map,Set};
vm.createContext(app);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8'), app);
const plain = value => JSON.parse(JSON.stringify(value));
const disputed = {name:'前園丈夫',link:false,note:['怀疑为“',{name:'前園文夫'},'”']};
const episode = {label:'第1话',staff:[
  ['演出',disputed],
  ['原画',[{studio:'机构A',members:[{name:'人员A',note:'仅核对本集署名。'},disputed]},'空行','独立人员']]
]};
const context = app.buildEpisodeNoteContext(episode, 0);
assert.equal(context.notes.length, 2, '同一署名重复使用同一备注');
const credit = app.normalizeStaffEntry(episode.staff[0]);
assert.deepEqual(plain(app.getStaffNames(credit)), ['前園丈夫']);
assert.equal(app.resolveStaffSlug('前園丈夫',0,credit), '', '禁用的署名不映射为人物');
const creditHtml = app.renderStaffNamesHTML(credit, '测试作品', context);
assert.match(creditHtml, /person-name-no-link[^>]*>前園丈夫<\/span>/);
assert(!creditHtml.includes('#/person/'), '原署名没有任何人物链接');
assert.match(creditHtml, /data-note-target="staff-note-0-1"/);
assert.match(creditHtml, />①<\/button>/);
const noteHtml = app.renderEpisodeNotes(context, '测试作品');
assert(noteHtml.includes('怀疑为“') && noteHtml.includes(encodeURIComponent('前園文夫')));
assert.equal((noteHtml.match(/id="staff-note-0-1"/g)||[]).length, 1);
assert(!noteHtml.includes(encodeURIComponent('前園丈夫')));
const next = app.buildEpisodeNoteContext({label:'第2话',staff:[['演出',disputed]]}, 1);
assert.equal(next.notes[0].number, 1, '下一集从①重置');
assert.notEqual(next.notes[0].id, context.notes[0].id, '不同单集的跳转目标互不串集');
assert.equal(app.renderEpisodeNotes(app.buildEpisodeNoteContext({staff:[['脚本','正常人员']]},2),'测试'), '');
assert.equal(app.staffNoteNumber(20), '⑳');
assert.equal(app.staffNoteNumber(21), '[21]');
const mapped = ['原画',[{studio:'机构A',members:[{name:'同名',slug:'显式人物',note:'备注A'},{name:'未确认',link:false,note:'备注B'}]},'普通人员'],['机构文件','旧映射','错误映射','']];
const mappedEntry = app.normalizeStaffEntry(mapped);
assert.deepEqual(plain(app.getStaffNames(mappedEntry).map((name,index)=>app.resolveStaffSlug(name,index,mappedEntry))),['机构文件','显式人物','','普通人员']);
const errors = [];
validateStaff([mapped],'姓名对象与机构混合',errors);
assert.deepEqual(errors, []);
for(const invalid of [
  ['演出',{name:'人员',link:'false'}],
  ['演出',{name:'人员',note:[]}],
  ['演出',{name:'人员',note:[{name:'疑似人',note:'嵌套备注'}]}],
  ['演出',{name:'人员',note:'备注'},['错误的多余映射','另一项']]
]){
  const errors = [];
  validateStaff([invalid],'不合法示例',errors);
  assert(errors.length > 0, '错误写法必须给出中文错误');
}
const noMainNote = [];
validateWorkStaff({production_info:{main_staff_columns:[[episode.staff[0]],[]]}},'主要staff',noMainNote);
assert(noMainNote.some(error=>error.includes('只用于分集staff')));
const hostileHtml = app.renderStaffNoteContent(['<img onerror="bad">',{name:'<script>bad</script>',slug:'人物'}],'测试');
assert(!hostileHtml.includes('<img') && !hostileHtml.includes('<script>'), '备注文字不作为HTML执行');
const sampleWork = {detailed_staff:{overview_headers:['演出'],episodes:[episode]}};
app.buildPeopleIndex([sampleWork]);
const indexed = plain(vm.runInContext('GLOBAL_PEOPLE',app));
assert(!indexed.some(person=>person.label==='前園丈夫'||person.label==='前園文夫'), '未关联署名和备注人物不计入真实人物索引');
assert.deepEqual(plain(app.getPersonRolesInWork(sampleWork,'前園丈夫')),['演出','原画'], '保留按原署名查所在作品');
assert.equal(app.getPersonRolesInWork(sampleWork,'前園文夫'),null, '疑似人物没有被计为本片岗位署名');
const work = JSON.parse(fs.readFileSync(path.join(root,'data/works/决斗大师LOST忘却的太阳.json'),'utf8'));
const ep3Index = work.detailed_staff.episodes.findIndex(ep=>ep.label==='第3话');
const ep3 = work.detailed_staff.episodes[ep3Index];
const realContext = app.buildEpisodeNoteContext(ep3,ep3Index);
assert.equal(realContext.notes.length, 1);
assert.deepEqual(plain(app.getStaffNames(app.getEpisodeStaff(ep3).find(row=>row.role==='演出'))),['前園丈夫']);
assert(!work.detailed_staff.episodes.some(ep=>ep.label==='OP'));
assert.deepEqual(work.detailed_staff.overview_headers,['脚本','分镜','演出','演出辅佐','制作进行']);
console.log('通过：原署名无链接、备注人物链接、单集重置与去重、机构混合、映射优先级、检索分离、文本转义、中文格式提示，以及本片实际数据。');
