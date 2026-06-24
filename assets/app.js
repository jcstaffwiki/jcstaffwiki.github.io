// ========= 全局状态 =========
let LAST_WORK_SLUG = null; 
let CURRENT_WORK = null;          // 当前打开的作品
let CURRENT_WORK_PEOPLE = [];     // 当前作品内登场的所有职员字典

// ========= 视图切换 =========
const VIEWS = ["overview", "works", "work", "person"];
function show(view){
  VIEWS.forEach(v=>{
    const sec = document.getElementById(`view-${v}`);
    if(sec) sec.hidden = (v !== view);
  });
  document.querySelectorAll('nav a[data-view]').forEach(a=>{
    a.classList.toggle('active', a.dataset.view === view);
  });
}
function applyRoute(){
  const h = location.hash || "#/overview";
  if(h.startsWith("#/person/")){
    const slug = decodeURIComponent(h.replace("#/person/",""));
    show("person");
    renderPersonDetail(slug);
  }else if(h.startsWith("#/work/")){
    const slug = decodeURIComponent(h.replace("#/work/",""));
    show("work");
    renderWorkDetail(slug);
  }else if(h === "#/works"){
    LAST_WORK_SLUG = null; 
    show("works");
    const y = parseInt(sessionStorage.getItem("worksListScroll") || "0", 10);
    requestAnimationFrame(() => window.scrollTo(0, y));
    setTimeout(() => window.scrollTo(0, y), 0);
  }else{
    LAST_WORK_SLUG = null; 
    show("overview");
    window.scrollTo(0,0);
  }
}
window.addEventListener("hashchange", applyRoute);

// ========= 配置 =========
const MANIFEST_URL = "data/works/index.json";
let YEAR_MIN = 1986;
let YEAR_MAX = 2100;
let SORT_DESC = true; 

const KNOWN_TYPES = ["TV","剧场版","OVA","OAD","WEB","MV","制作协力","其他"];
function normalizeType(t){
  const s = String(t||"").trim();
  if(!s) return "";
  return KNOWN_TYPES.includes(s) ? s : "其他";
}
function seasonIndex(season){
  if(!season) return -1;
  const s = String(season).trim().toLowerCase();
  const map = { "冬":0,"春":1,"夏":2,"秋":3, "winter":0,"spring":1,"summer":2,"autumn":3,"fall":3 };
  return map[s] ?? -1;
}
const cnSeason = ["冬","春","夏","秋"];

function splitNames(str){ return String(str || "").split(/[、，,\/]\s*/).map(s => s.trim()).filter(Boolean); }
function cleanName(str) { return String(str || "").replace(/[(（].*?[)）]/g, '').trim(); }

// ========= 数据加载与全局人名索引 =========
let ALL_WORKS = [];
let GLOBAL_PEOPLE = []; 

function buildPeopleIndex(works) {
  const map = new Map(); 
  works.forEach(w => {
    const [m1, m2] = collectMainStaffColumns(w);
    [...m1, ...m2].forEach(col => {
      if(!col.spacer && col.tokens) {
        col.tokens.forEach(t => map.set(t.slug, t.cleanLabel || t.label));
      }
    });
    
    if (w.detailed_staff && w.detailed_staff.episodes) {
      w.detailed_staff.episodes.forEach(ep => {
        getEpisodeStaff(ep).forEach(roleObj => {
          const names = getStaffNames(roleObj);
          names.forEach((rawName, index) => {
            const cName = cleanName(rawName);
            const slug = resolveStaffSlug(rawName, index, roleObj);
            map.set(slug, cName);
          });
        });
      });
    }
  });
  GLOBAL_PEOPLE = Array.from(map.entries()).map(([slug, label]) => ({ label, slug, name_jp: "", aliases: [] }));
}

async function enrichPeopleData() {
  const uniqueSlugs = [...new Set(GLOBAL_PEOPLE.map(p => p.slug))];
  await Promise.all(uniqueSlugs.map(async slug => {
    try {
      const res = await fetch(`data/people/${slug}.json`, {cache: "no-store"});
      if (res.ok) {
        const data = await res.json();
        GLOBAL_PEOPLE.forEach(p => {
          if (p.slug === slug) {
            p.name_jp = data.name_jp || "";
            p.aliases = data.aliases || [];
          }
        });
      }
    } catch(e) {}
  }));
}

async function loadWorks(){
  try{
    const res = await fetch(MANIFEST_URL,{cache:"no-store"});
    const { works = [] } = await res.json();
    const files = await Promise.all(
      works.map(slug => fetch(`data/works/${slug}.json`,{cache:"no-store"}).then(r=>r.json()).catch(()=>null))
    );
    ALL_WORKS = files.filter(Boolean);
    buildPeopleIndex(ALL_WORKS);
    await enrichPeopleData();
    renderWorks(ALL_WORKS, "", "");
  }catch(e){
    console.error("加载作品失败：",e);
    renderWorks([], "", "");
  }
}
const getWorkBySlug = slug => ALL_WORKS.find(w=>w.slug===slug);

// ========= 时间处理 =========
function formatFullDate(w){
  const src = w.premiere || w.date || w.start || "";
  if(!src) return "";
  const m = String(src).match(/(\d{4})(?:[^\d]?(\d{1,2}))?(?:[^\d]?(\d{1,2}))?/);
  if(!m) return "";
  const y = m[1];
  const mo = m[2] ? String(parseInt(m[2],10)) : "";
  const d  = m[3] ? String(parseInt(m[3],10)) : "";
  return [y,mo,d].filter(Boolean).join(".");
}
function premiereKey(w){
  const src = w.premiere || w.date || w.start || "";
  const m = String(src).match(/(\d{4})(?:[^\d]?(\d{1,2}))?(?:[^\d]?(\d{1,2}))?/);
  if(!m) return Number.POSITIVE_INFINITY;
  const y  = parseInt(m[1],10);
  let mo = m[2] ? parseInt(m[2],10) : 1;
  let d  = m[3] ? parseInt(m[3],10) : 1;
  if(!(mo>=1&&mo<=12)) mo=1;
  if(!(d>=1&&d<=31)) d=1;
  return y*10000 + mo*100 + d;
}

// ========= 封面渲染 =========
function setCoverImage(wrapperEl, work, fallbackCss){
  wrapperEl.innerHTML = "";
  wrapperEl.removeAttribute("style");
  const trySrc = [];
  if(work.cover) trySrc.push(work.cover);
  if(work.slug){
    const base = `data/covers/${work.slug}`;
    trySrc.push(`${base}.webp`, `${base}.jpg`, `${base}.png`);
  }
  if(!trySrc.length){
    wrapperEl.setAttribute("style", fallbackCss);
    return;
  }
  const img = document.createElement("img");
  let i = 0;
  img.loading = "lazy";
  img.alt = `${work.title || work.slug || "作品"} 封面`;
  img.onerror = ()=>{
    i += 1;
    if(i >= trySrc.length){
      wrapperEl.setAttribute("style", fallbackCss);
      img.remove();
    }else{
      img.src = trySrc[i];
    }
  };
  img.src = trySrc[i];
  wrapperEl.appendChild(img);
}

// ========= 提取职位逻辑 =========
function isPersonMatch(slug, rawLabel, kw) {
  const cName = cleanName(rawLabel);
  if (cName.toLowerCase().includes(kw) || rawLabel.toLowerCase().includes(kw) || slug.toLowerCase().includes(kw)) return true;
  const pData = GLOBAL_PEOPLE.find(p => p.slug === slug);
  if (pData) {
    if ((pData.name_jp || "").toLowerCase().includes(kw)) return true;
    if ((pData.aliases || []).some(a => String(a).toLowerCase().includes(kw))) return true;
  }
  return false;
}

