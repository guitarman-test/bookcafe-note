// 북카페 노트 — Firebase(로그인 + Firestore) 버전
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, addDoc, setDoc,
  updateDoc, deleteDoc, getDoc, getDocFromCache, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCZYm7AjIMDS0v9YnmRj7WHyZuza4N2J40",
  authDomain: "bookcafe-note.firebaseapp.com",
  projectId: "bookcafe-note",
  storageBucket: "bookcafe-note.firebasestorage.app",
  messagingSenderId: "763768558955",
  appId: "1:763768558955:web:341e7ff3f22c01f4f6282e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let fs;
try { fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { fs = initializeFirestore(app, {}); }

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ymdOf = ms => { const d=new Date(ms); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const today = () => ymdOf(Date.now());
const fmtDate = ymd => (ymd||"").replace(/^(\d{4})-(\d\d)-(\d\d)$/,(m,y,mo,da)=>`${y}.${mo}.${da}`);
const norm = s => String(s??"").trim().replace(/\s+/g," ");  // 책 제목 비교용: 앞뒤·중복 공백 정리
const PAGE = 20;  // 목록을 한 번에 보여 주는 개수
function toast(msg){ const t=document.createElement("div"); t.className="toast"; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2400); }
function showNotice(t){ $("notice").textContent=t; $("notice").hidden=!t; }

let uid=null, visitsCol=null, unsub=null;
let entries=[];   // {id, cafe, date, addr, scores, book, author, bookMemo, goods, bads, memo, photos:[photoId], createdAt}
let filterCafe="전체";
let draft={scores:{}, points:[], photos:[]};  // photos: {id?, url, data?}
let ptKind="g", editingId=null, confirmId=null;
const photoCache={}, photoLoading={};  // photoId -> dataURL / 받는 중인 요청
let cShown=PAGE;

let readsCol=null, unsubR=null;
let readings=[];  // {id, title, memo, createdAt}
let rFilter="", rShown=PAGE, rEditingId=null, rConfirmId=null;
let tab="cafe";

/* ---------- login ---------- */
$("loginBtn").onclick = async () => {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      console.error(e); toast("로그인하지 못했어요. 크롬이나 사파리에서 열어 다시 시도해 주세요");
    }
  }
};
getRedirectResult(auth).catch(e=>console.error(e));
$("logout").onclick = () => signOut(auth);

onAuthStateChanged(auth, user => {
  if (unsub) { unsub(); unsub=null; }
  if (unsubR) { unsubR(); unsubR=null; }
  if (!user) {
    uid=null; entries=[]; readings=[];
    $("login").hidden=false; $("app").hidden=true; $("account").hidden=true; $("stats").innerHTML="";
    return;
  }
  uid=user.uid;
  $("who").textContent = user.email || user.displayName || "로그인됨";
  $("login").hidden=true; $("app").hidden=false; $("account").hidden=false;
  visitsCol = collection(fs, "users", uid, "visits");
  unsub = onSnapshot(visitsCol, snap => {
    entries = snap.docs.map(d=>({id:d.id, ...d.data()}));
    sortEntries(); render(); renderReadings();
    if (!editingId && !$("cafe").value && entries[0]) { $("cafe").value=entries[0].cafe; $("addr").value=entries[0].addr||""; }
  }, err => { console.error(err); showNotice("기록을 불러오지 못했어요. 새로고침해 보고, 계속되면 알려주세요."); });
  readsCol = collection(fs, "users", uid, "readings");
  unsubR = onSnapshot(readsCol, snap => {
    readings = snap.docs.map(d=>({id:d.id, ...d.data()}));
    readings.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    renderReadings();
    if (!rEditingId && !$("rTitle").value && readings[0]) $("rTitle").value=readings[0].title;
  }, err => {
    console.error(err);
    showNotice(err.code==="permission-denied"
      ? "독서 기록을 불러오지 못했어요. Firebase 보안 규칙에서 readings를 허용해야 해요."
      : "독서 기록을 불러오지 못했어요. 새로고침해 보고, 계속되면 알려주세요.");
  });
  resetForm(); rReset();
});

