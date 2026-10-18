// 북카페 노트 — Firebase(로그인 + Firestore) 버전
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, addDoc, setDoc,
  updateDoc, deleteDoc, getDoc, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

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
const today = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
function toast(msg){ const t=document.createElement("div"); t.className="toast"; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2400); }
function showNotice(t){ $("notice").textContent=t; $("notice").hidden=!t; }

let uid=null, visitsCol=null, unsub=null;
let entries=[];   // {id, cafe, date, addr, scores, book, author, bookMemo, goods, bads, memo, photos:[photoId], createdAt}
let filterCafe="전체";
let draft={scores:{}, points:[], photos:[]};  // photos: {id?, url, data?}
let ptKind="g", editingId=null, confirmId=null;
const photoCache={};  // photoId -> dataURL

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
  if (!user) {
    uid=null; entries=[];
    $("login").hidden=false; $("app").hidden=true; $("account").hidden=true; $("stats").innerHTML="";
    return;
  }
  uid=user.uid;
  $("who").textContent = user.email || user.displayName || "로그인됨";
  $("login").hidden=true; $("app").hidden=false; $("account").hidden=false;
  visitsCol = collection(fs, "users", uid, "visits");
  unsub = onSnapshot(visitsCol, snap => {
    entries = snap.docs.map(d=>({id:d.id, ...d.data()}));
    sortEntries(); render();
    if (!editingId && !$("cafe").value && entries[0]) { $("cafe").value=entries[0].cafe; $("addr").value=entries[0].addr||""; }
  }, err => { console.error(err); showNotice("기록을 불러오지 못했어요. 새로고침해 보고, 계속되면 알려주세요."); });
  resetForm();
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

async function loadPhoto(pid){
  if (photoCache[pid]) return photoCache[pid];
  const snap = await getDoc(doc(fs,"users",uid,"photos",pid));
  const data = snap.exists() ? snap.data().data : "";
  photoCache[pid]=data; return data;
}
function fillPhotos(root=document){
  root.querySelectorAll("img[data-pid]").forEach(async img=>{
    const pid=img.dataset.pid;
    try{ const d=await loadPhoto(pid); if(d) img.src=d; }catch(_){}
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
function render(){
  const cafes=[...new Set(entries.map(e=>e.cafe).filter(Boolean))];
  $("cafeList").innerHTML=cafes.map(c=>`<option value="${esc(c)}">`).join("");
  const goods=entries.reduce((n,e)=>n+(e.goods||[]).length,0), bads=entries.reduce((n,e)=>n+(e.bads||[]).length,0);
  $("stats").innerHTML = entries.length ? `<span>방문 <b>${entries.length}</b>회</span><span>북카페 <b>${cafes.length}</b>곳</span><span>좋았던 점 <b>${goods}</b></span><span>아쉬운 점 <b>${bads}</b></span>` : "";
  if(!cafes.includes(filterCafe)) filterCafe="전체";
  $("filter").innerHTML = cafes.length>1 ? ["전체",...cafes].map(c=>`<button type="button" class="${c===filterCafe?'on':''}" data-c="${esc(c)}">${esc(c)}</button>`).join("") : "";
  const shown = entries.filter(e=>filterCafe==="전체"||e.cafe===filterCafe);
  if(!shown.length){
    $("list").innerHTML=`<div class="empty"><strong>아직 기록이 없어요</strong>위에서 북카페 이름이랑 사진, 좋았던 점 하나만 적고 저장해 보세요.</div>`;
    return;
  }
  $("list").innerHTML = shown.map(e=>{
    const pics=(e.photos||[]).map(p=>`<img loading="lazy" alt="${esc(e.cafe)} 사진" data-pid="${esc(p)}" src="${photoCache[p]||"data:image/gif;base64,R0lGODlhAQABAAAAACw="}">`).join("");
    const chips=[...(e.goods||[]).map(t=>`<span class="chip g"><span class="t">👍 ${esc(t)}</span></span>`),...(e.bads||[]).map(t=>`<span class="chip b"><span class="t">👎 ${esc(t)}</span></span>`)].join("");
    const d=e.date? e.date.replace(/^(\d{4})-(\d\d)-(\d\d)$/,(m,y,mo,da)=>`${y}.${mo}.${da}`):"";
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
  }).join("");
  fillPhotos($("list"));
}
$("filter").addEventListener("click", e=>{ const b=e.target.closest("button"); if(!b) return; filterCafe=b.dataset.c; render(); });
$("list").addEventListener("click", async e=>{
  const img=e.target.closest(".gallery img");
  if(img){ const v=document.createElement("div"); v.className="viewer"; v.innerHTML=`<img alt="" src="${img.src}">`; v.onclick=()=>v.remove(); document.body.appendChild(v); return; }
  const b=e.target.closest("button[data-act]"); if(!b) return;
  const id=b.dataset.id, act=b.dataset.act;
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

renderStars(); renderChips(); renderPhotos(); setKind("g"); $("date").value=today();