function getPersonRolesInWork(work, keyword) {
  if (!keyword) return null;
  const kw = keyword.toLowerCase();
  const roles = new Set();
  let matched = false;

  const [m1, m2] = collectMainStaffColumns(work);
  [...m1, ...m2].forEach(col => {
    if (col.spacer) return;
    const hasMatch = col.tokens.some(t => isPersonMatch(t.slug, t.label, kw));
    if (hasMatch && col.role) {
      roles.add(col.role);
      matched = true;
    }
  });

  if (work.detailed_staff && work.detailed_staff.episodes) {
    work.detailed_staff.episodes.forEach(ep => {
      getEpisodeStaff(ep).forEach(roleObj => {
        const names = getStaffNames(roleObj);
        const hasMatch = names.some((rawName, index) => {
          const slug = resolveStaffSlug(rawName, index, roleObj);
          return isPersonMatch(slug, rawName, kw);
        });
        if (hasMatch && roleObj.role) {
          roles.add(roleObj.role);
          matched = true;
        }
      });
    });
  }

  return matched ? Array.from(roles) : null;
}

function isWorkMatchTitle(work, kw) {
    if (!kw) return false;
    const q = kw.toLowerCase();
    return (work.title||"").toLowerCase().includes(q) || getOriginalTitle(work).toLowerCase().includes(q);
}

// ========= 列表页 =========
function formatEpisodesTag(val){
  if(val === undefined || val === null || val === "") return "";
  if (typeof val === "number" && Number.isFinite(val)) return `共${val}话`;
  return String(val);
}
function formatResponsibilityTag(val){
  if(val === undefined || val === null) return "";
  if (Array.isArray(val)) return val.filter(Boolean).join("、");
  return String(val).trim();
}

function renderWorks(list, rawQ1, rawQ2){
  const box = document.getElementById("works-container");
  if(!box) return;
  box.innerHTML = "";

  const kw1 = String(rawQ1 || "").trim().toLowerCase();
  const kw2 = String(rawQ2 || "").trim().toLowerCase();

  let items = list.filter(w =>
    Number.isInteger(w.seasonYear) &&
    w.season && seasonIndex(w.season) >= 0 &&
    w.seasonYear >= YEAR_MIN && w.seasonYear <= YEAR_MAX
  );

  const groups = new Map();
  items.forEach(w=>{
    const si = seasonIndex(w.season);
    const key = `${w.seasonYear}-${si}`;
    if(!groups.has(key)) groups.set(key, {year:w.seasonYear, si, items:[]});
    groups.get(key).items.push(w);
  });

  const entries = Array.from(groups.values()).sort((A,B)=>{
    if(SORT_DESC){ if(B.year!==A.year) return B.year-A.year; return B.si-A.si; }
    else         { if(A.year!==B.year) return A.year-B.year; return A.si-B.si; }
  });

  entries.forEach(g=>{
    const itemsAsc = g.items.slice().sort((a,b)=>{
      const ka=premiereKey(a), kb=premiereKey(b);
      if(ka!==kb) return ka-kb;
      return (a.title||"").localeCompare(b.title||"","zh");
    });

    const section = document.createElement("section");
    section.className = "season-group";
    section.innerHTML = `<h3 class="group-title">${g.year} 年 · ${cnSeason[g.si]}</h3><div class="works-grid"></div>`;
    const grid = section.querySelector(".works-grid");

    itemsAsc.forEach(work=>{
      const color = work.color || "#6a11cb";
      const fallback = `background:linear-gradient(135deg, ${color}30, ${color}70);`;

      let tagsHTML = "";
      
      let roles1 = kw1 ? getPersonRolesInWork(work, kw1) : null;
      let roles2 = kw2 ? getPersonRolesInWork(work, kw2) : null;

      if (kw1 && kw2 && kw1 === kw2) {
          roles2 = null; 
      }

      const buildTagRow = (roles, colorClass) => {
          if (!roles || roles.length === 0) return "";
          const splitRoles = new Set();
          roles.forEach(r => {
            r.split(/[・·\/]/).forEach(subRole => {
              const cleanSubRole = subRole.trim();
              if (cleanSubRole) splitRoles.add(cleanSubRole);
            });
          });
          
          return `<div class="work-tags-row">` + 
                 Array.from(splitRoles).map(r => `<span class="work-tag tag-role ${colorClass}">${escapeHTML(r)}</span>`).join('') + 
                 `</div>`;
      };

      if (roles1 || roles2) {
          let row1HTML = buildTagRow(roles1, "tag-role-1");
          let row2HTML = buildTagRow(roles2, "tag-role-2");
          tagsHTML = row1HTML + row2HTML;
      } else {
          const typeTag = work.type ? `<span class="work-tag">${escapeHTML(String(work.type))}</span>` : "";
          const srcTag  = work.sourceCategory ? `<span class="work-tag">${escapeHTML(String(work.sourceCategory))}</span>` : "";
          let thirdTag = "";
          if (normalizeType(work.type) === "制作协力") {
            const resp = formatResponsibilityTag(work.responsibility);
            if(resp) thirdTag = `<span class="work-tag">${escapeHTML(resp)}</span>`;
          } else {
            const epTxt = formatEpisodesTag(work.episodes);
            if(epTxt) thirdTag = `<span class="work-tag">${escapeHTML(epTxt)}</span>`;
          }
          tagsHTML = `<div class="work-tags-row">${typeTag}${srcTag}${thirdTag}</div>`;
      }

      const card = document.createElement("div");
      card.className = "work-card";
      card.innerHTML = `
        <div class="work-image"></div>
        <div class="work-content">
          <h3 class="work-title">${escapeHTML(work.title||"")}</h3>
          <div class="work-meta">${tagsHTML}</div>
        </div>
      `;
      setCoverImage(card.querySelector(".work-image"), work, fallback);
      card.addEventListener("click", ()=>{ if(work.slug) location.hash = `#/work/${encodeURIComponent(work.slug)}`; });
      grid.appendChild(card);
    });

    box.appendChild(section);
  });
}

// ========= 详情页辅助函数 =========
function formatEpisodesForDetail(val){
  if(val === undefined || val === null || val === "") return "";
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  return String(val);
}