/* ---------- scores ---------- */
const CATS=[["coffee","커피 맛"],["interior","내부 분위기"],["exterior","외관"],["light","조명"],["chair","의자 편안함"]];
const avgOf = sc => { const v=Object.values(sc||{}).filter(n=>n>0); return v.length? v.reduce((a,b)=>a+b,0)/v.length : 0; };
function renderStars(){
  $("scores").innerHTML = CATS.map(([k,l])=>{ const cur=draft.scores[k]||0;
    return `<div class="score"><span class="lab">${l}</span><div class="stars" role="radiogroup" aria-label="${l}">${[1,2,3,4,5].map(n=>`<button type="button" role="radio" aria-checked="${cur===n}" aria-label="${l} ${n}점" class="${n<=cur?'on':''}" data-k="${k}" data-n="${n}">★</button>`).join("")}</div></div>`; }).join("");
  const a=avgOf(draft.scores); $("avgNow").innerHTML = a? `평균 <b>${a.toFixed(1)}</b> / 5` : "별을 눌러 점수를 매겨요. 같은 별을 한 번 더 누르면 지워져요.";
}
$("scores").addEventListener("click", e=>{ const b=e.target.closest("button"); if(!b) return; const k=b.dataset.k, n=+b.dataset.n; draft.scores[k] = draft.scores[k]===n?0:n; renderStars(); });

/* ---------- points ---------- */
function setKind(k){ ptKind=k; $("tGood").classList.toggle("on",k==="g"); $("tBad").classList.toggle("on",k==="b"); $("ptText").placeholder = k==="g"?"예: 창가 자리 햇빛 최고":"예: 의자가 딱딱해서 허리 아팠음"; }
$("tGood").onclick=()=>setKind("g"); $("tBad").onclick=()=>setKind("b");
function addPoint(){ const v=$("ptText").value.trim(); if(!v) return; draft.points.push({k:ptKind,t:v}); $("ptText").value=""; renderChips(); $("ptText").focus(); }
$("ptAdd").onclick=addPoint;
$("ptText").addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.isComposing){ e.preventDefault(); addPoint(); } });
function renderChips(){
  $("ptChips").innerHTML = draft.points.map((p,i)=>`<span class="chip ${p.k}"><span class="t">${p.k==="g"?"👍":"👎"} ${esc(p.t)}</span><button type="button" class="x" data-i="${i}" aria-label="삭제">✕</button></span>`).join("");
}
$("ptChips").addEventListener("click", e=>{ const b=e.target.closest(".x"); if(!b) return; draft.points.splice(+b.dataset.i,1); renderChips(); });

/* ---------- photos: 작게 줄여서 Firestore에 저장 ---------- */
const MAX_BYTES = 200 * 1024; // 사진 한 장 최대 약 200KB
async function shrinkToDataURL(file){
  const url = URL.createObjectURL(file);
  try{
    const img = await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url; });
    let max=1280, q=0.8, out="";
    for (let tries=0; tries<8; tries++){
      const s=Math.min(1, max/Math.max(img.width,img.height));
      const c=document.createElement("canvas"); c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);
      out=c.toDataURL("image/jpeg", q);
      if (out.length*0.75 <= MAX_BYTES) break;
      if (q>0.55) q-=0.1; else max=Math.round(max*0.8);
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}
$("file").addEventListener("change", async e=>{
  const files=[...e.target.files].slice(0, 4-draft.photos.length);
  e.target.value="";
  for(const f of files){
    try{ const data=await shrinkToDataURL(f); draft.photos.push({data, url:data}); }
    catch(err){ console.error(err); toast("이 사진은 열 수 없어요. 다른 사진으로 해 주세요"); }
  }
  renderPhotos();
});
function renderPhotos(){
  const box=$("photos"); box.querySelectorAll(".thumb").forEach(n=>n.remove());
  draft.photos.forEach((p,i)=>{ const d=document.createElement("div"); d.className="thumb"; d.innerHTML=`<img alt="" src="${p.url||""}"><button type="button" data-i="${i}" aria-label="사진 빼기">✕</button>`; box.insertBefore(d,$("addphoto")); });
  $("addphoto").hidden = draft.photos.length>=4;
}
$("photos").addEventListener("click", e=>{ const b=e.target.closest(".thumb button"); if(!b) return; draft.photos.splice(+b.dataset.i,1); renderPhotos(); });

