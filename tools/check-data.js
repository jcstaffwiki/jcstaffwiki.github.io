#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const isSpacer = value => typeof value === 'string' && ['', '-', '--', '---', 'spacer', '空行'].includes(value.trim().toLowerCase());

function validateStaff(entries, location, errors, allowNotes = true){
  if(!Array.isArray(entries)){ errors.push(`${location} 必须是数组`); return; }
  function person(value, at, keys){
    if(typeof value.name !== 'string' || !value.name.trim() || isSpacer(value.name)) errors.push(`${at}.name 必须是非空的原表记姓名`);
    if(Object.keys(value).some(key => !keys.includes(key))) errors.push(`${at} 姓名对象只支持${keys.join('、')}`);
    if(value.link !== undefined && typeof value.link !== 'boolean') errors.push(`${at}.link 必须是true或false`);
    if(value.slug !== undefined && (typeof value.slug !== 'string' || !value.slug.trim())) errors.push(`${at}.slug 必须是非空的人物文件名`);
  }
  function note(value, at){
    if(typeof value === 'string'){
      if(!value.trim()) errors.push(`${at} 备注文字不能为空`);
      return;
    }
    if(!Array.isArray(value) || !value.length){ errors.push(`${at} 必须是文字或由文字、姓名对象组成的非空数组`); return; }
    if(!value.some(part => typeof part === 'string' ? part.trim() : isObject(part) && typeof part.name === 'string' && part.name.trim())) errors.push(`${at} 备注内容不能为空`);
    value.forEach((part, i) => {
      if(typeof part === 'string') return;
      if(isObject(part)) person(part, `${at}[${i}]`, ['name', 'slug', 'link']);
      else errors.push(`${at}[${i}] 必须是备注文字或姓名对象`);
    });
  }
  function names(value, at, depth = 0, insideList = false){
    if(depth > 8){ errors.push(`${at} 所属层级超过8层，请检查循环或误写`); return 0; }
    if(typeof value === 'string') return isSpacer(value) ? 0 : 1;
    if(Array.isArray(value)){
      if(insideList){errors.push(`${at} 不支持直接嵌套名称数组，请用studio、members表示所属关系`);return 0;}
      return value.reduce((count, item, i) => count + names(item, `${at}[${i}]`, depth, true), 0);
    }
    if(isObject(value)){
      if(Object.hasOwn(value, 'name')){
        person(value, at, ['name', 'slug', 'link', 'note']);
        if(Object.hasOwn(value, 'note')){
          if(!allowNotes) errors.push(`${at}.note 只用于分集staff，主要staff请不写单集备注`);
          note(value.note, `${at}.note`);
        }
        return 1;
      }
      if(typeof value.studio !== 'string' || !value.studio.trim() || isSpacer(value.studio)){
        errors.push(`${at}.studio 必须是非空的机构原表记`);
      }
      if(!Array.isArray(value.members)){
        errors.push(`${at}.members 必须是人员数组`); return 0;
      }
      if(Object.keys(value).some(key => !['studio', 'members'].includes(key))) errors.push(`${at} 机构成员对象只支持studio和members`);
      const count = names(value.members, `${at}.members`, depth + 1);
      if(!count) errors.push(`${at}.members 没有人员，独立机构请直接写名称字符串`);
      return count + 1;
    }
    errors.push(`${at} 必须是名称、姓名对象、空行或机构成员对象`);
    return 0;
  }
  entries.forEach((entry, i) => {
    const at = `${location}[${i}]`;
    if(entry == null || isSpacer(entry)) return;
    if(isObject(entry)){
      if(typeof entry.section !== 'string' || !entry.section.trim() || Object.keys(entry).some(key => key !== 'section')){
        errors.push(`${at} 部门标题只能写 {"section":"部门原表记"}`);
      }
      return;
    }
    if(!Array.isArray(entry)){ errors.push(`${at} 必须是staff数组、空行或部门标题`); return; }
    if(!entry.length || isSpacer(entry[0])) return;
    if(typeof entry[0] !== 'string' || !entry[0].trim()) errors.push(`${at}[0] 必须是完整职称字符串`);
    if(entry.length < 2){ errors.push(`${at} 缺少第2项署名`); return; }
    const count = names(entry[1], `${at}[1]`);
    if(!count) errors.push(`${at} 没有有效署名`);
    entry.slice(2).forEach((option, j) => {
      const where = `${at}[${j + 2}]`;
      if(option == null) return;
      if(Array.isArray(option)){
        if(option.length !== count) errors.push(`${where} slug映射有${option.length}项，实际有${count}个署名（含机构，排除空行）`);
        if(option.some(slug => typeof slug !== 'string')) errors.push(`${where} slug映射数组只能包含字符串`);
      }else if(isObject(option)){
        Object.entries(option).forEach(([key, value]) => {
          if(key === 'split_role'){
            if(typeof value !== 'boolean') errors.push(`${where}.split_role 必须是true或false`);
          }else if(typeof value !== 'string') errors.push(`${where}.${key} 人物slug必须是字符串`);
        });
      }else if(typeof option !== 'string') errors.push(`${where} 必须是总览归类、slug映射或split_role设置`);
    });
  });
}