const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const makeBadge = txt => { const s=document.createElement("span"); s.className="badge"; s.textContent=txt; return s; };
function appendTextItem(ul, text){
  const li = document.createElement("li");
  li.textContent = text;
  ul.appendChild(li);
}
function toSafeExternalUrl(url){
  const raw = String(url || "").trim();
  if(!raw) return "";
  try{
    const parsed = new URL(raw, location.href);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") ? parsed.href : "";
  }catch{
    return "";
  }
}
function appendExternalLinkItem(ul, title, url){
  const li = document.createElement("li");
  const safeUrl = toSafeExternalUrl(url);
  if(!safeUrl){
    li.textContent = `${title || "链接"}（链接无效）`;
    ul.appendChild(li);
    return;
  }
  const a = document.createElement("a");
  a.href = safeUrl;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = title || safeUrl;
  li.appendChild(a);
  ul.appendChild(li);
}
function setKeyValueLine(el, label, value){
  el.textContent = "";
  const b = document.createElement("b");
  b.textContent = label;
  el.appendChild(b);
  el.appendChild(document.createTextNode(value));
  el.hidden = false;
}
function isPlainObject(x){ return x && typeof x === 'object' && !Array.isArray(x); }
function isSpacerMarker(value){
  const s = String(value ?? "").trim().toLowerCase();
  return !s || s === "-" || s === "--" || s === "---" || s === "spacer" || s === "空行";
}
function makeStaffEntry(data){
  return Object.assign({ _normalizedStaffEntry: true }, data);
}
function normalizeStaffEntry(entry){
  if(entry && entry._normalizedStaffEntry) return entry;
  if(entry === null || entry === undefined) return makeStaffEntry({ spacer: true });
  if(typeof entry === "string") return isSpacerMarker(entry) ? makeStaffEntry({ spacer: true }) : makeStaffEntry({ invalid: true });
  if(isPlainObject(entry)) return makeStaffEntry({ invalid: true });

  if(Array.isArray(entry)){
    if(entry.length === 0 || isSpacerMarker(entry[0])) return makeStaffEntry({ spacer: true });

    const [role, names, opt1, opt2] = entry;
    const normalized = makeStaffEntry({
      role: String(role || ""),
      names: Array.isArray(names) ? names : (names === undefined || names === null ? [] : [names])
    });

    [opt1, opt2].forEach(opt => {
      if(opt === undefined || opt === null) return;
      if(Array.isArray(opt)){
        normalized.slugList = opt;
      }else if(isPlainObject(opt)){
        normalized.slugMap = opt;
      }else if(!normalized.map_to){
        normalized.map_to = String(opt);
      }
    });

    return normalized;
  }

  return makeStaffEntry({ invalid: true });
}
function getStaffNames(entry){
  const item = normalizeStaffEntry(entry);
  if(Array.isArray(item.names)) return item.names.map(n=>String(n||"").trim()).filter(Boolean);
  return [];
}
function getEpisodeStaff(ep){
  return Array.isArray(ep?.staff) ? ep.staff.map(normalizeStaffEntry) : [];
}
function resolveStaffSlug(rawLabel, index, entry){
  const cName = cleanName(rawLabel);
  const item = normalizeStaffEntry(entry);
  const localMap = isPlainObject(item.slugMap) ? item.slugMap : null;
  const localList = Array.isArray(item.slugList) ? item.slugList : null;

  return (localList && localList[index]) ? String(localList[index])
       : (localMap && localMap[rawLabel]) ? String(localMap[rawLabel])
       : (localMap && localMap[cName]) ? String(localMap[cName])
       : cName;
}
function getOriginalTitle(w){
  return (
    w.title_original || w.titleOriginal ||
    w.originalTitle || w.nativeTitle || ""
  );
}

function collectMainStaffColumns(work){
  const pi = work.production_info || {};
  const result = [[],[]];
  if (!Array.isArray(pi.main_staff_columns)) return result;

  [0,1].forEach(idx=>{
    const col = Array.isArray(pi.main_staff_columns[idx]) ? pi.main_staff_columns[idx] : [];
    col.forEach(rawEntry=>{
      const entry = normalizeStaffEntry(rawEntry);
      if (entry.spacer) {
        result[idx].push({ spacer: true });
        return;
      }

      if(entry.invalid) return;

      const role = String(entry?.role || "");
      const names = getStaffNames(entry);
      const tokens = names.map((rawLabel, i) => {
        const cName = cleanName(rawLabel);
        const slug = resolveStaffSlug(rawLabel, i, entry);
        return { label: rawLabel, cleanLabel: cName, slug: slug };
      });

      if (role || tokens.length){ result[idx].push({ role, tokens }); }
    });
  });
  return result;
}

function hasRealMainStaff(entries){
  return entries.some(item => {
    if (!item || item.spacer) return false;
    const hasRole = String(item.role || "").trim().length > 0;
    const hasTokens = Array.isArray(item.tokens) && item.tokens.length > 0;
    return hasRole || hasTokens;
  });
}

function setTempPersonLabel(slug,label){ try{ sessionStorage.setItem("personLabel:"+slug, String(label||"")); }catch{} }
function getTempPersonLabel(slug){ try{ return sessionStorage.getItem("personLabel:"+slug) || ""; }catch{} return ""; }
function saveWorkScroll(slug){ try{ sessionStorage.setItem("workScroll:"+slug, String(window.scrollY)); }catch{} }

function restoreWorkScroll(slug){
  try{
    const key = "workScroll:"+slug;
    const y = parseInt(sessionStorage.getItem(key)||"0",10);
    if(Number.isFinite(y) && y > 0){
      requestAnimationFrame(()=> window.scrollTo(0,y));
      setTimeout(()=> window.scrollTo(0,y), 0);
      sessionStorage.removeItem(key);
    } else {
      window.scrollTo(0,0); 
    }
  }catch{}
}

function clearWorkStaffFilter() {
    const normalView = document.getElementById("work-staff-normal-view");
    const filterView = document.getElementById("work-staff-filtered-view");
    if (normalView) normalView.hidden = false;
    if (filterView) filterView.hidden = true;
    
    const dynamicHeading = document.getElementById("work-staff-dynamic-heading");
    if (dynamicHeading) dynamicHeading.style.visibility = "visible";
    
    const input = document.getElementById("work-staff-search-input");
    if(input) input.value = "";
    const clearBtn = document.getElementById("work-staff-search-clear");
    if(clearBtn) clearBtn.hidden = true;
}

function applyWorkStaffFilter(w, targetSlug, targetLabel) {
    document.getElementById("work-staff-normal-view").hidden = true;
    const filterView = document.getElementById("work-staff-filtered-view");
    filterView.hidden = false;

    const dynamicHeading = document.getElementById("work-staff-dynamic-heading");
    if (dynamicHeading) dynamicHeading.style.visibility = "hidden";

    let html = `<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px;">
                  <h4 style="font-size: 1.25rem; color: #fff; margin-bottom: 24px; display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-user-check" style="color: #10b981;"></i>
                    ${escapeHTML(targetLabel)} <span style="font-size: 0.9rem; color: #a7a7a7; font-weight: normal;">在本作的负责职务</span>
                  </h4>`;

    const [m1, m2] = collectMainStaffColumns(w);
    const mainRoles = [];
    [...m1, ...m2].forEach(item => {
        if(item.spacer) return;
        if(item.tokens && item.tokens.some(t => t.slug === targetSlug)) {
            if (item.role) mainRoles.push(item.role);
        }
    });

    if (mainRoles.length > 0) {
        html += `<div style="margin-bottom: 24px;">
                   <div style="font-size: 0.9rem; color: #a7a7a7; margin-bottom: 10px; font-weight: 700;">主要职务</div>
                   <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                     ${mainRoles.map(r => `<span class="work-tag tag-role" style="background: linear-gradient(90deg, #6a11cb, #2575fc); font-size: 0.85rem; padding: 6px 12px;">${escapeHTML(r)}</span>`).join('')}
                   </div>
                 </div>`;
    }

    const epRoles = []; 
    if (w.detailed_staff && w.detailed_staff.episodes) {
        const ds = w.detailed_staff;
        ds.episodes.forEach(ep => {
            getEpisodeStaff(ep).forEach(roleObj => {
                const names = getStaffNames(roleObj);
                const isMatch = names.some((rawName, index) => {
                    const s = resolveStaffSlug(rawName, index, roleObj);
                    return s === targetSlug;
                });
                if (isMatch && roleObj.role) {
                    epRoles.push({ ep: ep.label, role: roleObj.role });
                }
            });
        });
    }

    if (epRoles.length > 0) {
         html += `<div>
                   <div style="font-size: 0.9rem; color: #a7a7a7; margin-bottom: 12px; font-weight: 700;">详细职务</div>
                   <div style="display: flex; flex-direction: column; gap: 6px;">
                     ${epRoles.map(er => `
                        <div style="display: flex; align-items: center; background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.04); padding: 12px 16px; border-radius: 6px; border-left: 3px solid #6a11cb;">
                           <div style="width: 140px; flex-shrink: 0; font-weight: 800; color: #b9d4ff; font-size: 0.95rem;">${escapeHTML(er.ep || "-")}</div>
                           <div style="flex: 1; color: #fff; font-size: 0.95rem; font-weight: 700;">${escapeHTML(er.role)}</div>
                        </div>
                     `).join('')}
                   </div>
                 </div>`;
    }

    if (mainRoles.length === 0 && epRoles.length === 0) {
        html += `<div style="color: #a7a7a7; padding: 20px 0; text-align: center;">该人员在本作中没有明确的职务记录。</div>`;
    }

    html += `</div>`;
    filterView.innerHTML = html;
}