// 사진은 한 번 저장되면 바뀌지 않으므로, 휴대폰에 남아 있는 사본이 있으면 그걸 먼저 써서 다시 받지 않는다
function loadPhoto(pid){
  if (photoCache[pid]) return Promise.resolve(photoCache[pid]);
  return photoLoading[pid] ||= (async()=>{
    try{
      const ref = doc(fs,"users",uid,"photos",pid);
      let snap;
      try { snap = await getDocFromCache(ref); } catch(_) { snap = await getDoc(ref); }
      const data = snap.exists() ? snap.data().data : "";
      if (data) photoCache[pid]=data;
      return data;
    } finally { delete photoLoading[pid]; }
  })();
}
function showGallery(g){
  g.querySelectorAll("img[data-pid]").forEach(async img=>{
    try{ const d=await loadPhoto(img.dataset.pid); if(d) img.src=d; }catch(_){}
  });
}
// 화면에 보이기 직전(약 화면 반 장 앞)에만 사진을 받는다
const io = "IntersectionObserver" in window
  ? new IntersectionObserver(es=>es.forEach(en=>{ if(en.isIntersecting){ io.unobserve(en.target); showGallery(en.target); } }), {rootMargin:"400px 0px"})
  : null;
function fillPhotos(root){
  if (io) io.disconnect();
  root.querySelectorAll(".gallery").forEach(g=>{
    const ready=[...g.querySelectorAll("img[data-pid]")].every(img=>photoCache[img.dataset.pid]);
    if (ready || !io) showGallery(g); else io.observe(g);
  });
}

/* ---------- form ---------- */
function resetForm(){
  editingId=null; draft={scores:{},points:[],photos:[]};
  $("form").reset(); $("date").value=today();
  const last = entries[0]; if(last){ $("cafe").value=last.cafe; $("addr").value=last.addr||""; }
  $("formTitle").textContent="오늘의 방문 기록"; $("saveBtn").textContent="기록 저장"; $("cancelEdit").hidden=true;
  renderStars(); renderChips(); renderPhotos(); setKind("g");
}
$("cancelEdit").onclick=resetForm;
$("cafe").addEventListener("change", ()=>{ if($("addr").value) return; const m=entries.find(e=>e.cafe===$("cafe").value.trim() && e.addr); if(m) $("addr").value=m.addr; });

$("form").addEventListener("submit", async e=>{
  e.preventDefault();
  if(!uid) return;
  if($("ptText").value.trim()) addPoint();
  const btn=$("saveBtn"); btn.disabled=true; btn.textContent="저장 중…";
  const wasEditing = editingId;
  try{
    const old = wasEditing ? entries.find(x=>x.id===wasEditing) : null;
    const photoIds=[];
    for(const p of draft.photos){
      if(p.id){ photoIds.push(p.id); continue; }
      const ref = doc(collection(fs,"users",uid,"photos"));
      await setDoc(ref, {data:p.data, createdAt:Date.now()});
      photoCache[ref.id]=p.data; photoIds.push(ref.id);
    }
    const data={
      cafe:$("cafe").value.trim(), date:$("date").value, addr:$("addr").value.trim(),
      scores:{...draft.scores},
      book:$("book").value.trim(), author:$("author").value.trim(), bookMemo:$("bookMemo").value.trim(),
      goods:draft.points.filter(p=>p.k==="g").map(p=>p.t),
      bads:draft.points.filter(p=>p.k==="b").map(p=>p.t),
      memo:$("memo").value.trim(), photos:photoIds
    };
    if(wasEditing){
      await updateDoc(doc(visitsCol, wasEditing), data);
      for (const pid of (old?.photos||[])) if(!photoIds.includes(pid)) deleteDoc(doc(fs,"users",uid,"photos",pid)).catch(()=>{});
    } else {
      data.createdAt=Date.now(); await addDoc(visitsCol, data);
    }
    toast(wasEditing?"수정했어요":"저장했어요");
    resetForm();
  }catch(err){
    console.error(err);
    toast("저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요");
  }finally{ btn.disabled=false; if(!editingId) btn.textContent="기록 저장"; }
});