function validateWorkStaff(work, label, errors){
  const columns = work.production_info?.main_staff_columns;
  if(columns !== undefined){
    if(!Array.isArray(columns) || columns.length !== 2) errors.push(`${label}.main_staff_columns 必须有左右两列`);
    else columns.forEach((column, i) => validateStaff(column, `${label}.main_staff_columns[${i}]`, errors, false));
  }
  const detailed = work.detailed_staff;
  if(detailed !== undefined){
    if(!isObject(detailed) || !Array.isArray(detailed.episodes)) errors.push(`${label}.detailed_staff.episodes 必须是数组`);
    else detailed.episodes.forEach((episode, i) => {
      const at = `${label}.episodes[${i}]`;
      if(typeof episode?.label !== 'string') errors.push(`${at}.label 必须是段落名称`);
      validateStaff(episode?.staff, `${at}.staff`, errors);
    });
    if(!Array.isArray(detailed.overview_headers) || detailed.overview_headers.some(header => typeof header !== 'string')) errors.push(`${label}.overview_headers 必须是职称字符串数组`);
  }
}

function main(){
  const errors = [], warnings = [];
  const root = path.resolve(__dirname, '..');
  const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  try{
    if(process.argv[2] === '--staff-only'){
      if(!process.argv[3]) throw new Error('--staff-only 后面需要JSON文件路径');
      validateWorkStaff(read(path.resolve(process.argv[3])), path.basename(process.argv[3]), errors);
    }else{
      const manifest = read(path.join(root, 'data/works/index.json'));
      if(!Array.isArray(manifest.works)) throw new Error('index.json的works必须是数组');
      manifest.works.forEach(slug => {
        const filename = path.join(root, 'data/works', `${slug}.json`);
        if(!fs.existsSync(filename)){ errors.push(`${slug}：没有作品JSON`); return; }
        let work;
        try{work = read(filename);}catch(error){errors.push(`${slug}：JSON解析失败：${error.message}`);return;}
        if(work.slug !== slug) errors.push(`${slug}：内部slug与文件名不同`);
        if(work.season != null && !['冬','春','夏','秋'].includes(work.season)) errors.push(`${slug}：season不在冬、春、夏、秋中`);
        if(work.type != null && !['TV','剧场版','OVA','OAD','WEB','MV','制作协力','其他'].includes(work.type)) errors.push(`${slug}：type不在允许范围中`);
        if(work.sourceCategory != null && !['轻改','漫改','游戏改','原创','其他'].includes(work.sourceCategory)) errors.push(`${slug}：sourceCategory不在允许范围中`);
        function checkLinks(value, at){
          if(Array.isArray(value)) value.forEach((item, i) => checkLinks(item, `${at}[${i}]`));
          else if(isObject(value)) Object.entries(value).forEach(([key, item]) => checkLinks(item, `${at}.${key}`));
          else if(typeof value === 'string' && /^https?:/i.test(value)){
            try{const url = new URL(value);if(!url.hostname) throw new Error();}catch{errors.push(`${at}：链接格式不正确`);}
          }else if(typeof value === 'string' && (at.endsWith('.url') || at.endsWith('.href')) && value && !/^https?:\/\//i.test(value)) errors.push(`${at}：请填写http/https链接`);
        }
        checkLinks(work.links, `${slug}.links`); checkLinks(work.cn_streaming, `${slug}.cn_streaming`);
        validateWorkStaff(work, slug, errors);
        if(!['webp','jpg','jpeg','png','avif'].some(extension => fs.existsSync(path.join(root, 'data/covers', `${slug}.${extension}`)))) warnings.push(`${slug}：未找到封面，请核对仓库（无封面会显示占位图）`);
      });
    }
  }catch(error){errors.push(error.message);}
  errors.forEach(error => console.error(`错误：${error}`));
  warnings.forEach(warning => console.log(`提醒：${warning}`));
  console.log(`检查完成：${errors.length}个错误，${warnings.length}个提醒`);
  if(errors.length) process.exitCode = 1;
}
module.exports = {validateStaff, validateWorkStaff};
if(require.main === module) main();