async function renderWorkDetail(slug){
  let w = getWorkBySlug(slug);
  if(!w){ try{ w = await fetch(`data/works/${slug}.json`,{cache:"no-store"}).then(r=>r.json()); }catch{} }
  LAST_WORK_SLUG = slug;
  CURRENT_WORK = w;
  CURRENT_WORK_PEOPLE = [];
  clearWorkStaffFilter(); 

  const titleEl = document.getElementById("work-page-title");
  const subtitleEl = document.getElementById("work-subtitle");
  const coverEl = document.getElementById("work-cover");
  const badges = document.getElementById("work-badges");
  let epEl = document.getElementById("work-episodes");
  let dateEl = document.getElementById("work-premiere");
  const linksInline = document.getElementById("work-links-inline");
  const copyrightEl = document.getElementById("work-copyright");

  if(!w){
    titleEl.textContent = "未找到该作品";
    if(subtitleEl){ subtitleEl.textContent=""; subtitleEl.hidden=true; }
    badges.innerHTML = "";
    epEl.hidden = true; dateEl.hidden = true;
    linksInline.innerHTML = ""; linksInline.hidden = true;
    copyrightEl.textContent = ""; copyrightEl.hidden = true;
    coverEl.innerHTML = ""; coverEl.removeAttribute("style");
    window.scrollTo(0,0); 
    return;
  }

  titleEl.textContent = w.title || "";
  const originalTitle = getOriginalTitle(w);
  if(subtitleEl){
    if(originalTitle){ subtitleEl.textContent = String(originalTitle); subtitleEl.hidden = false; }
    else{ subtitleEl.textContent = ""; subtitleEl.hidden = true; }
  }

  const color = w.color || "#6a11cb";
  const fallback = `background:linear-gradient(135deg, ${color}30, ${color}70);`;
  setCoverImage(coverEl, w, fallback);

  badges.innerHTML = "";
  if(w.type) badges.appendChild(makeBadge(w.type));
  if(w.sourceCategory) badges.appendChild(makeBadge(w.sourceCategory));

  const isCoop = normalizeType(w.type) === "制作协力";
  if(isCoop){
    const resp = formatResponsibilityTag(w.responsibility);
    if(resp){ setKeyValueLine(epEl, "负责内容：", resp); } else epEl.hidden = true;
  }else{
    const epTxtDetail = formatEpisodesForDetail(w.episodes);
    if(epTxtDetail){ setKeyValueLine(epEl, "集数：", epTxtDetail); } else epEl.hidden = true;
  }

  const full = formatFullDate(w);
  if(full){ setKeyValueLine(dateEl, "首播日期：", full); } else dateEl.hidden = true;

  const linkNames = {
    official: "官方网站",
    twitter: "推特",
    bangumi: "bangumi",
    moegirl: "萌娘百科",
    seesaa: "Seesaawiki",
    keyframe_staff_list: "KeyFrame Staff List",
    sakugabooru: "SAKUGABOORU"
  };
  const order = ["official","twitter","bangumi","moegirl","seesaa","keyframe_staff_list","sakugabooru"];
  linksInline.innerHTML = "";

  const isPlain = isPlainObject(w.links);
  const linksIsNull = w.hasOwnProperty('links') && w.links === null;
  let list = [];
  if(isPlain){
    order.forEach(k => { if(w.links[k]) list.push({ title: linkNames[k] || k, url: w.links[k] }); });
    Object.keys(w.links).forEach(k => { if(!order.includes(k) && w.links[k]) list.push({ title: k, url: w.links[k] }); });
  }
  const linksShouldShow = linksIsNull || list.length > 0;

  const cnIsNull = w.hasOwnProperty('cn_streaming') && w.cn_streaming === null;
  const cnArr = Array.isArray(w.cn_streaming) ? w.cn_streaming.filter(item => item && item.title && item.url) : [];
  const cnShouldShow = cnIsNull || cnArr.length > 0;

  if(linksShouldShow || cnShouldShow){
    if(linksShouldShow){
      const col1 = document.createElement("div"); col1.className = "links-col related-links-col";
      const h1 = document.createElement("h3"); h1.textContent = "相关链接";
      const columnsWrap = document.createElement("div");
      columnsWrap.className = "links-list-columns";
      const maxLinksPerCol = list.length > 8 ? Math.ceil(list.length / 2) : 4;
      const chunks = linksIsNull ? [[]] : [];
      if(!linksIsNull){
        for(let i = 0; i < list.length; i += maxLinksPerCol){
          chunks.push(list.slice(i, i + maxLinksPerCol));
        }
      }
      chunks.forEach((chunk, index) => {
        const ul = document.createElement("ul");
        ul.className = "links-list";
        if(index === 0) ul.id = "work-links";
        if(linksIsNull) appendTextItem(ul, "暂无");
        else chunk.forEach(({url,title})=> appendExternalLinkItem(ul, title, url));
        columnsWrap.appendChild(ul);
      });
      col1.appendChild(h1); col1.appendChild(columnsWrap); linksInline.appendChild(col1);
    }
    if(cnShouldShow){
      const col2 = document.createElement("div"); col2.className = "links-col cn-links-col";
      const h2 = document.createElement("h3"); h2.textContent = "中国大陆正版";
      const ul2 = document.createElement("ul"); ul2.id = "work-cn-streaming";
      if(cnIsNull) appendTextItem(ul2, "暂无");
      else cnArr.forEach(({url,title})=> appendExternalLinkItem(ul2, title, url));
      col2.appendChild(h2); col2.appendChild(ul2); linksInline.appendChild(col2);
    }
    linksInline.hidden = false;
  } else { linksInline.hidden = true; }

  const cp = (w.copyright ?? "").toString().trim();
  if(cp){ copyrightEl.textContent = cp; copyrightEl.hidden = false; } else { copyrightEl.textContent = ""; copyrightEl.hidden = true; }

  const seenSlugs = new Set();
  const addPersonToWork = (label, slug) => {
      if(!seenSlugs.has(slug)) {
          seenSlugs.add(slug);
          CURRENT_WORK_PEOPLE.push({ label, slug });
      }
  };

  const staffBlock = document.getElementById("work-staff-block");
  const col1Ul = document.getElementById("work-staff-col-1");
  const col2Ul = document.getElementById("work-staff-col-2");
  if(col1Ul) col1Ul.innerHTML = "";
  if(col2Ul) col2Ul.innerHTML = "";

  const [col1Entries, col2Entries] = collectMainStaffColumns(w);

  const renderCol = (ul, entries)=>{
    entries.forEach(item => {
      if (item.spacer) {
        const li = document.createElement("li");
        li.style.listStyle = "none"; 
        li.innerHTML = "&nbsp;";     
        ul.appendChild(li);
        return;
      }

      const {role, tokens} = item;
      const li = document.createElement("li");
      const strong = document.createElement("b"); strong.textContent = role ? role + "：" : ""; li.appendChild(strong);
      
      tokens.forEach(t=>{
        addPersonToWork(t.cleanLabel || t.label, t.slug);

        const span = document.createElement("span"); 
        span.className = "person-token";
        span.style.whiteSpace = "nowrap";

        const cleanText = t.cleanLabel || t.label;
        const remarkText = t.label.replace(cleanText, '').trim();

        const a = document.createElement("a");
        a.href = "#/person/" + encodeURIComponent(t.slug);
        a.textContent = cleanText; 
        a.className = "person-link";
        a.addEventListener("click", ()=> { 
          saveWorkScroll(w.slug || LAST_WORK_SLUG || ""); 
          setTempPersonLabel(t.slug, cleanText); 
        });
        span.appendChild(a); 

        if (remarkText) {
            const rSpan = document.createElement("span");
            rSpan.textContent = remarkText;
            span.appendChild(rSpan);
        }

        li.appendChild(span);
      });
      ul.appendChild(li);
    });
  };

  renderCol(col1Ul, col1Entries); renderCol(col2Ul, col2Entries);
  
  const detailedBlock = document.getElementById("work-detailed-staff-block");
  let hasDetailed = false;

  if (detailedBlock) {
    const ds = w.detailed_staff;
    if (ds && Array.isArray(ds.episodes) && ds.episodes.length > 0) {
      hasDetailed = true;

      ds.episodes.forEach(ep => {
         getEpisodeStaff(ep).forEach(roleObj => {
             getStaffNames(roleObj).forEach((rawName, index) => {
                 const cName = cleanName(rawName);
                 const slug = resolveStaffSlug(rawName, index, roleObj);
                 addPersonToWork(cName, slug);
             });
         });
      });

      let html = `<h3 id="work-detailed-staff-heading" style="margin-top: 32px;">详细制作人员</h3>`;

      const episodeOptions = [{ label: "总览", target: "ep-tab-overview" }]
        .concat(ds.episodes.map((ep, i) => ({ label: ep.label || `第${i+1}项`, target: `ep-tab-${i}` })));

      html += `<div class="episode-tabs-row">
                 <div class="episode-tabs-nav">
                   <button class="ep-tab-btn active" data-target="ep-tab-overview">总览</button>`;
      ds.episodes.forEach((ep, i) => {
          html += `<button class="ep-tab-btn" data-target="ep-tab-${i}">${escapeHTML(ep.label || `第${i+1}项`)}</button>`;
      });
      html += `</div>
                 <div class="episode-jump">
                   <label class="sr-only" for="episode-jump-input">搜索集数标签</label>
                   <input id="episode-jump-input" class="episode-jump-input" type="text" placeholder="搜索集数…" autocomplete="off" />
                   <button type="button" class="episode-jump-toggle" aria-label="展开集数列表" aria-expanded="false">
                     <i class="fas fa-caret-down" aria-hidden="true"></i>
                   </button>
                   <div class="episode-jump-menu" hidden></div>
                 </div>
               </div><div class="episode-tabs-container">`;

      const tableHeaders = ds.overview_headers || [];
      const cellMatrix = [];
      
      ds.episodes.forEach(ep => {
          const rowData = [];
          tableHeaders.forEach(th => {
              const matchingRoles = getEpisodeStaff(ep).filter(s => {
                  if (!s.role) return false;
                  
                  if (s.map_to) {
                      const mapTargets = String(s.map_to).split(/[・·\/,，]/).map(r => r.trim());
                      if (mapTargets.includes(th.trim())) return true;
                  }

                  const splitRoles = s.role.split(/[・·\/]/).map(r => r.trim());
                  if (splitRoles.includes(th.trim())) return true;
                  
                  return false;
              });

              let cellHTML = "";
              if (matchingRoles.length > 0) {
                  const allPeople = [];
                  const seenPeople = new Set();
                  matchingRoles.forEach(roleObj => {
                      getStaffNames(roleObj).forEach((rawName, index) => {
                          const cName = cleanName(rawName);
                          const slug = resolveStaffSlug(rawName, index, roleObj);
                          const key = `${slug}::${rawName}`;
                          if(!seenPeople.has(key)){
                              seenPeople.add(key);
                              allPeople.push({ rawName, cName, slug });
                          }
                      });
                  });

                  if (allPeople.length > 0) {
                      allPeople.forEach(({rawName, cName, slug}, idx) => {
                          const remarkText = rawName.replace(cName, '').trim();

                          const safeSlug = slug.replace(/'/g, "\\'");
                          const safeCName = cName.replace(/'/g, "\\'");
                          const safeWSlug = (w.slug || LAST_WORK_SLUG || "").replace(/'/g, "\\'");

                          cellHTML += `<span style="display:inline-block;">`;
                          cellHTML += `<a href="#/person/${encodeURIComponent(slug)}" class="person-link" onclick="saveWorkScroll('${safeWSlug}'); setTempPersonLabel('${safeSlug}', '${safeCName}')">${escapeHTML(cName)}</a>`;
                          if (remarkText) { cellHTML += `<span>${escapeHTML(remarkText)}</span>`; }
                          if (idx < allPeople.length - 1) cellHTML += "、"; 
                          cellHTML += `</span>`;
                      });
                  } else {
                      cellHTML = "-";
                  }
              } else {
                  cellHTML = "-";
              }
              rowData.push(cellHTML);
          });
          cellMatrix.push(rowData);
      });

      const rows = cellMatrix.length;
      const cols = tableHeaders.length;
      const rowspanMatrix = Array(rows).fill(null).map(() => Array(cols).fill(1));

      for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
              if (rowspanMatrix[r][c] === 0) continue; 

              let span = 1;
              for (let k = r + 1; k < rows; k++) {
                  if (cellMatrix[r][c] === cellMatrix[k][c]) {
                      span++;
                      rowspanMatrix[k][c] = 0; 
                  } else {
                      break; 
                  }
              }
              rowspanMatrix[r][c] = span;
          }
      }

      html += `<div class="ep-tab-content active" id="ep-tab-overview">
                 <div class="table-responsive">
                   <table class="detailed-table">
                     <thead><tr><th></th>`;
      tableHeaders.forEach(h => { html += `<th>${escapeHTML(h)}</th>`; });
      html += `</tr></thead><tbody>`;

      ds.episodes.forEach((ep, r) => {
          html += `<tr><td>${escapeHTML(ep.label || "")}</td>`;
          for (let c = 0; c < cols; c++) {
              if (rowspanMatrix[r][c] > 0) {
                  const rowspanAttr = rowspanMatrix[r][c] > 1 ? ` rowspan="${rowspanMatrix[r][c]}"` : "";
                  html += `<td${rowspanAttr}>${cellMatrix[r][c]}</td>`;
              }
          }
          html += `</tr>`;
      });
      html += `</tbody></table></div></div>`;

      ds.episodes.forEach((ep, i) => {
          html += `<div class="ep-tab-content" id="ep-tab-${i}" style="display:none;">
                     <div class="ep-staff-list">`;
          const staffEntries = getEpisodeStaff(ep);
          if (staffEntries.length) {
              staffEntries.forEach((roleObj) => {
                  const validNames = getStaffNames(roleObj);
                  if (validNames.length > 0 && roleObj.role) {
                      html += `<div class="ep-staff-item">
                                 <div class="ep-staff-role">${escapeHTML(roleObj.role)}</div>
                                 <div class="ep-staff-names">`;
                      validNames.forEach((rawName, nIdx) => {
                          const cName = cleanName(rawName);
                          const slug = resolveStaffSlug(rawName, nIdx, roleObj);
                          const remarkText = rawName.replace(cName, '').trim();

                          const safeSlug = slug.replace(/'/g, "\\'");
                          const safeCName = cName.replace(/'/g, "\\'");
                          const safeWSlug = (w.slug || LAST_WORK_SLUG || "").replace(/'/g, "\\'");

                          html += `<span style="display:inline-block;">`;
                          html += `<a href="#/person/${encodeURIComponent(slug)}" class="person-link" onclick="saveWorkScroll('${safeWSlug}'); setTempPersonLabel('${safeSlug}', '${safeCName}')">${escapeHTML(cName)}</a>`;
                          if (remarkText) { html += `<span>${escapeHTML(remarkText)}</span>`; }
                          if (nIdx < validNames.length - 1) html += "、"; 
                          html += `</span>`;
                      });
                      html += `</div></div>`;
                  }
              });
          }
          html += `</div></div>`;
      });

      html += `</div>`;
      detailedBlock.innerHTML = html;

      const tabBtns = detailedBlock.querySelectorAll('.ep-tab-btn');
      const tabContents = detailedBlock.querySelectorAll('.ep-tab-content');
      const jumpBox = detailedBlock.querySelector('.episode-jump');
      const jumpInput = detailedBlock.querySelector('.episode-jump-input');
      const jumpToggle = detailedBlock.querySelector('.episode-jump-toggle');
      const jumpMenu = detailedBlock.querySelector('.episode-jump-menu');

      const hideJumpMenu = () => {
          if (!jumpMenu) return;
          jumpMenu.hidden = true;
          if (jumpToggle) jumpToggle.setAttribute('aria-expanded', 'false');
      };

      const renderJumpMenu = (query = "", showAll = false) => {
          if (!jumpMenu) return;
          const q = String(query || "").trim().toLowerCase();
          const list = (showAll || !q)
              ? episodeOptions
              : episodeOptions.filter(item => item.label.toLowerCase().includes(q));

          if (!list.length) {
              jumpMenu.innerHTML = `<div class="episode-jump-empty">没有匹配项</div>`;
          } else {
              jumpMenu.innerHTML = list.map(item =>
                  `<button type="button" class="episode-jump-option" data-target="${escapeHTML(item.target)}">${escapeHTML(item.label)}</button>`
              ).join('');
          }
          jumpMenu.hidden = false;
          if (jumpToggle) jumpToggle.setAttribute('aria-expanded', 'true');

          jumpMenu.querySelectorAll('.episode-jump-option').forEach(option => {
              option.addEventListener('click', () => {
                  activateTab(option.dataset.target);
                  hideJumpMenu();
                  if (jumpInput) jumpInput.focus();
              });
          });
      };

      const activateTab = (target) => {
          const targetBtn = Array.from(tabBtns).find(btn => btn.dataset.target === target);
          const targetContent = document.getElementById(target);
          if (!targetBtn || !targetContent) return;

          tabBtns.forEach(b => b.classList.remove('active'));
          tabContents.forEach(c => c.style.display = 'none');
          targetBtn.classList.add('active');
          targetContent.style.display = 'block';

          const option = episodeOptions.find(item => item.target === target);
          if (jumpInput && option) jumpInput.value = option.label;
          try { sessionStorage.setItem("activeTab:" + (w.slug || LAST_WORK_SLUG), target); } catch(e) {}
      };

      tabBtns.forEach(btn => {
          btn.addEventListener('click', () => activateTab(btn.dataset.target));
      });

      if (jumpInput && jumpToggle && jumpMenu) {
          jumpInput.value = "总览";
          jumpInput.addEventListener('input', () => renderJumpMenu(jumpInput.value, false));
          jumpInput.addEventListener('focus', () => renderJumpMenu(jumpInput.value, !jumpInput.value.trim()));
          jumpInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                  e.preventDefault();
                  const q = jumpInput.value.trim().toLowerCase();
                  const exact = episodeOptions.find(item => item.label.toLowerCase() === q);
                  const partial = episodeOptions.find(item => item.label.toLowerCase().includes(q));
                  const target = (exact || partial)?.target;
                  if (target) {
                      activateTab(target);
                      hideJumpMenu();
                  }
              } else if (e.key === 'Escape') {
                  hideJumpMenu();
              }
          });

          jumpToggle.addEventListener('click', (e) => {
              e.stopPropagation();
              if (jumpMenu.hidden) renderJumpMenu("", true);
              else hideJumpMenu();
          });
          jumpToggle.addEventListener('mouseenter', () => renderJumpMenu("", true));

          document.addEventListener('click', (e) => {
              if (jumpBox && !jumpBox.contains(e.target)) hideJumpMenu();
          });
      }

      try {
          const savedTab = sessionStorage.getItem("activeTab:" + (w.slug || LAST_WORK_SLUG));
          if (savedTab) {
              activateTab(savedTab);
          }
      } catch(e) {}

    } else {
      detailedBlock.innerHTML = "";
    }
  }

  const hasMain = hasRealMainStaff(col1Entries) || hasRealMainStaff(col2Entries);
  const headerContainer = document.getElementById("work-staff-header-container");
  const dynamicHeading = document.getElementById("work-staff-dynamic-heading");
  const detailedHeading = document.getElementById("work-detailed-staff-heading");

  if (hasMain) {
      headerContainer.hidden = false;
      headerContainer.style.display = "flex";
      dynamicHeading.textContent = "主要制作人员";
      staffBlock.hidden = false;
      if (hasDetailed) {
          detailedBlock.hidden = false;
          if (detailedHeading) detailedHeading.hidden = false;
      } else {
          detailedBlock.hidden = true;
      }
  } else if (hasDetailed) {
      headerContainer.hidden = false;
      headerContainer.style.display = "flex";
      dynamicHeading.textContent = "制作人员"; 
      staffBlock.hidden = true;
      detailedBlock.hidden = false;
      if (detailedHeading) detailedHeading.hidden = true; 
  } else {
      headerContainer.hidden = true;
      headerContainer.style.display = "none";
      staffBlock.hidden = true;
      detailedBlock.hidden = true;
  }

  restoreWorkScroll(w.slug || slug);
}

// ========= 交互：作品内人员检索功能 =========
function setupWorkStaffSearch() {
    const wsInput = document.getElementById("work-staff-search-input");
    const wsDropdown = document.getElementById("work-staff-search-dropdown");
    const wsClear = document.getElementById("work-staff-search-clear");

    if (!wsInput) return;

    const updateWsDropdown = (q) => {
        if (!wsDropdown) return;
        if (!q) { wsDropdown.hidden = true; return; }

        const matched = CURRENT_WORK_PEOPLE.filter(p => {
            return p.label.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q);
        }).slice(0, 8);

        if (matched.length === 0) {
            wsDropdown.hidden = true; return;
        }

        let html = `<div class="search-dropdown-group">本作参与人员</div>`;
        matched.forEach(p => {
             let displayHTML = escapeHTML(p.label);
             let diff = p.slug;
             if (p.slug !== p.label) {
                  if (diff.startsWith(p.label)) diff = diff.substring(p.label.length).trim();
                  else if (diff.includes(p.label)) diff = diff.replace(p.label, '').trim();
                  else diff = `(${diff})`;
                  if (diff) displayHTML += `<span style="color:#a7a7a7; font-size:0.85em; margin-left:4px;">${escapeHTML(diff)}</span>`;
             }
             
             html += `<div class="search-dropdown-item ws-dropdown-item" data-slug="${escapeHTML(p.slug)}" data-label="${escapeHTML(p.label)}" style="cursor: pointer;">
                        <span class="search-item-text">${displayHTML}</span>
                        <a href="#/person/${encodeURIComponent(p.slug)}" class="search-item-detail-btn">查看详细页面</a>
                      </div>`;
        });
        wsDropdown.innerHTML = html;
        wsDropdown.hidden = false;

        wsDropdown.querySelectorAll('.ws-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.search-item-detail-btn')) return;

                e.stopPropagation();
                const slug = item.getAttribute('data-slug');
                const label = item.getAttribute('data-label');
                wsInput.value = label;
                wsDropdown.hidden = true;
                if (wsClear) wsClear.hidden = false;
                applyWorkStaffFilter(CURRENT_WORK, slug, label);
            });
        });

        // ======== 核心修复：给局部搜索框的“查看详细页面”按钮加上滑动记忆 ========
        wsDropdown.querySelectorAll('.search-item-detail-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                const safeWSlug = CURRENT_WORK?.slug || LAST_WORK_SLUG || "";
                saveWorkScroll(safeWSlug);
                wsDropdown.hidden = true;
                e.stopPropagation();
            });
        });
        // =========================================================================
    };

    wsInput.addEventListener("input", () => {
        const val = wsInput.value.trim().toLowerCase();
        if(wsClear) wsClear.hidden = (val.length === 0);
        updateWsDropdown(val);
    });

    wsInput.addEventListener("focus", () => {
         const val = wsInput.value.trim().toLowerCase();
         if(val) updateWsDropdown(val);
    });

    wsInput.addEventListener("click", () => {
         const val = wsInput.value.trim().toLowerCase();
         if(val) updateWsDropdown(val);
    });

    wsInput.addEventListener("keydown", (e) => {
        if(e.key === "Enter") {
            e.preventDefault();
            if(wsDropdown) wsDropdown.hidden = true;
            const val = wsInput.value.trim().toLowerCase();
            if(!val) return clearWorkStaffFilter();

            const exact = CURRENT_WORK_PEOPLE.find(p => p.label.toLowerCase() === val || p.slug.toLowerCase() === val);
            if (exact) {
                wsInput.value = exact.label;
                if(wsClear) wsClear.hidden = false;
                applyWorkStaffFilter(CURRENT_WORK, exact.slug, exact.label);
            } else {
                const partial = CURRENT_WORK_PEOPLE.find(p => p.label.toLowerCase().includes(val) || p.slug.toLowerCase().includes(val));
                if (partial) {
                    wsInput.value = partial.label;
                    if(wsClear) wsClear.hidden = false;
                    applyWorkStaffFilter(CURRENT_WORK, partial.slug, partial.label);
                } else {
                    clearWorkStaffFilter();
                }
            }
        }
    });

    if (wsClear) {
        wsClear.addEventListener("click", (e) => {
            e.stopPropagation();
            wsInput.value = "";
            wsClear.hidden = true;
            if(wsDropdown) wsDropdown.hidden = true;
            clearWorkStaffFilter();
            wsInput.focus();
        });
    }

    document.addEventListener("click", (e) => {
        const box = document.getElementById("work-staff-search-box");
        if (wsDropdown && !wsDropdown.hidden && box && !box.contains(e.target)) {
            wsDropdown.hidden = true;
        }
    });
}