function startEdit(id){
  const x=entries.find(e=>e.id===id); if(!x) return;
  editingId=id;
  $("cafe").value=x.cafe; $("date").value=x.date; $("book").value=x.book||""; $("memo").value=x.memo||"";
  $("addr").value=x.addr||""; $("author").value=x.author||""; $("bookMemo").value=x.bookMemo||"";
  draft={scores:{...(x.scores||{})},
    points:[...(x.goods||[]).map(t=>({k:"g",t})),...(x.bads||[]).map(t=>({k:"b",t}))],
    photos:(x.photos||[]).map(pid=>({id:pid,url:photoCache[pid]||""}))};
  renderStars(); renderChips(); renderPhotos();
  draft.photos.forEach(async (p,i)=>{ if(!p.url){ p.url=await loadPhoto(p.id).catch(()=>""); renderPhotos(); } });
  $("formTitle").textContent="기록 수정"; $("saveBtn").textContent="수정 저장"; $("cancelEdit").hidden=false;
  $("form").scrollIntoView({behavior:"smooth",block:"start"});
}

/* ---------- list ---------- */
function sortEntries(){ entries.sort((a,b)=> (b.date||"").localeCompare(a.date||"") || (b.createdAt||0)-(a.createdAt||0)); }
function renderStats(){
  if(!uid){ $("stats").innerHTML=""; return; }
  if(tab==="read"){
    const books=new Set(readings.map(r=>norm(r.title)).filter(Boolean)).size;
    $("stats").innerHTML = readings.length ? `<span>독서 기록 <b>${readings.length}</b>개</span><span>책 <b>${books}</b>권</span>` : "";
    return;
  }
  const cafes=new Set(entries.map(e=>e.cafe).filter(Boolean)).size;
  const goods=entries.reduce((n,e)=>n+(e.goods||[]).length,0), bads=entries.reduce((n,e)=>n+(e.bads||[]).length,0);
  $("stats").innerHTML = entries.length ? `<span>방문 <b>${entries.length}</b>회</span><span>북카페 <b>${cafes}</b>곳</span><span>좋았던 점 <b>${goods}</b></span><span>아쉬운 점 <b>${bads}</b></span>` : "";
}
const moreBtn = left => left>0 ? `<button type="button" class="more" data-act="more">더 보기 (${left}개 남음)</button>` : "";
function render(){
  const cafes=[...new Set(entries.map(e=>e.cafe).filter(Boolean))];
  $("cafeList").innerHTML=cafes.map(c=>`<option value="${esc(c)}">`).join("");
  renderStats(); renderTitles();
  if(!cafes.includes(filterCafe)) filterCafe="전체";
  $("filter").innerHTML = cafes.length>1 ? ["전체",...cafes].map(c=>`<button type="button" class="${c===filterCafe?'on':''}" data-c="${esc(c)}">${esc(c)}</button>`).join("") : "";
  const all = entries.filter(e=>filterCafe==="전체"||e.cafe===filterCafe);
  if(!all.length){
    $("list").innerHTML=`<div class="empty"><strong>아직 기록이 없어요</strong>위에서 북카페 이름이랑 사진, 좋았던 점 하나만 적고 저장해 보세요.</div>`;
    return;
  }
  const shown = all.slice(0, cShown);
  $("list").innerHTML = shown.map(e=>{
    const pics=(e.photos||[]).map(p=>`<img alt="${esc(e.cafe)} 사진" data-pid="${esc(p)}" src="${photoCache[p]||"data:image/gif;base64,R0lGODlhAQABAAAAACw="}">`).join("");
    const chips=[...(e.goods||[]).map(t=>`<span class="chip g"><span class="t">👍 ${esc(t)}</span></span>`),...(e.bads||[]).map(t=>`<span class="chip b"><span class="t">👎 ${esc(t)}</span></span>`)].join("");
    const d=fmtDate(e.date);
    const confirming = confirmId===e.id;
    const sc=e.scores||{}; const avg=avgOf(sc);
    const sg=CATS.filter(([k])=>sc[k]>0).map(([k,l])=>`<div><span class="k">${l}</span><span class="v" aria-label="${sc[k]}점">${"★".repeat(sc[k])}<i>${"★".repeat(5-sc[k])}</i></span></div>`).join("");
    return `<article class="entry">
      ${pics?`<div class="gallery">${pics}</div>`:""}
      <div class="body">
        <div class="top"><h3>${esc(e.cafe)}</h3><span class="date">${d}</span></div>
        ${e.addr?`<div class="addr">📍 <span>${esc(e.addr)}</span><button class="copy" data-act="copy" data-addr="${esc(e.addr)}">복사</button></div>`:""}
        ${sg?`<div class="avg">평균 <b>${avg.toFixed(1)}</b> / 5</div><div class="sgrid">${sg}</div>`:""}
        ${chips?`<div class="chips">${chips}</div>`:""}
        ${e.memo?`<p class="memo">${esc(e.memo)}</p>`:""}
        ${(e.book||e.bookMemo)?`<div class="bookbox"><span class="bt">📖 ${esc(e.book||"제목 없음")}${e.author?` <span style="font-weight:400;font-size:.85em">· ${esc(e.author)}</span>`:""}</span>${e.bookMemo?`<p>${esc(e.bookMemo)}</p>`:""}</div>`:""}
        <div class="foot">
          ${confirming
            ? `<span class="hint" style="align-self:center">이 기록을 지울까요?</span><button class="ghost" data-act="no" data-id="${e.id}">취소</button><button class="ghost danger" data-act="del" data-id="${e.id}">삭제</button>`
            : `<button class="ghost" data-act="edit" data-id="${e.id}">수정</button><button class="ghost" data-act="ask" data-id="${e.id}">삭제</button>`}
        </div>
      </div></article>`;
  }).join("") + moreBtn(all.length-shown.length);
  fillPhotos($("list"));
}
$("filter").addEventListener("click", e=>{ const b=e.target.closest("button"); if(!b) return; filterCafe=b.dataset.c; cShown=PAGE; render(); });
$("list").addEventListener("click", async e=>{
  const img=e.target.closest(".gallery img");
  if(img){ const v=document.createElement("div"); v.className="viewer"; v.innerHTML=`<img alt="" src="${img.src}">`; v.onclick=()=>v.remove(); document.body.appendChild(v); return; }
  const b=e.target.closest("button[data-act]"); if(!b) return;
  const id=b.dataset.id, act=b.dataset.act;
  if(act==="more"){ cShown+=PAGE; render(); return; }
  if(act==="copy"){ const t=b.dataset.addr; try{ await navigator.clipboard.writeText(t); toast("주소를 복사했어요"); }catch(_){ toast("길게 눌러서 주소를 복사해 주세요"); } return; }
  if(act==="edit") startEdit(id);
  else if(act==="ask"){ confirmId=id; render(); }
  else if(act==="no"){ confirmId=null; render(); }
  else if(act==="del"){
    confirmId=null;
    const x=entries.find(v=>v.id===id);
    try{
      const batch=writeBatch(fs);
      batch.delete(doc(visitsCol,id));
      for(const p of (x?.photos||[])) batch.delete(doc(fs,"users",uid,"photos",p));
      await batch.commit();
      toast("삭제했어요");
    }catch(err){ console.error(err); toast("삭제하지 못했어요. 다시 시도해 주세요"); render(); }
  }
});

