// ========= 视图切换 =========
const VIEWS = ["overview", "works", "work"];
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
  if(h.startsWith("#/work/")){
    const slug = decodeURIComponent(h.replace("#/work/",""));
    show("work");
    renderWorkDetail(slug);
  }else if(h === "#/works"){
    show("works");
  }else{
    show("overview");
  }
}
window.addEventListener("hashchange", applyRoute);

// ========= 配置 =========
const MANIFEST_URL = "data/works/index.json";
let YEAR_MIN = 1986;
let YEAR_MAX = 2100;
let SORT_DESC = true; // 从新到旧

// type 归一化到既定集合（其它 → “其他”）
const KNOWN_TYPES = ["TV","剧场版","OVA","OAD","WEB","MV","其他"];
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

// ========= 数据加载 =========
let ALL_WORKS = [];
async function loadWorks(){
  try{
    const res = await fetch(MANIFEST_URL,{cache:"no-store"});
    const { works = [] } = await res.json();
    const files = await Promise.all(
      works.map(slug => fetch(`data/works/${slug}.json`,{cache:"no-store"}).then(r=>r.json()).catch(()=>null))
    );
    ALL_WORKS = files.filter(Boolean);
    renderWorks(ALL_WORKS);
  }catch(e){
    console.error("加载作品失败：",e);
    renderWorks([]);
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

// ========= 列表页 =========
function formatEpisodesTag(val){
  if(val === undefined || val === null || val === "") return "";
  if (typeof val === "number" && Number.isFinite(val)) return `共${val}话`;
  return String(val); // “连载中”等
}

function renderWorks(list){
  const box = document.getElementById("works-container");
  if(!box) return;
  box.innerHTML = "";

  // 过滤范围
  let items = list.filter(w =>
    Number.isInteger(w.seasonYear) &&
    w.season && seasonIndex(w.season) >= 0 &&
    w.seasonYear >= YEAR_MIN && w.seasonYear <= YEAR_MAX
  );

  // 组顺序（只影响组）
  items.sort((a,b)=>{
    const ya=a.seasonYear||0, yb=b.seasonYear||0;
    const sa=seasonIndex(a.season), sb=seasonIndex(b.season);
    if(SORT_DESC){ if(yb!==ya) return yb-ya; return sb-sa; }
    else         { if(ya!==yb) return ya-yb; return sa-sb; }
  });

  // 分组
  const groups = new Map();
  items.forEach(w=>{
    const si = seasonIndex(w.season);
    const key = `${w.seasonYear}-${si}`;
    if(!groups.has(key)) groups.set(key, {year:w.seasonYear, si, items:[]});
    groups.get(key).items.push(w);
  });

  // 渲染
  const entries = Array.from(groups.values()).sort((A,B)=>{
    if(SORT_DESC){ if(B.year!==A.year) return B.year-A.year; return B.si-A.si; }
    else         { if(A.year!==B.year) return A.year-B.year; return A.si-B.si; }
  });

  entries.forEach(g=>{
    // 同季度固定：首播日期从早到晚
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

      // 右上标签
      const typeTag = work.type ? `<span class="work-tag">${escapeHTML(String(work.type))}</span>` : "";
      const srcTag  = work.sourceCategory ? `<span class="work-tag">${escapeHTML(String(work.sourceCategory))}</span>` : "";
      const epTxt   = formatEpisodesTag(work.episodes);
      const epTag   = epTxt ? `<span class="work-tag">${escapeHTML(epTxt)}</span>` : "";
      const tagsHTML = `${typeTag}${srcTag}${epTag}`;

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

// ========= 详情页 =========
function formatEpisodesForDetail(val){
  if(val === undefined || val === null || val === "") return "";
  if (typeof val === "number" && Number.isFinite(val)) return String(val); // 只显示数字
  return String(val); // 字符串如 “连载中”
}

async function renderWorkDetail(slug){
  let w = getWorkBySlug(slug);
  if(!w){
    try{ w = await fetch(`data/works/${slug}.json`,{cache:"no-store"}).then(r=>r.json()); }catch{}
  }

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
    epEl.hidden = true;
    dateEl.hidden = true;
    linksInline.innerHTML = "";
    copyrightEl.textContent = ""; copyrightEl.hidden = true;
    coverEl.innerHTML = ""; coverEl.removeAttribute("style");
    return;
  }

  // 标题（中文）
  titleEl.textContent = w.title || "";

  // 副标题（日文原名）：兼容多种字段名
  const jpTitle = getJpTitle(w);
  if(subtitleEl){
    if(jpTitle){ subtitleEl.textContent = String(jpTitle); subtitleEl.hidden = false; }
    else{ subtitleEl.textContent = ""; subtitleEl.hidden = true; }
  }

  // 封面
  const color = w.color || "#6a11cb";
  const fallback = `background:linear-gradient(135deg, ${color}30, ${color}70);`;
  setCoverImage(coverEl, w, fallback);

  // 徽章：type + sourceCategory
  badges.innerHTML = "";
  if(w.type) badges.appendChild(makeBadge(w.type));
  if(w.sourceCategory) badges.appendChild(makeBadge(w.sourceCategory));

  // 集数（详情页）
  const epTxtDetail = formatEpisodesForDetail(w.episodes);
  if(epTxtDetail){
    epEl.innerHTML = `<b>集数：</b>${escapeHTML(epTxtDetail)}`;
    epEl.hidden = false;
  }else epEl.hidden = true;

  // 首播日期
  const full = formatFullDate(w);
  if(full){
    dateEl.innerHTML = `<b>首播日期：</b>${escapeHTML(full)}`;
    dateEl.hidden = false;
  }else dateEl.hidden = true;

  // 相关链接（按指定顺序与文案）
  const linkNames = {
    official: "官方网站",
    bangumi: "bangumi",
    moegirl: "萌娘百科",
    seesaa: "Seesaawiki",
    sakugabooru: "SAKUGABOORU"
  };
  const order = ["official","bangumi","moegirl","seesaa","sakugabooru"];
  linksInline.innerHTML = "";
  let list = [];
  if(w.links && typeof w.links === "object" && !Array.isArray(w.links)){
    list = order.filter(k => w.links[k]).map(k => ({ title: linkNames[k], url: w.links[k] }));
  }
  let cnList = [];
  if(Array.isArray(w.cn_streaming)){
    cnList = w.cn_streaming.filter(item => item && item.title && item.url);
  }
  if(list.length || cnList.length){
    if(list.length){
      const col1 = document.createElement("div");
      col1.className = "links-col";
      const h1 = document.createElement("h3"); h1.textContent = "相关链接";
      const ul1 = document.createElement("ul"); ul1.id = "work-links";
      list.forEach(({url,title})=>{
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.rel = "noreferrer"; a.textContent = title;
        li.appendChild(a); ul1.appendChild(li);
      });
      col1.appendChild(h1); col1.appendChild(ul1);
      linksInline.appendChild(col1);
    }
    if(cnList.length){
      const col2 = document.createElement("div");
      col2.className = "links-col";
      const h2 = document.createElement("h3"); h2.textContent = "中国大陆正版";
      const ul2 = document.createElement("ul"); ul2.id = "work-cn-streaming";
      cnList.forEach(({url,title})=>{
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.rel = "noreferrer"; a.textContent = title;
        li.appendChild(a); ul2.appendChild(li);
      });
      col2.appendChild(h2); col2.appendChild(ul2);
      linksInline.appendChild(col2);
    }
    linksInline.hidden = false;
  } else {
    linksInline.hidden = true;
  }

  // 版权（有则显示）
  const cp = (w.copyright ?? "").toString().trim();
  if(cp){ copyrightEl.textContent = cp; copyrightEl.hidden = false; }
  else { copyrightEl.textContent = ""; copyrightEl.hidden = true; }

  // 主要制作人员
  const staffBlock = document.getElementById("work-staff-block");
  const staffUl = document.getElementById("work-staff");
  staffUl.innerHTML = "";
  const staff = (w.staff||[]).map(s => {
    if(typeof s === "string") return s;
    if(s && s.role && s.name) return `${s.role}：${s.name}`;
    return "";
  }).filter(Boolean);
  staff.forEach(s => { const li=document.createElement("li"); li.textContent=s; staffUl.appendChild(li); });
  staffBlock.hidden = staff.length === 0;
}

// ========= 交互：搜索/筛选/排序 =========
function setupFilters(){
  const searchInput   = document.getElementById("search-input");
  const typeSelect    = document.getElementById("filter-type");
  const sourceSelect  = document.getElementById("filter-source");
  const sortBtn       = document.getElementById("sort-toggle");

  const applyFilters = ()=>{
    const q = (searchInput?.value||"").toLowerCase().trim();
    const typeVal   = (typeSelect?.value || "all");
    const sourceVal = (sourceSelect?.value || "all");

    let list = ALL_WORKS.slice();

    // 按 type
    if(typeVal !== "all"){
      list = list.filter(w => normalizeType(w.type) === typeVal);
    }
    // 按 sourceCategory
    if(sourceVal !== "all"){
      list = list.filter(w => String(w.sourceCategory||"") === sourceVal);
    }
    // 标题搜索：中文 or 日文原名
    if(q){
      list = list.filter(w => {
        const tCN = (w.title || "").toLowerCase();
        const tJP = String(getJpTitle(w)).toLowerCase();
        return tCN.includes(q) || tJP.includes(q);
      });
    }

    renderWorks(list);
  };

  let t=null;
  if(searchInput) searchInput.addEventListener("input", ()=>{
    clearTimeout(t); t = setTimeout(applyFilters, 200);
  });
  if(typeSelect)   typeSelect.addEventListener("change", applyFilters);
  if(sourceSelect) sourceSelect.addEventListener("change", applyFilters);

  if(sortBtn) sortBtn.addEventListener("click", ()=>{
    SORT_DESC = !SORT_DESC;
    sortBtn.setAttribute('aria-pressed', SORT_DESC ? "true" : "false");
    sortBtn.textContent = SORT_DESC ? "从新到旧" : "从旧到新";
    applyFilters();
  });
}

// ========= 自定义深色下拉：把原生 select 包装成自定义菜单（无白边） =========
function enhanceSelect(selectEl){
  if(!selectEl) return;
  if(selectEl.classList.contains('is-hidden')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'fancy-select';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fancy-btn';
  btn.setAttribute('aria-haspopup','listbox');
  btn.setAttribute('aria-expanded','false');

  const menu = document.createElement('ul');
  menu.className = 'fancy-menu';
  menu.setAttribute('role','listbox');

  const opts = Array.from(selectEl.options);
  const buildLabel = () => (selectEl.selectedOptions[0]?.textContent ?? '');
  btn.textContent = buildLabel();

  opts.forEach(opt=>{
    const li = document.createElement('li');
    li.className = 'fancy-option';
    li.textContent = opt.textContent;
    li.setAttribute('role','option');
    li.setAttribute('data-value', opt.value);
    if(opt.selected) li.setAttribute('aria-selected','true');
    li.addEventListener('click', ()=>{
      selectEl.value = opt.value;
      selectEl.dispatchEvent(new Event('change', {bubbles:true}));
      btn.textContent = opt.textContent;
      Array.from(menu.children).forEach(n=>n.removeAttribute('aria-selected'));
      li.setAttribute('aria-selected','true');
      wrapper.classList.remove('open');
      btn.setAttribute('aria-expanded','false');
    });
    menu.appendChild(li);
  });

  btn.addEventListener('click', ()=>{
    const open = !wrapper.classList.contains('open');
    document.querySelectorAll('.fancy-select.open').forEach(w=>{
      w.classList.remove('open');
      w.querySelector('.fancy-btn')?.setAttribute('aria-expanded','false');
    });
    wrapper.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.addEventListener('click', (e)=>{
    if(!wrapper.contains(e.target)){
      wrapper.classList.remove('open');
      btn.setAttribute('aria-expanded','false');
    }
  });
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      wrapper.classList.remove('open');
      btn.setAttribute('aria-expanded','false');
    }
  });

  selectEl.addEventListener('change', ()=>{
    btn.textContent = buildLabel();
    Array.from(menu.children).forEach(li=>{
      li.toggleAttribute('aria-selected', li.getAttribute('data-value') === selectEl.value);
    });
  });

  selectEl.insertAdjacentElement('afterend', wrapper);
  wrapper.appendChild(btn);
  wrapper.appendChild(menu);
  selectEl.classList.add('is-hidden');
}

// ========= 工具 =========
const escapeHTML = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const makeBadge = txt => { const s=document.createElement("span"); s.className="badge"; s.textContent=txt; return s; };

// 兼容多字段的日文原名
function getJpTitle(w){
  return (
    w.title_jp || w.titleJP || w.titleJp ||
    w.title_ja || w.titleJa ||
    w.jpTitle  || w.originalTitle || w.nativeTitle || ""
  );
}

// ========= 启动 =========
document.addEventListener("DOMContentLoaded",()=>{
  applyRoute();
  setupFilters();
  loadWorks();

  // 用自定义下拉替代原生 select（消除白边）
  enhanceSelect(document.getElementById('filter-type'));
  enhanceSelect(document.getElementById('filter-source'));
});