// ========= 交互：全局双条件检索与下拉补全 =========
function setupFilters(){
  const typeSelect    = document.getElementById("filter-type");
  const sourceSelect  = document.getElementById("filter-source");
  const sortBtn       = document.getElementById("sort-toggle");

  const applyFilters = ()=>{
    const rawQ1 = document.getElementById("search-input-1")?.value || "";
    const rawQ2 = document.getElementById("search-input-2")?.value || "";
    const q1 = rawQ1.trim().toLowerCase();
    const q2 = rawQ2.trim().toLowerCase();
    const typeVal   = (typeSelect?.value || "all");
    const sourceVal = (sourceSelect?.value || "all");

    const isOnlyWorkGlobally = (q) => {
        if (!q) return false;
        const matchesWork = ALL_WORKS.some(w => isWorkMatchTitle(w, q));
        const matchesPerson = ALL_WORKS.some(w => getPersonRolesInWork(w, q) !== null);
        return matchesWork && !matchesPerson;
    };

    const isGlobalWork1 = isOnlyWorkGlobally(q1);
    const isGlobalWork2 = isOnlyWorkGlobally(q2);

    const isPerson1 = q1 && !isGlobalWork1;
    const isPerson2 = q2 && !isGlobalWork2;
    const input1 = document.getElementById("search-input-1");
    const input2 = document.getElementById("search-input-2");

    if (isPerson1 && isPerson2 && q1 !== q2) {
        if (input1) input1.classList.add("active-person-1");
        if (input2) input2.classList.add("active-person-2");
    } else {
        if (input1) input1.classList.remove("active-person-1");
        if (input2) input2.classList.remove("active-person-2");
    }

    let list = ALL_WORKS.slice();

    if(typeVal !== "all") list = list.filter(w => normalizeType(w.type) === typeVal);
    if(sourceVal !== "all") list = list.filter(w => String(w.sourceCategory||"") === sourceVal);

    list = list.filter(w => {
      const match1_work = q1 ? isWorkMatchTitle(w, q1) : false;
      const match1_person = q1 ? (getPersonRolesInWork(w, q1) !== null) : false;
      const match1 = q1 === "" ? true : (match1_work || match1_person);

      const match2_work = q2 ? isWorkMatchTitle(w, q2) : false;
      const match2_person = q2 ? (getPersonRolesInWork(w, q2) !== null) : false;
      const match2 = q2 === "" ? true : (match2_work || match2_person);

      if (q1 && q2) {
          if (isGlobalWork1 && isGlobalWork2) {
              return match1 || match2;
          }
          return match1 && match2;
      } else if (q1) {
          return match1;
      } else if (q2) {
          return match2;
      }
      return true;
    });

    renderWorks(list, rawQ1, rawQ2);
  };

  function bindSearchBox(boxId) {
      const input = document.getElementById(`search-input-${boxId}`);
      const clear = document.getElementById(`search-clear-${boxId}`);
      const dropdown = document.getElementById(`search-dropdown-${boxId}`);
      if (!input) return;

      const updateDropdown = (q) => {
          if(!dropdown) return;
          if(!q) { dropdown.hidden = true; return; }

          const matchedWorks = ALL_WORKS.filter(w => {
            return isWorkMatchTitle(w, q);
          }).slice(0, 5);

          const uniquePeople = [];
          const seen = new Set();
          GLOBAL_PEOPLE.forEach(p => {
            const matchLabel = p.label.toLowerCase().includes(q);
            const matchSlug = p.slug.toLowerCase().includes(q);
            const matchJp = (p.name_jp || "").toLowerCase().includes(q);
            const matchAlias = (p.aliases || []).some(a => String(a).toLowerCase().includes(q));

            if(matchLabel || matchSlug || matchJp || matchAlias) {
              if(!seen.has(p.slug)) { seen.add(p.slug); uniquePeople.push(p); }
            }
          });
          const matchedPeople = uniquePeople.slice(0, 5);

          if (matchedWorks.length === 0 && matchedPeople.length === 0) {
            dropdown.hidden = true; return;
          }

          let html = "";
          if (matchedWorks.length > 0) {
            html += `<div class="search-dropdown-group">作品</div>`;
            matchedWorks.forEach(w => {
              html += `
                <div class="search-dropdown-item">
                  <span class="search-item-text" data-keyword="${escapeHTML(w.title)}">${escapeHTML(w.title)}</span>
                  <a href="#/work/${encodeURIComponent(w.slug)}" class="search-item-detail-btn">查看详细页面</a>
                </div>`;
            });
          }
          if (matchedPeople.length > 0) {
            html += `<div class="search-dropdown-group">人名</div>`;
            matchedPeople.forEach(p => {
              let displayHTML = escapeHTML(p.label);
              let keywordToInsert = p.label; 
              
              if (p.slug && p.slug !== p.label) {
                  let diff = p.slug;
                  if (p.slug.startsWith(p.label)) {
                      diff = p.slug.substring(p.label.length).trim();
                  } else if (p.slug.includes(p.label)) {
                      diff = p.slug.replace(p.label, '').trim();
                  } else {
                      diff = `(${p.slug})`;
                  }
                  if (diff) {
                      displayHTML += `<span style="color:#a7a7a7; font-size:0.85em; margin-left:4px;">${escapeHTML(diff)}</span>`;
                  }
                  keywordToInsert = p.slug; 
              }

              html += `
                <div class="search-dropdown-item">
                  <span class="search-item-text" data-keyword="${escapeHTML(keywordToInsert)}">${displayHTML}</span>
                  <a href="#/person/${encodeURIComponent(p.slug)}" class="search-item-detail-btn">查看详细页面</a>
                </div>`;
            });
          }
          dropdown.innerHTML = html;
          dropdown.hidden = false;

          dropdown.querySelectorAll('.search-dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
              if (e.target.closest('.search-item-detail-btn')) return;

              e.stopPropagation();
              const textEl = item.querySelector('.search-item-text');
              if (textEl) {
                  input.value = textEl.getAttribute('data-keyword');
                  dropdown.hidden = true;
                  if(clear) clear.hidden = false;
                  applyFilters(); 
              }
            });
          });

          dropdown.querySelectorAll('.search-item-detail-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                dropdown.hidden = true;
                e.stopPropagation();
            });
          });
      };

      input.addEventListener("input", ()=>{
        const val = input.value.trim().toLowerCase();
        if(clear) clear.hidden = (val.length === 0);
        updateDropdown(val);
      });
      
      input.addEventListener("change", () => {
        applyFilters();
      });
      
      input.addEventListener("focus", ()=>{
        const val = input.value.trim().toLowerCase();
        if(val) updateDropdown(val);
      });
      
      input.addEventListener("click", ()=>{
        const val = input.value.trim().toLowerCase();
        if(val) updateDropdown(val);
      });

      input.addEventListener("keydown", (e) => {
        if(e.key === "Enter") {
          e.preventDefault();
          if(dropdown) dropdown.hidden = true;
          applyFilters();
        }
      });

      if(clear) {
        clear.addEventListener("click", (e) => {
          e.stopPropagation();
          input.value = "";
          clear.hidden = true;
          if(dropdown) dropdown.hidden = true;
          applyFilters(); 
          input.focus();
        });
      }
  }

  bindSearchBox(1);
  bindSearchBox(2);

  document.addEventListener("click", (e) => {
      [1, 2].forEach(id => {
          const box = document.getElementById(`search-box-${id}`);
          const dropdown = document.getElementById(`search-dropdown-${id}`);
          if (dropdown && !dropdown.hidden && box && !box.contains(e.target)) {
              dropdown.hidden = true;
          }
      });
  });

  if(typeSelect) typeSelect.addEventListener("change", applyFilters);
  if(sourceSelect) sourceSelect.addEventListener("change", applyFilters);
  if(sortBtn) sortBtn.addEventListener("click", ()=>{
    SORT_DESC = !SORT_DESC;
    sortBtn.setAttribute('aria-pressed', SORT_DESC ? "true" : "false");
    sortBtn.textContent = SORT_DESC ? "从新到旧" : "从旧到新";
    applyFilters();
  });
}