/* ---------- 독서 기록 (users/{uid}/readings: {title, memo, createdAt}) ---------- */
// 책 제목 목록: 독서 기록 + 북카페 기록의 책, 최근에 쓴 순서
function titleMap(){
  const m=new Map();
  const add=(t,when)=>{ const k=norm(t); if(!k) return; const cur=m.get(k); if(!cur) m.set(k,{label:k,when}); else if(when>cur.when) cur.when=when; };
  readings.forEach(r=>add(r.title, ymdOf(r.createdAt||0)));
  entries.forEach(e=>add(e.book, e.date||""));
  return [...m.values()].sort((a,b)=>b.when.localeCompare(a.when));
}
function renderTitles(){ $("titleList").innerHTML = titleMap().map(t=>`<option value="${esc(t.label)}">`).join(""); }

function rCard(r){
  const confirming = rConfirmId===r.id;
  return `<article class="entry note"><div class="body">
    <div class="top"><h3>📖 ${esc(r.title)}</h3><span class="date">${fmtDate(ymdOf(r.createdAt||0))}</span></div>
    ${r.memo?`<p class="memo">${esc(r.memo)}</p>`:""}
    <div class="foot">${confirming
      ? `<span class="hint" style="align-self:center">이 기록을 지울까요?</span><button class="ghost" data-act="no" data-id="${r.id}">취소</button><button class="ghost danger" data-act="del" data-id="${r.id}">삭제</button>`
      : `<button class="ghost" data-act="edit" data-id="${r.id}">수정</button><button class="ghost" data-act="ask" data-id="${r.id}">삭제</button>`}</div>
  </div></article>`;
}
function vCard(e){
  return `<article class="entry note"><div class="body">
    <div class="top"><h3>📖 ${esc(norm(e.book))}</h3><span class="date">${fmtDate(e.date)}</span></div>
    <div class="from">☕ ${esc(e.cafe)}에서 읽음</div>
    ${e.bookMemo?`<p class="memo">${esc(e.bookMemo)}</p>`:""}
    <div class="foot"><button class="ghost" data-act="vedit" data-id="${e.id}">북카페 기록에서 수정</button></div>
  </div></article>`;
}
function renderReadings(){
  renderTitles(); renderStats();
  const titles=titleMap();
  if(rFilter && !titles.some(t=>t.label===rFilter)) rFilter="";
  $("rFilter").innerHTML = titles.length
    ? [["","전체"],...titles.map(t=>[t.label,t.label])].map(([v,l])=>`<button type="button" class="${v===rFilter?'on':''}" data-t="${esc(v)}">${esc(l)}</button>`).join("")
    : "";
  let items;
  if(!rFilter){
    if(!readings.length){
      $("rList").innerHTML=`<div class="empty"><strong>아직 독서 기록이 없어요</strong>책 제목만 적고 저장해도 돼요.</div>`;
      return;
    }
    items = readings.map(r=>({r}));
  } else {
    // 고른 책: 독서 기록 + 북카페 기록의 책 메모를 오래된 날짜부터
    items = [
      ...readings.filter(r=>norm(r.title)===rFilter).map(r=>({r, day:ymdOf(r.createdAt||0), at:r.createdAt||0})),
      ...entries.filter(e=>norm(e.book)===rFilter).map(e=>({e, day:e.date||"", at:e.createdAt||0}))
    ].sort((a,b)=>a.day.localeCompare(b.day) || a.at-b.at);
  }
  const shown=items.slice(0, rShown);
  $("rList").innerHTML =
    (rFilter ? `<p class="ftitle">『<b>${esc(rFilter)}</b>』 기록 ${items.length}개 · 오래된 날짜부터</p>` : "")
    + shown.map(x=>x.r ? rCard(x.r) : vCard(x.e)).join("")
    + moreBtn(items.length-shown.length);
}

function rReset(){
  rEditingId=null; $("rForm").reset();
  const t = rFilter || readings[0]?.title; if(t) $("rTitle").value=t;
  $("rFormTitle").textContent="오늘의 독서 기록"; $("rSave").textContent="기록 저장"; $("rCancel").hidden=true;
}
$("rCancel").onclick=rReset;
function startREdit(id){
  const r=readings.find(x=>x.id===id); if(!r) return;
  rEditingId=id; $("rTitle").value=r.title||""; $("rMemo").value=r.memo||"";
  $("rFormTitle").textContent="독서 기록 수정"; $("rSave").textContent="수정 저장"; $("rCancel").hidden=false;
  $("rForm").scrollIntoView({behavior:"smooth",block:"start"});
}
// 저장은 휴대폰에 먼저 기록되고 바로 목록에 나타난다. 인터넷이 약해도 기다리지 않고, 연결되면 알아서 올라간다
$("rForm").addEventListener("submit", e=>{
  e.preventDefault();
  if(!uid) return;
  const title=norm($("rTitle").value), memo=$("rMemo").value.trim();
  if(!title){ $("rTitle").focus(); return; }
  const editing=rEditingId;
  const fail=err=>{
    console.error(err); toast("저장하지 못했어요. 다시 시도해 주세요");
    if(!rEditingId && !$("rMemo").value){ $("rTitle").value=title; $("rMemo").value=memo; }
  };
  if(editing) updateDoc(doc(readsCol,editing),{title,memo}).catch(fail);
  else addDoc(readsCol,{title,memo,createdAt:Date.now()}).catch(fail);
  toast(navigator.onLine ? (editing?"수정했어요":"저장했어요") : "저장했어요. 인터넷이 연결되면 올라가요");
  rReset();
});
$("rFilter").addEventListener("click", e=>{
  const b=e.target.closest("button"); if(!b) return;
  rFilter=b.dataset.t; rShown=PAGE;
  if(rFilter && !rEditingId && !$("rMemo").value.trim()) $("rTitle").value=rFilter;
  renderReadings();
});
$("rList").addEventListener("click", e=>{
  const b=e.target.closest("button[data-act]"); if(!b) return;
  const id=b.dataset.id, act=b.dataset.act;
  if(act==="more"){ rShown+=PAGE; renderReadings(); }
  else if(act==="vedit"){ setTab("cafe"); startEdit(id); }
  else if(act==="edit") startREdit(id);
  else if(act==="ask"){ rConfirmId=id; renderReadings(); }
  else if(act==="no"){ rConfirmId=null; renderReadings(); }
  else if(act==="del"){
    rConfirmId=null;
    deleteDoc(doc(readsCol,id)).catch(err=>{ console.error(err); toast("삭제하지 못했어요. 다시 시도해 주세요"); });
    if(rEditingId===id) rReset();
    toast("삭제했어요");
  }
});

/* ---------- 탭 (마지막에 본 탭을 기억) ---------- */
function setTab(t){
  tab = t==="read" ? "read" : "cafe";
  $("cafeView").hidden = tab!=="cafe"; $("readView").hidden = tab!=="read";
  $("tabCafe").setAttribute("aria-selected", tab==="cafe"); $("tabRead").setAttribute("aria-selected", tab==="read");
  try{ localStorage.setItem("bcn-tab", tab); }catch(_){}
  renderStats();
}
$("tabCafe").onclick=()=>{ setTab("cafe"); window.scrollTo({top:0}); };
$("tabRead").onclick=()=>{ setTab("read"); window.scrollTo({top:0}); };
let savedTab="cafe"; try{ savedTab=localStorage.getItem("bcn-tab")||"cafe"; }catch(_){}
setTab(savedTab);

renderStars(); renderChips(); renderPhotos(); setKind("g"); $("date").value=today();