function enhanceSelect(selectEl){
  if(!selectEl || selectEl.classList.contains('is-hidden')) return;
  const wrapper = document.createElement('div'); wrapper.className = 'fancy-select';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'fancy-btn';
  btn.setAttribute('aria-haspopup','listbox'); btn.setAttribute('aria-expanded','false');
  const menu = document.createElement('ul'); menu.className = 'fancy-menu'; menu.setAttribute('role','listbox');
  const opts = Array.from(selectEl.options);
  const buildLabel = () => (selectEl.selectedOptions[0]?.textContent ?? '');
  btn.textContent = buildLabel();

  opts.forEach(opt=>{
    const li = document.createElement('li'); li.className = 'fancy-option'; li.textContent = opt.textContent;
    li.setAttribute('role','option'); li.setAttribute('data-value', opt.value);
    if(opt.selected) li.setAttribute('aria-selected','true');
    li.addEventListener('click', ()=>{
      selectEl.value = opt.value; selectEl.dispatchEvent(new Event('change', {bubbles:true}));
      btn.textContent = opt.textContent;
      Array.from(menu.children).forEach(n=>n.removeAttribute('aria-selected'));
      li.setAttribute('aria-selected','true');
      wrapper.classList.remove('open'); btn.setAttribute('aria-expanded','false');
    });
    menu.appendChild(li);
  });

  btn.addEventListener('click', ()=>{
    const open = !wrapper.classList.contains('open');
    document.querySelectorAll('.fancy-select.open').forEach(w=>{ w.classList.remove('open'); w.querySelector('.fancy-btn')?.setAttribute('aria-expanded','false'); });
    wrapper.classList.toggle('open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.addEventListener('click', (e)=>{
    if(!wrapper.contains(e.target)){ wrapper.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }
  });
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){ wrapper.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }
  });

  selectEl.addEventListener('change', ()=>{
    btn.textContent = buildLabel();
    Array.from(menu.children).forEach(li=>{ li.toggleAttribute('aria-selected', li.getAttribute('data-value') === selectEl.value); });
  });

  selectEl.insertAdjacentElement('afterend', wrapper);
  wrapper.appendChild(btn); wrapper.appendChild(menu); selectEl.classList.add('is-hidden');
}

// ========= 人物详情 =========
async function renderPersonDetail(slug){
  const nameEl  = document.getElementById("person-name");
  const aliasEl = document.getElementById("person-aliases");
  const bioEl   = document.getElementById("person-bio");
  const backEl  = document.getElementById("person-back");

  let p = null;
  try{ p = await fetch(`data/people/${slug}.json`, {cache:"no-store"}).then(r=> r.ok ? r.json() : null); }catch{}

  const savedLabel = getTempPersonLabel(slug);
  const displayName = savedLabel || cleanName(decodeURIComponent(slug));

  if(backEl){
    backEl.href = LAST_WORK_SLUG ? ("#/work/" + encodeURIComponent(LAST_WORK_SLUG)) : "#/works";
  }

  if(!p){
    if(nameEl) nameEl.textContent = displayName;
    if(aliasEl){ aliasEl.textContent = ""; aliasEl.hidden = true; }
    if(bioEl){
      bioEl.textContent = "";
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "暂无信息";
      bioEl.appendChild(hint);
    }
    window.scrollTo(0,0); 
    return;
  }

  const title = p.name_zh || p.name || p.name_jp || p.slug || displayName;
  if(nameEl) nameEl.textContent = cleanName(title);

  const aliases = []
    .concat(p.name_jp ? [p.name_jp] : [])
    .concat(Array.isArray(p.aliases) ? p.aliases : []);
  if(aliasEl){
    if(aliases.length){ aliasEl.textContent = aliases.join(" / "); aliasEl.hidden = false; }
    else{ aliasEl.textContent = ""; aliasEl.hidden = true; }
  }
  if(bioEl){
    bioEl.textContent = "";
    if(p.bio){
      bioEl.textContent = String(p.bio);
    }else{
      const placeholder = document.createElement("span");
      placeholder.className = "kv-small";
      placeholder.textContent = "（人物页面待完善）";
      bioEl.appendChild(placeholder);
    }
  }
  
  window.scrollTo(0,0);
}

// ========= 启动 =========
document.addEventListener("DOMContentLoaded",()=>{
  applyRoute();
  setupFilters();
  setupWorkStaffSearch(); 
  loadWorks();

  enhanceSelect(document.getElementById('filter-type'));
  enhanceSelect(document.getElementById('filter-source'));

  document.querySelectorAll('nav a').forEach(a => {
    a.addEventListener('click', () => {
      if (a.dataset.view === 'works') {
        if (location.hash === '#/works') window.scrollTo(0, 0);
        sessionStorage.setItem('worksListScroll', '0');
      } else if (a.dataset.view === 'overview') {
        window.scrollTo(0, 0);
      }
    });
  });
});

window.addEventListener("scroll", () => {
  if (location.hash === "#/works") {
    sessionStorage.setItem("worksListScroll", String(window.scrollY));
  }
}, { passive: true });
