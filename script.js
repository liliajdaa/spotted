/* spotted. — app logic. On GitHub / a custom domain it runs in WEB mode:
   design, video, boards, for you, saved pieces and describe-to-search work;
   AI scanning, Google sign-in and the shared feed link to the live app. */
(() => {
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enc = encodeURIComponent;
const LIVE_APP = "https://claude.ai/artifact/6cHnkQjW45N5QwQGbEr2cb";
const WEB = !(window.claude && window.claude.use); // true on GitHub / your own domain
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800); }
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};

/* ---------- Capabilities (all optional) ---------- */
const cap = { sample: null, db: null, assets: null, user: null };
const ready = (async () => {
  if (!window.claude || !window.claude.use) return;
  const [s, d, a, u] = await Promise.all(["sample", "db", "assets", "user"].map(n => window.claude.use(n).catch(() => null)));
  Object.assign(cap, { sample: s, db: d, assets: a, user: u });
})();

/* ---------- Account (claude.ai sign-in + private storage) ---------- */
const EMPTY_PROFILE = { sizes: { tops: "", bottoms: "", shoes: "" }, budget: "", shops: "", styles: [], budgetInSearch: false };
const me = { id: null, name: "", loaded: false };
let profile = JSON.parse(JSON.stringify(EMPTY_PROFILE));
let history = [];
const signedIn = () => !!(me.id && cap.db);
const userDoc = k => cap.db.collection("data/users/" + me.id).doc(k);
async function getDoc(k) {
  try { const r = await userDoc(k).get(); if (!r || r.exists === false) return null; const d = typeof r.data === "function" ? r.data() : (r.data !== undefined ? r.data : r); return d && typeof d === "object" ? d : null; } catch (e) { return null; }
}
const writes = {};
function putDoc(k, data) { writes[k] = (writes[k] || Promise.resolve()).then(() => userDoc(k).set(data)).catch(() => toast("Couldn’t save to your account. Check your connection.")); return writes[k]; }
const initials = n => (n || "").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "Me";
async function loadAccount() {
  await ready;
  if (cap.user) {
    try { me.id = await cap.user.id(); } catch (e) { me.id = null; }
    try { const p = await cap.user.me(); me.name = (p && p.name) || ""; } catch (e) {}
  }
  if (signedIn()) {
    const [pr, sv, hi] = await Promise.all([getDoc("profile"), getDoc("saved"), getDoc("history")]);
    if (pr) profile = { ...EMPTY_PROFILE, ...pr, sizes: { ...EMPTY_PROFILE.sizes, ...(pr.sizes || {}) }, styles: Array.isArray(pr.styles) ? pr.styles : [] };
    history = hi && Array.isArray(hi.items) ? hi.items : [];
    const remote = sv && Array.isArray(sv.items) ? sv.items : [];
    const keys = new Set(remote.map(x => x.key));
    const merged = [...remote, ...savedPieces.filter(x => !keys.has(x.key))];
    savedPieces.splice(0, savedPieces.length, ...merged);
    if (merged.length !== remote.length) putDoc("saved", { items: savedPieces });
    store.set("spotted-saved", savedPieces);
    const [bo, ta, pk] = await Promise.all([getDoc("boards"), getDoc("taste"), getDoc("picks")]);
    if (bo && Array.isArray(bo.items)) { const ids = new Set(bo.items.map(b => b.id)); boards = [...bo.items, ...boards.filter(b => !ids.has(b.id))]; persistBoards(); }
    if (ta) { ["cat", "col", "mat"].forEach(k => Object.entries(ta[k] || {}).forEach(([x, v]) => { taste[k][x] = Math.max(taste[k][x] || 0, +v || 0); })); taste.n = Math.max(taste.n, +ta.n || 0); saveTaste(); }
    if (pk && Array.isArray(pk.items)) { aiPicks = pk; store.set("spotted-picks", pk); }
  }
  me.loaded = true;
  if (location.hash === "#explore") renderExplore();
  renderChip(); setSavedCount();
  const v = location.hash.slice(1);
  if (v === "account") renderAccount();
  if (v === "saved") renderSaved();
  if (v === "account") { confirmClear = false; renderAccount(); }
}
function renderChip() {
  const c = $("#acct-chip"); if (!c) return;
  c.classList.toggle("in", signedIn());
  c.querySelector(".ini").textContent = signedIn() ? initials(me.name) : "?";
  c.querySelector(".acct-lbl").textContent = signedIn() ? "Account" : "Sign in";
  c.setAttribute("aria-label", signedIn() ? `Your account${me.name ? ", " + me.name : ""}` : "Sign in");
  $("#saved-sub").textContent = signedIn() ? "your boards and saved pieces, kept on your account on any device." : "your boards and saved pieces, kept in this browser. sign in to keep them on your account.";
}
function persistSaved() {
  store.set("spotted-saved", savedPieces); setSavedCount();
  if (signedIn()) putDoc("saved", { items: savedPieces });
}

/* ---------- Search links ---------- */
function links(p) {
  let q = p.query || p.name;
  if (profile.budgetInSearch && profile.budget) q += " " + profile.budget;
  const shops = String(profile.shops || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 4);
  return [
    { label: "Shop on Google", href: `https://www.google.com/search?tbm=shop&q=${enc(q)}`, primary: true },
    { label: "Images", href: `https://www.google.com/search?tbm=isch&q=${enc(q)}` },
    { label: "Pinterest", href: `https://www.pinterest.com/search/pins/?q=${enc(q)}` },
    { label: "Resale", href: `https://www.vestiairecollective.com/search/?q=${enc(q)}` },
    ...shops.map(sh => ({ label: sh, href: `https://www.google.com/search?tbm=shop&q=${enc(q + " " + sh)}` })),
  ];
}

/* ---------- Data ---------- */
const CATS = ["All", "Outerwear", "Tops", "Knitwear", "Dresses", "Bottoms", "Shoes", "Bags", "Jewellery", "Eyewear", "Accessories", "Beauty", "Hair"];
let feed = [];          // shared looks (db) + this browser's looks
let filter = "All", query = "";
const local = store.get("spotted-local-looks", []);
const savedPieces = store.get("spotted-saved", []);
function setSavedCount() { $("#saved-count").textContent = savedPieces.length ? `(${savedPieces.length})` : ""; }

function normDocs(snap) {
  const arr = Array.isArray(snap) ? snap : (snap && (snap.docs || snap.items || snap.results)) || [];
  return arr.map(d => { const data = typeof d.data === "function" ? d.data() : (d.data && typeof d.data === "object" ? d.data : d); return { ...data, id: d.id || data.id }; }).filter(x => x && x.img && Array.isArray(x.pieces));
}
function mergeFeed(shared) {
  const ids = new Set(shared.map(x => x.id));
  feed = [...shared, ...local.filter(x => !ids.has(x.id))].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  renderFeed();
  if (location.hash === "#explore") renderExplore();
}
async function loadShared() {
  await ready;
  if (!cap.db) { mergeFeed([]); return; }
  try {
    let q = cap.db.collection("looks");
    try { q = q.orderBy("createdAt", "desc").limit(120); } catch (e) {}
    if (typeof q.onSnapshot === "function") {
      q.onSnapshot(snap => mergeFeed(normDocs(snap)), () => mergeFeed([]));
    } else if (typeof q.get === "function") {
      mergeFeed(normDocs(await q.get()));
    } else mergeFeed([]);
  } catch (e) { mergeFeed([]); }
}

/* ---------- Discover ---------- */
function renderFilters() {
  const used = new Set(feed.flatMap(l => l.pieces.map(p => p.category)));
  const cats = CATS.filter(c => c === "All" || used.has(c));
  $("#filters").innerHTML = cats.map(c => `<button type="button" data-f="${c}" aria-pressed="${c === filter}">${c}</button>`).join("");
}
function cardHTML(l) { return `<article class="card"><button type="button" data-open="${esc(l.id)}" aria-label="Open ${esc(l.title || "look")}, ${l.pieces.length} pieces identified"><span class="ph"><img src="${esc(l.img)}" alt="${esc(l.summary || l.title || "Fashion look")}" loading="lazy"><span class="over">${l.pieces.length} pieces identified</span></span><span class="cap"><b>${esc(l.title || "Untitled look")}</b><span>${esc([...new Set(l.pieces.map(p => p.category))].slice(0, 3).join(" · "))}</span></span></button></article>`; }
function renderFeed() {
  renderFilters();
  const q = query.trim().toLowerCase();
  const list = feed.filter(l => (filter === "All" || l.pieces.some(p => p.category === filter)) &&
    (!q || [l.title, l.summary, ...l.pieces.flatMap(p => [p.name, p.brand, p.colour, p.material, p.category])].join(" ").toLowerCase().includes(q)));
  const el = $("#feed");
  if (!feed.length) { el.innerHTML = demoFeedHTML(); return; }
  if (!list.length) { el.innerHTML = `<div class="empty-state"><h3>Nothing matches “${esc(query || filter)}”.</h3><p>Try a colour, a material or a category.</p></div>`; return; }
  el.innerHTML = `<div class="grid">${list.map(cardHTML).join("")}</div>`;
}
$("#filters").addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; renderFeed(); } });
$("#find").addEventListener("input", e => { query = e.target.value; if (location.hash !== "#discover" && location.hash !== "") location.hash = "discover"; renderFeed(); });
let findT; $("#find").addEventListener("input", () => { clearTimeout(findT); findT = setTimeout(() => { if (query.trim().length > 2) learnText(query); }, 1200); });
$("#find-form").addEventListener("submit", e => { e.preventDefault(); location.hash = "discover"; });
$("#feed").addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (b) openLook(feed.find(l => l.id === b.dataset.open), b); });

/* ---------- Look view ---------- */
function lookHTML(l, pre) {
  const spots = l.pieces.map((p, i) => Number.isFinite(+p.x) && Number.isFinite(+p.y) ? `<button class="spot" type="button" data-spot="${i}" aria-label="Piece ${i + 1}: ${esc(p.name)}" style="left:${Math.min(97, Math.max(3, +p.x))}%;top:${Math.min(97, Math.max(3, +p.y))}%">${i + 1}</button>` : "").join("");
  const pieces = l.pieces.map((p, i) => {
    const key = `${l.id}|${i}`;
    const on = savedPieces.some(s => s.key === key);
    const meta = [p.category, p.colour, p.material].filter(Boolean).join(" · ");
    const brand = p.brand ? `<div class="brand">Likely brand <b>${esc(p.brand)}</b>${p.brandConfidence ? `<span class="conf">${esc(p.brandConfidence)} confidence</span>` : ""}</div>` : `<div class="brand" style="color:var(--grey)">Brand not visible: search finds the closest matches</div>`;
    return `<li class="piece" id="${pre}-p${i}"><span class="n" aria-hidden="true">${i + 1}</span><h3>${esc(p.name)}</h3><div class="meta">${esc(meta)}${p.details && p.details.length ? " — " + esc(p.details.join(", ")) : ""}</div>${brand}
      <div class="shop">${links(p).map(k => `<a href="${k.href}" target="_blank" rel="noopener noreferrer" class="${k.primary ? "primary" : ""}">${k.label} ↗</a>`).join("")}<button type="button" class="savep" data-savep="${i}" aria-pressed="${on}">${on ? "Saved ✓" : "Save piece"}</button></div>
      <div class="q">Searching for <code>${esc(p.query || p.name)}</code></div></li>`;
  }).join("");
  return `<div class="look">
    <div class="stage-col">${l.img ? `<div class="stage"><img src="${esc(l.img)}" alt="${esc(l.summary || "Scanned look")}">${spots}</div><p class="stage-note">Numbers mark each identified piece (positions are approximate).</p>` : `<div class="stage demo-stage">${l.pieces.map((p, i) => `<button type="button" class="dtile" data-spot="${i}" aria-label="Piece ${i + 1}: ${esc(p.name)}">${tileHTML(p)}<span class="dnum" aria-hidden="true">${i + 1}</span></button>`).join("")}</div><p class="stage-note">demo look: pieces identified in advance. scan your own photo to see ai identification.</p>`}</div>
    <div><div class="look-head"><span class="label">${l.pieces.length} pieces identified</span><h2 ${pre === "sheet" ? 'id="look-title"' : ""}>${esc(l.title || "Your look")}</h2><p>${esc(l.summary || "")}</p></div>
      <div class="whole"><span>Want exact visual matches?</span><a class="btn small" href="https://lens.google.com/" target="_blank" rel="noopener noreferrer">Search the whole look on Google Lens ↗</a></div>
      ${l.pieces.length ? `<ol class="pieces">${pieces}</ol>` : `<p class="alert">No fashion or beauty pieces were found in this image. Try a clearer or closer photo.</p>`}</div>
  </div>`;
}
function wireLook(root, l, pre) {
  root.addEventListener("click", e => {
    const s = e.target.closest("[data-spot]");
    if (s) { const el = root.querySelector(`#${pre}-p${s.dataset.spot}`); if (el) { el.scrollIntoView({ block: "center", behavior: reduce() ? "auto" : "smooth" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1400); el.querySelector("a")?.focus({ preventScroll: true }); } return; }
    const sp = e.target.closest("[data-savep]");
    if (sp) {
      const i = +sp.dataset.savep, p = l.pieces[i], key = `${l.id}|${i}`;
      const obj = { key, name: p.name, brand: p.brand || "", category: p.category || "", colour: p.colour || "", material: p.material || "", query: p.query || p.name, look: l.title || "Your look" };
      openPicker(obj, () => { const on = !!pieceByKey(key); sp.setAttribute("aria-pressed", on); sp.textContent = on ? "Saved ✓" : "Save piece"; });
      cropThumb(l.img, +p.x, +p.y).then(t => { const sv = pieceByKey(key); if (t && sv && !sv.thumb) { sv.thumb = t; persistSaved(); } });
    }
  });
  root.addEventListener("mouseover", e => { const li = e.target.closest(".piece"); root.querySelectorAll(".spot").forEach(sp => sp.classList.toggle("on", !!li && li.id === `${pre}-p${sp.dataset.spot}`)); });
}
const sheet = $("#sheet"); let opener = null, sheetLook = null;
function openLook(l, from) {
  if (!l) return; opener = from || null; sheetLook = l;
  try { l.pieces.forEach(p => learn(p, 1)); } catch (e) {}
  const body = $("#sheet-body"); const fresh = body.cloneNode(false); body.replaceWith(fresh);
  fresh.innerHTML = lookHTML(l, "sheet"); wireLook(fresh, l, "sheet");
  $("#sheet-meta").textContent = l.mine ? "Posted from this browser" : "";
  if (!sheet.open) sheet.showModal(); sheet.scrollTop = 0; $("#sheet-close").focus();
}
$("#sheet-close").addEventListener("click", () => sheet.close());
sheet.addEventListener("click", e => { if (e.target === sheet) sheet.close(); });
sheet.addEventListener("close", () => { if (opener && document.contains(opener)) opener.focus(); });

/* ---------- Scan ---------- */
let current = null;   // { blob, url, result }
function capNote() {
  const n = $("#cap-note"); if (!n) return;
  if (WEB) {
    n.innerHTML = `<span class="alert" style="display:block">ai scanning runs in the spotted app. <a href="${LIVE_APP}" target="_blank" rel="noopener noreferrer">open the app ↗</a></span>
      <form id="describe" class="post" style="margin-top:14px;border-top:0;padding-top:0"><label class="label" for="desc-q">or describe the piece</label>
      <div class="row"><input id="desc-q" type="text" maxlength="100" placeholder="e.g. black leather trench coat" required><button class="btn solid" type="submit">find it</button></div></form><div id="desc-out"></div>`;
  } else if (!cap.sample) n.innerHTML = `<span class="alert" style="display:block">Identification runs through Claude. Open this page on claude.ai while signed in to scan images.</span>`;
  else n.textContent = "";
}
document.addEventListener("submit", e => {
  if (e.target.id !== "describe") return;
  e.preventDefault();
  const q = $("#desc-q").value.trim(); if (!q) return;
  learnText(q);
  const p = { key: "desc|" + q.toLowerCase(), name: q, category: kindOf(q), colour: colourOf(q), query: q, look: "described" };
  $("#desc-out").innerHTML = `<div class="shop" style="margin-top:12px">${links(p).map(k => `<a href="${k.href}" target="_blank" rel="noopener noreferrer" class="${k.primary ? "primary" : ""}">${esc(k.label)} ↗</a>`).join("")}<button type="button" class="savep" id="desc-save">save to a board</button></div>`;
  $("#desc-save").onclick = () => openPicker(p);
});
ready.then(capNote);

async function prepImage(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error("That file couldn’t be read as an image. Try a JPG or PNG.");
  const max = 1400, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", .86));
  return { blob, url: URL.createObjectURL(blob), w: c.width, h: c.height };
}
async function takeFile(file) {
  if (!file || !file.type.startsWith("image/")) { toast("Please use a JPG, PNG or WEBP image."); return; }
  try {
    if (current?.url) URL.revokeObjectURL(current.url);
    current = await prepImage(file);
    showPreview();
    location.hash = "scan";
  } catch (e) { toast(e.message); }
}
function showPreview() {
  $("#scan-result").innerHTML = "";
  $("#scan-left").innerHTML = `<div class="preview" id="preview"><img src="${current.url}" alt="Image to scan"></div>
    <div class="preview-bar"><button class="btn small" type="button" id="replace">Use another image</button><span class="label">${current.w} × ${current.h}px</span></div>`;
  $("#scan-right").innerHTML = `<div class="status"><span class="label">Image ready</span><h2>Identify the pieces</h2><p>Claude will list every visible fashion and beauty piece, then build the searches to find each one.</p><button class="btn solid" type="button" id="go" ${cap.sample ? "" : "disabled"}>Identify pieces</button><p id="cap-note" style="margin-top:14px"></p></div>`;
  capNote();
}
function resetScan() {
  if (current?.url) URL.revokeObjectURL(current.url); current = null;
  $("#scan-left").innerHTML = `<label class="drop" id="drop" for="file"><span class="label">JPG · PNG · WEBP</span><h2>Drop an image here</h2><p>or click to choose · you can also paste a screenshot (⌘V / Ctrl+V)</p><span class="btn solid">Choose image</span></label>`;
  $("#scan-right").innerHTML = `<div class="status"><span class="label">Ready</span><h2>What you’ll get</h2><p>Every visible piece, numbered on the image, with a precise description and one-click searches to find it or something close.</p><p id="cap-note"></p></div>`;
  $("#scan-result").innerHTML = ""; capNote();
}
$("#file").addEventListener("change", e => { takeFile(e.target.files[0]); e.target.value = ""; });
document.addEventListener("dragover", e => { if ($("#view-scan").hidden) return; e.preventDefault(); $("#drop")?.classList.add("over"); });
document.addEventListener("dragleave", e => { if (e.target.id === "drop") e.target.classList.remove("over"); });
document.addEventListener("drop", e => { if ($("#view-scan").hidden) return; e.preventDefault(); $("#drop")?.classList.remove("over"); takeFile(e.dataTransfer.files[0]); });
document.addEventListener("paste", e => { const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith("image/")); if (f) { e.preventDefault(); takeFile(f); } });
document.addEventListener("click", e => {
  if (e.target.id === "replace") resetScan();
  if (e.target.id === "go") identify();
  if (e.target.id === "post") postLook();
});

const PROMPT = `You are a fashion and beauty stylist helping someone find where the items in a photo come from.
Look at the attached image and identify every distinct fashion, accessory, beauty or hair item that is clearly visible (at most 8, most prominent first).
Never identify, name or guess who any person in the image is. Describe only the items.
Return ONLY a JSON object, no prose and no code fences, in exactly this shape:
{"title": string, "summary": string, "pieces": [{"name": string, "category": string, "colour": string, "material": string, "details": [string], "brand": string|null, "brandConfidence": "high"|"medium"|"low"|null, "query": string, "x": number, "y": number}]}
Rules:
- name: a specific, shoppable description, e.g. "Camel double-breasted wool maxi coat".
- category: exactly one of Outerwear, Tops, Knitwear, Dresses, Bottoms, Shoes, Bags, Jewellery, Eyewear, Accessories, Beauty, Hair.
- material: your best reading of the fabric or finish; use "" if it cannot be judged.
- details: up to 3 short distinguishing features (cut, hardware, pattern, finish).
- brand: only when a logo, monogram, label, packaging text or an unmistakable signature design is visible. Otherwise null. Never guess a brand from general style.
- query: what an expert would type into Google Shopping to find this exact item or the closest match. Include the brand if known, plus colour, material and key details. At most 10 words.
- x, y: the centre of the item as a percentage (0-100) of the image width and height.
- title: a 2-5 word editorial title for the whole look. summary: one sentence on the overall style.
If no fashion or beauty items are visible, return {"title": "", "summary": "No fashion or beauty items found.", "pieces": []}.`;

function parseJSON(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("bad");
  const v = JSON.parse(text.slice(a, b + 1));
  const pieces = (Array.isArray(v.pieces) ? v.pieces : []).slice(0, 8).map(p => ({
    name: String(p.name || "Unnamed piece").slice(0, 120), category: CATS.includes(p.category) ? p.category : "Accessories",
    colour: String(p.colour || "").slice(0, 40), material: String(p.material || "").slice(0, 40),
    details: (Array.isArray(p.details) ? p.details : []).slice(0, 3).map(d => String(d).slice(0, 60)),
    brand: p.brand ? String(p.brand).slice(0, 60) : null, brandConfidence: ["high", "medium", "low"].includes(p.brandConfidence) ? p.brandConfidence : null,
    query: String(p.query || p.name || "").slice(0, 120), x: +p.x, y: +p.y,
  }));
  return { title: String(v.title || "").slice(0, 60), summary: String(v.summary || "").slice(0, 240), pieces };
}

let busy = false;
async function identify() {
  if (busy || !current) return;
  if (!cap.sample) { capNote(); return; }
  busy = true;
  $("#preview").insertAdjacentHTML("beforeend", `<span class="scanbar" aria-hidden="true"></span>`);
  $("#scan-right").innerHTML = `<div class="status"><span class="label">Scanning</span><h2>Reading the image…</h2><ol class="progress" aria-live="polite"><li class="on">Finding each piece in the photo</li><li>Describing colour, material and details</li><li>Checking for visible brands</li><li>Writing the searches</li></ol><button class="btn small" type="button" id="cancel">Cancel</button></div>`;
  const steps = [...document.querySelectorAll(".progress li")];
  let s = 0; const tick = setInterval(() => { if (s < steps.length - 1) { steps[s].className = "done"; s++; steps[s].className = "on"; } }, 2600);
  const ctrl = new AbortController();
  $("#cancel").addEventListener("click", () => ctrl.abort());
  try {
    let images = [current.blob];
    try { const lim = await cap.sample.limits?.(); if (lim && lim.images === false) images = null; } catch (e) {}
    if (!images) throw { code: "no_images" };
    const res = await cap.sample(PROMPT, { images, signal: ctrl.signal, modelTier: "default", cache: false });
    const result = parseJSON(res.text || "");
    current.result = result;
    const look = { id: "scan-" + Date.now(), img: current.url, ...result };
    showResult(look);
    if (signedIn()) addHistory(look);
  } catch (e) {
    const code = e && e.code;
    const msg = ctrl.signal.aborted ? "Scan cancelled." :
      code === "rate_limited" ? "Too many scans in a row. Wait a minute, then try again." :
      code === "not_granted" ? "Claude access was declined for this page. Allow it from the page’s Permissions menu to scan." :
      code === "no_images" ? "Image reading isn’t available in this view. Open the page on claude.ai to scan." :
      e && e.message === "bad" ? "The result came back in an unexpected format. Try the scan again." :
      "The scan didn’t finish. Check your connection and try again.";
    $("#scan-right").innerHTML = `<div class="status"><span class="label">Not finished</span><h2>Let’s try that again</h2><p class="alert">${esc(msg)}</p><button class="btn solid" type="button" id="go">Try again</button></div>`;
  } finally {
    clearInterval(tick); busy = false; document.querySelector(".scanbar")?.remove();
  }
}
function showResult(look) {
  $("#scan-left").innerHTML = ""; $("#scan-right").innerHTML = "";
  const canShare = !!(cap.db && cap.assets);
  const out = $("#scan-result");
  const fresh = out.cloneNode(false); out.replaceWith(fresh);
  fresh.innerHTML = lookHTML(look, "scan") + (look.pieces.length ? `<div class="post"><span class="label">${canShare ? "Share to Discover" : "Keep this look"}</span>
    <div class="row"><label class="sr-only" for="post-title">Title</label><input id="post-title" type="text" maxlength="60" value="${esc(look.title)}" placeholder="Give the look a title">
    <button class="btn solid" type="button" id="post">${canShare ? "Post to Discover" : "Save to this browser"}</button><button class="btn" type="button" id="replace">Scan another</button></div>
    <p class="stage-note">${canShare ? "Posting shares the image and its pieces with everyone who has access to this page." : "Shared posting needs this page open on claude.ai. Until then, looks are kept in this browser only."}</p></div>` : `<div class="post"><div class="row"><button class="btn" type="button" id="replace">Scan another</button></div></div>`);
  wireLook(fresh, look, "scan");
  try { look.pieces.forEach(p => learn(p, 2)); } catch (e) {}
  fresh.scrollIntoView({ block: "start", behavior: reduce() ? "auto" : "smooth" });
  current.look = look;
}
async function postLook() {
  if (!current?.look) return;
  const btn = $("#post"); btn.disabled = true; btn.textContent = "Posting…";
  const title = ($("#post-title").value || current.look.title || "Untitled look").trim().slice(0, 60);
  const base = { title, summary: current.look.summary, pieces: current.look.pieces, createdAt: Date.now() };
  try {
    if (cap.db && cap.assets) {
      const up = await cap.assets.upload(current.blob);
      const id = "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      let by = null; try { by = cap.user && cap.user.id ? await cap.user.id() : null; } catch (e) {}
      const doc = { ...base, img: up.url || ("/_blob/" + up.id), assetId: up.id, by };
      const ref = cap.db.doc ? cap.db.doc("looks/" + id) : cap.db.collection("looks").doc(id);
      await ref.set(doc);
      if (typeof cap.db.collection("looks").onSnapshot !== "function") loadShared();
      toast("Posted to Discover");
    } else {
      const dataURL = await new Promise((r, j) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = j; fr.readAsDataURL(current.blob); });
      const look = { ...base, id: "local-" + Date.now(), img: dataURL, mine: true };
      local.unshift(look);
      if (!store.set("spotted-local-looks", local)) { local.shift(); throw new Error("full"); }
      mergeFeed(feed.filter(x => !String(x.id).startsWith("local-")));
      toast("Saved to this browser");
    }
    location.hash = "discover";
    resetScan();
  } catch (e) {
    btn.disabled = false; btn.textContent = cap.db && cap.assets ? "Post to Discover" : "Save to this browser";
    toast(e && e.message === "full" ? "This browser is out of space for more looks." : (e && (e.code === "not_granted" || e.code === "not_writer")) ? "You can view this page but not post to it. Ask the owner for edit access." : "Posting didn’t work. Try again.");
  }
}

/* ---------- Colours, kinds, taste ---------- */
const COLOURS = { black: "#1b1a19", white: "#f4f1ea", ivory: "#efe6d6", cream: "#efe6d6", beige: "#d8c7ae", camel: "#b98a57", tan: "#c19a6b", brown: "#6b4a33", chocolate: "#4a3326", burgundy: "#6e1f2c", wine: "#6e1f2c", red: "#b3262e", pink: "#e7a9b5", blush: "#e9c2b8", nude: "#d9b8a0", taupe: "#a8998a", green: "#4f6b4a", olive: "#6b6a3f", khaki: "#a39a72", navy: "#1f2a44", blue: "#5577aa", denim: "#5d7aa0", grey: "#9a958d", gray: "#9a958d", charcoal: "#3b3a38", silver: "#c7c7c7", gold: "#c9a54e", leopard: "#b0874d", lilac: "#b8a6cc", purple: "#6d4f8a", yellow: "#e1c35a", orange: "#d27a3a" };
const MATERIALS = ["leather", "suede", "wool", "cashmere", "denim", "silk", "satin", "knit", "cotton", "linen", "faux fur", "fur", "shearling", "tweed", "velvet", "patent", "pearl", "corduroy"];
const KIND = { coat: "Outerwear", jacket: "Outerwear", blazer: "Outerwear", trench: "Outerwear", bomber: "Outerwear", sweater: "Knitwear", cardigan: "Knitwear", jumper: "Knitwear", turtleneck: "Knitwear", top: "Tops", shirt: "Tops", tee: "Tops", tank: "Tops", blouse: "Tops", dress: "Dresses", skirt: "Bottoms", jeans: "Bottoms", trousers: "Bottoms", pants: "Bottoms", shorts: "Bottoms", boots: "Shoes", heels: "Shoes", loafers: "Shoes", sneakers: "Shoes", mules: "Shoes", flats: "Shoes", bag: "Bags", tote: "Bags", clutch: "Bags", earrings: "Jewellery", necklace: "Jewellery", ring: "Jewellery", bracelet: "Jewellery", watch: "Accessories", sunglasses: "Eyewear", glasses: "Eyewear", scarf: "Accessories", headscarf: "Accessories", belt: "Accessories", lipstick: "Beauty", tint: "Beauty", parfum: "Beauty", perfume: "Beauty", clip: "Hair", bow: "Hair" };
const wordRe = w => new RegExp("\\b" + w.replace(/[-]/g, "\\-") + "\\b");
function colourOf(text) { const t = String(text || "").toLowerCase(); return Object.keys(COLOURS).find(k => wordRe(k).test(t)) || ""; }
function kindOf(text) { const t = String(text || "").toLowerCase(); const k = Object.keys(KIND).find(w => wordRe(w).test(t)); return k ? KIND[k] : ""; }
function kindWord(p) {
  const t = String(p.name || "").toLowerCase(); let best = "", at = -1;
  let pref = "", pat = -1;
  Object.keys(KIND).forEach(w => { const m = t.match(wordRe(w)); if (m) { if (m.index >= at) { at = m.index; best = w; } if (KIND[w] === p.category && m.index >= pat) { pat = m.index; pref = w; } } });
  if (pref) return pref;
  return best || String(p.category || "piece").toLowerCase();
}
const swatch = text => COLOURS[colourOf(text)] || "#e3dbd0";
function inkOn(hex) { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#1b1a19" : "#fbf9f6"; }

const taste = Object.assign({ cat: {}, col: {}, mat: {}, n: 0 }, store.get("spotted-taste", {}) || {});
let tasteT;
function bump(map, k, w) { if (k) map[k] = (map[k] || 0) + w; }
function saveTaste() { clearTimeout(tasteT); tasteT = setTimeout(() => { store.set("spotted-taste", taste); if (signedIn()) putDoc("taste", taste); }, 800); }
function learn(p, w) {
  const text = [p.name, p.colour, p.material].join(" ").toLowerCase();
  bump(taste.cat, p.category || kindOf(text), w);
  bump(taste.col, colourOf((p.colour || "") + " " + (p.name || "")), w);
  MATERIALS.forEach(m => { if (text.includes(m)) bump(taste.mat, m, w); });
  taste.n += w; saveTaste();
}
function learnText(q) { learn({ name: q, category: kindOf(q) }, 1); }
const topKeys = (m, n) => Object.entries(m || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);

/* ---------- Boards ---------- */
let boards = store.get("spotted-boards", []) || [];
function persistBoards() { store.set("spotted-boards", boards); if (signedIn()) putDoc("boards", { items: boards }); }
const pieceByKey = k => savedPieces.find(p => p.key === k);
function savePiece(obj) { if (!pieceByKey(obj.key)) { savedPieces.unshift(obj); persistSaved(); learn(obj, 3); } }
function unsavePiece(key) {
  const i = savedPieces.findIndex(p => p.key === key); if (i >= 0) savedPieces.splice(i, 1);
  boards.forEach(b => { b.keys = b.keys.filter(k => k !== key); });
  persistSaved(); persistBoards();
}
async function cropThumb(src, x, y) {
  try {
    const im = new Image(); if (!/^(blob|data):/.test(src)) im.crossOrigin = "anonymous"; im.src = src; await im.decode();
    const w = im.naturalWidth, h = im.naturalHeight, side = Math.min(w, h) * 0.42;
    const cx = (Number.isFinite(x) ? x : 50) / 100 * w, cy = (Number.isFinite(y) ? y : 50) / 100 * h;
    const sx = Math.max(0, Math.min(w - side, cx - side / 2)), sy = Math.max(0, Math.min(h - side, cy - side / 2));
    const c = document.createElement("canvas"); c.width = c.height = 160;
    c.getContext("2d").drawImage(im, sx, sy, side, side, 0, 0, 160, 160);
    return c.toDataURL("image/jpeg", 0.6);
  } catch (e) { return null; }
}
function tileHTML(p) {
  if (!p) return `<span class="tile"></span>`;
  if (p.thumb) return `<span class="tile"><img src="${esc(p.thumb)}" alt=""></span>`;
  const c = swatch((p.colour || "") + " " + p.name);
  return `<span class="tile" style="background:${c};color:${inkOn(c)}"><em>${esc(kindWord(p))}</em></span>`;
}
function coverHTML(keys, n) {
  const ps = keys.map(pieceByKey).filter(Boolean);
  if (n === 1) return tileHTML(ps[0]);
  if (ps.length === 1) return `<span class="collage one">${tileHTML(ps[0])}</span>`;
  return `<span class="collage">${[0, 1, 2, 3].map(i => tileHTML(ps[i])).join("")}</span>`;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* board picker */
const pick = $("#boardpick"); let pickKey = null, pickCb = null;
function openPicker(obj, cb) {
  savePiece(obj); pickKey = obj.key; pickCb = cb || null;
  $("#pick-piece").textContent = obj.name; $("#pick-name").value = "";
  renderPick(); if (!pick.open) pick.showModal();
}
function renderPick() {
  $("#pick-list").innerHTML = boards.length ? boards.map(b => {
    const on = b.keys.includes(pickKey);
    return `<li><button type="button" data-pb="${esc(b.id)}" aria-pressed="${on}"><span class="pb-cover">${coverHTML(b.keys, 1)}</span><span class="pb-name">${esc(b.name)}<small>${plural(b.keys.length, "piece")}</small></span><span class="pb-state">${on ? "added ✓" : "add"}</span></button></li>`;
  }).join("") : `<li class="hint">saved ✓ — now make your first board below, e.g. “fall 2026” or “wishlist”.</li>`;
}
$("#pick-list").addEventListener("click", e => {
  const b = e.target.closest("[data-pb]"); if (!b) return;
  const bd = boards.find(x => x.id === b.dataset.pb); if (!bd) return;
  const i = bd.keys.indexOf(pickKey); if (i >= 0) bd.keys.splice(i, 1); else bd.keys.unshift(pickKey);
  persistBoards(); renderPick();
});
$("#pick-new").addEventListener("submit", e => {
  e.preventDefault(); const n = $("#pick-name").value.trim(); if (!n) return;
  boards.unshift({ id: "b" + Date.now().toString(36), name: n.slice(0, 40), keys: [pickKey], createdAt: Date.now() });
  persistBoards(); $("#pick-name").value = ""; renderPick(); toast(`added to “${n}”`);
});
$("#pick-remove").addEventListener("click", () => { unsavePiece(pickKey); pick.close(); toast("removed from saved"); });
$("#pick-done").addEventListener("click", () => pick.close());
$("#pick-close").addEventListener("click", () => pick.close());
pick.addEventListener("click", e => { if (e.target === pick) pick.close(); });
pick.addEventListener("close", () => { setSavedCount(); if (pickCb) pickCb(); if (location.hash === "#saved") renderBoards(); });

/* boards page */
let openBoard = null, confirmDel = false;
function renderSaved() { renderBoards(); }
function renderBoards() {
  const el = $("#saved-out");
  if (openBoard) return renderBoard(el);
  if (!savedPieces.length && !boards.length) {
    el.innerHTML = `<div class="empty-state"><span class="label">nothing saved yet</span><h3>start your first board.</h3><p>open a look or your for you page and press save on any piece. sort what you find into boards like “fall 2026” or “wishlist”.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn solid" type="button" id="load-demo">load 7 demo boards</button><a class="btn" href="#explore">see for you</a><a class="btn" href="#scan">scan a look</a></div></div>`;
    return;
  }
  const cards = [{ id: "all", name: "all saved", keys: savedPieces.map(p => p.key) }, ...boards];
  el.innerHTML = `<div class="boards">${cards.map(b => `<button class="board" type="button" data-board="${esc(b.id)}">${coverHTML(b.keys, 4)}<span class="board-name">${esc(b.name)}</span><span class="board-count">${plural(b.keys.length, "piece")}</span></button>`).join("")}
    <form class="board new-board" id="new-board"><span class="label">new board</span><label class="sr-only" for="nb-name">Board name</label><input id="nb-name" type="text" maxlength="40" placeholder="e.g. fall 2026"><button class="btn solid small" type="submit">create board</button></form></div>${demoLoaded() ? "" : `<p class="hint" style="margin-top:28px">want to see how boards work? <button class="linkish" type="button" id="load-demo">load the 7 demo boards</button></p>`}`;
}
function pieceCard(p, boardId) {
  return `<article class="pcard">${tileHTML(p)}<div class="pcard-body"><b>${esc(p.name)}</b><span class="meta">${esc([p.category, p.colour, p.brand].filter(Boolean).join(" · ").toLowerCase())}</span>
    <div class="shop">${links(p).slice(0, 3).map(k => `<a href="${k.href}" target="_blank" rel="noopener noreferrer" class="${k.primary ? "primary" : ""}">${esc(k.label)} ↗</a>`).join("")}</div>
    <div class="pcard-actions"><button class="linkish" type="button" data-move="${esc(p.key)}">boards…</button>${boardId === "all" ? `<button class="linkish" type="button" data-unsave="${esc(p.key)}">remove</button>` : `<button class="linkish" type="button" data-unboard="${esc(p.key)}">remove from board</button>`}</div></div></article>`;
}
function renderBoard(el) {
  const b = openBoard === "all" ? { id: "all", name: "all saved", keys: savedPieces.map(p => p.key) } : boards.find(x => x.id === openBoard);
  if (!b) { openBoard = null; return renderBoards(); }
  const ps = b.keys.map(pieceByKey).filter(Boolean);
  el.innerHTML = `<div class="board-head"><button class="btn small" type="button" id="board-back">← all boards</button>
    ${b.id === "all" ? `<h2>all saved</h2>` : `<label class="sr-only" for="board-title">Board name</label><input class="board-title" id="board-title" value="${esc(b.name)}" maxlength="40">`}
    <span class="label">${plural(ps.length, "piece")}</span>
    ${b.id !== "all" ? `<button class="btn small warn" type="button" id="board-del">${confirmDel ? "yes, delete board" : "delete board"}</button>${confirmDel ? `<button class="btn small" type="button" id="board-del-no">cancel</button>` : ""}` : ""}</div>
    ${ps.length ? `<div class="pieces-grid">${ps.map(p => pieceCard(p, b.id)).join("")}</div>` : `<p class="hint">this board is empty. press save on any piece in a look or on your for you page, then add it here.</p>`}`;
}
$("#saved-out").addEventListener("click", e => {
  const b = e.target.closest("[data-board]"); if (b) { openBoard = b.dataset.board; confirmDel = false; renderBoards(); window.scrollTo(0, 0); return; }
  if (e.target.id === "board-back") { openBoard = null; renderBoards(); return; }
  if (e.target.id === "board-del") {
    if (!confirmDel) { confirmDel = true; renderBoards(); return; }
    boards = boards.filter(x => x.id !== openBoard); persistBoards(); openBoard = null; confirmDel = false; renderBoards(); toast("board deleted"); return;
  }
  if (e.target.id === "board-del-no") { confirmDel = false; renderBoards(); return; }
  const mv = e.target.closest("[data-move]"); if (mv) { const p = pieceByKey(mv.dataset.move); if (p) openPicker(p); return; }
  const un = e.target.closest("[data-unsave]"); if (un) { unsavePiece(un.dataset.unsave); renderBoards(); toast("removed"); return; }
  const ub = e.target.closest("[data-unboard]");
  if (ub) { const bd = boards.find(x => x.id === openBoard); if (bd) { bd.keys = bd.keys.filter(k => k !== ub.dataset.unboard); persistBoards(); renderBoards(); toast("removed from board"); } }
});
$("#saved-out").addEventListener("submit", e => {
  if (e.target.id !== "new-board") return; e.preventDefault();
  const n = $("#nb-name").value.trim(); if (!n) return;
  boards.unshift({ id: "b" + Date.now().toString(36), name: n.slice(0, 40), keys: [], createdAt: Date.now() });
  persistBoards(); renderBoards(); toast(`board “${n}” created`);
});
$("#saved-out").addEventListener("change", e => {
  if (e.target.id !== "board-title") return;
  const bd = boards.find(x => x.id === openBoard), n = e.target.value.trim();
  if (bd && n) { bd.name = n.slice(0, 40); persistBoards(); toast("board renamed"); }
});

/* ---------- For you (explore) ---------- */
const CATALOG = [
  ["camel wool wrap coat", "Outerwear", "camel", "wool", ["classic", "old money", "minimal"]],
  ["black leather biker jacket", "Outerwear", "black", "leather", ["edgy", "grunge", "streetwear"]],
  ["chocolate suede bomber jacket", "Outerwear", "brown", "suede", ["classic", "boho"]],
  ["leopard faux fur coat", "Outerwear", "leopard", "faux fur", ["edgy", "romantic"]],
  ["beige trench coat", "Outerwear", "beige", "cotton", ["classic", "minimal", "old money"]],
  ["oversized grey wool blazer", "Outerwear", "grey", "wool", ["minimal", "classic"]],
  ["cream shearling aviator jacket", "Outerwear", "cream", "shearling", ["romantic", "old money"]],
  ["navy quilted barn jacket", "Outerwear", "navy", "cotton", ["old money", "sporty"]],
  ["chunky cream cable-knit sweater", "Knitwear", "cream", "wool", ["classic", "romantic"]],
  ["black cashmere turtleneck", "Knitwear", "black", "cashmere", ["minimal", "classic"]],
  ["grey marl crewneck sweater", "Knitwear", "grey", "wool", ["minimal", "sporty"]],
  ["burgundy v-neck cardigan", "Knitwear", "burgundy", "wool", ["romantic", "classic"]],
  ["white ribbed tank top", "Tops", "white", "cotton", ["minimal", "streetwear"]],
  ["blue oxford button-down shirt", "Tops", "blue", "cotton", ["old money", "classic"]],
  ["chocolate satin blouse", "Tops", "brown", "satin", ["romantic", "classic"]],
  ["black slip midi dress", "Dresses", "black", "satin", ["minimal", "romantic"]],
  ["burgundy knit midi dress", "Dresses", "burgundy", "knit", ["classic", "romantic"]],
  ["straight-leg mid-blue jeans", "Bottoms", "denim", "denim", ["classic", "streetwear", "minimal"]],
  ["wide-leg cream tailored trousers", "Bottoms", "cream", "wool", ["old money", "minimal"]],
  ["black leather midi skirt", "Bottoms", "black", "leather", ["edgy", "minimal"]],
  ["brown suede mini skirt", "Bottoms", "brown", "suede", ["boho", "y2k"]],
  ["black pointed knee-high boots", "Shoes", "black", "leather", ["edgy", "classic"]],
  ["chocolate kitten-heel ankle boots", "Shoes", "brown", "leather", ["classic", "minimal"]],
  ["black leather penny loafers", "Shoes", "black", "leather", ["old money", "classic"]],
  ["snakeskin kitten-heel mules", "Shoes", "beige", "leather", ["romantic", "y2k"]],
  ["burgundy ballet flats", "Shoes", "burgundy", "leather", ["romantic", "classic"]],
  ["white leather sneakers", "Shoes", "white", "leather", ["sporty", "minimal", "streetwear"]],
  ["brown suede shoulder bag", "Bags", "brown", "suede", ["boho", "classic"]],
  ["black leather tote bag", "Bags", "black", "leather", ["minimal", "classic"]],
  ["tan croc-effect top-handle bag", "Bags", "tan", "leather", ["old money", "classic"]],
  ["burgundy leather baguette bag", "Bags", "burgundy", "leather", ["y2k", "romantic"]],
  ["gold hoop earrings", "Jewellery", "gold", "", ["classic", "minimal"]],
  ["chunky gold dome earrings", "Jewellery", "gold", "", ["old money", "edgy"]],
  ["pearl drop earrings", "Jewellery", "white", "pearl", ["romantic", "old money"]],
  ["layered gold chain necklace", "Jewellery", "gold", "", ["boho", "y2k"]],
  ["oval black sunglasses", "Eyewear", "black", "", ["edgy", "y2k", "minimal"]],
  ["tortoiseshell cat-eye sunglasses", "Eyewear", "brown", "", ["classic", "romantic"]],
  ["gold square-face watch", "Accessories", "gold", "", ["classic", "old money"]],
  ["silk printed headscarf", "Accessories", "blue", "silk", ["old money", "romantic"]],
  ["chocolate leather belt with gold buckle", "Accessories", "brown", "leather", ["classic", "boho"]],
  ["sheer berry lip tint", "Beauty", "burgundy", "", ["romantic", "minimal"]],
  ["warm vanilla eau de parfum", "Beauty", "cream", "", ["romantic", "classic"]],
  ["tortoiseshell claw clip", "Hair", "brown", "", ["minimal", "classic"]],
  ["black satin hair bow", "Hair", "black", "satin", ["romantic", "y2k"]],
].map(([name, category, colour, material, styles]) => ({ name, category, colour, material, styles, query: name }));

let aiPicks = store.get("spotted-picks", null), aiBusy = false, currentPicks = [];
function rankCatalog() {
  const styles = (profile.styles || []).map(x => x.toLowerCase());
  const saved = new Set(savedPieces.map(p => String(p.name).toLowerCase()));
  const mx = m => Math.max(1, ...Object.values(m || {}));
  const mc = mx(taste.cat), mo = mx(taste.col), mm = mx(taste.mat);
  const day = new Date().getDate();
  return CATALOG.map((p, i) => {
    let sc = 0; const why = [];
    const c = (taste.cat[p.category] || 0) / mc; if (c > 0) { sc += c * 1.2; why.push(p.category.toLowerCase()); }
    const o = (taste.col[p.colour] || 0) / mo; if (o > 0) { sc += o; why.push(p.colour); }
    const m = p.material ? (taste.mat[p.material] || 0) / mm : 0; if (m > 0) { sc += m * 0.7; why.push(p.material); }
    const st = p.styles.filter(x => styles.includes(x)); if (st.length) { sc += 0.8 * st.length; why.push(st[0]); }
    return { ...p, score: sc - (saved.has(p.name) ? 5 : 0) + ((i * 7 + day) % 11) * 0.001, why: why.length ? "because you like " + why.slice(0, 2).join(" & ") : "editor’s pick" };
  }).sort((a, b) => b.score - a.score);
}
function rankLooks() {
  return (feed.length ? feed : DEMO).map(l => ({ l, s: l.pieces.reduce((a, p) => a + (taste.cat[p.category] || 0) + (taste.col[colourOf((p.colour || "") + " " + p.name)] || 0), 0) }))
    .sort((a, b) => b.s - a.s).map(x => x.l);
}
function pickCard(p, i) {
  const c = swatch((p.colour || "") + " " + p.name), saved = !!pieceByKey("pick|" + p.name), L = links(p);
  return `<article class="pick-card"><div class="pick-sw" style="background:${c};color:${inkOn(c)}"><span class="label">${esc(String(p.category || "").toLowerCase())}</span><em>${esc(kindWord(p))}</em>${p.ai ? `<span class="ai-tag">ai pick</span>` : ""}</div>
    <b>${esc(p.name)}</b><span class="meta">${esc(p.why || "")}</span>
    <div class="shop"><a class="primary" href="${L[0].href}" target="_blank" rel="noopener noreferrer">shop ↗</a><a href="${L[2].href}" target="_blank" rel="noopener noreferrer">pinterest ↗</a><button type="button" class="savep" data-pick="${i}" aria-pressed="${saved}">${saved ? "saved ✓" : "save"}</button></div></article>`;
}
function renderExplore() {
  const el = $("#explore-out"); if (!el) return;
  const styles = (profile.styles || []).map(x => x.toLowerCase());
  const has = taste.n > 0 || styles.length;
  const likes = [...topKeys(taste.cat, 2).map(x => x.toLowerCase()), ...topKeys(taste.col, 2), ...topKeys(taste.mat, 1), ...styles.slice(0, 2)];
  const ai = aiPicks && Array.isArray(aiPicks.items) ? aiPicks.items : [];
  currentPicks = [...ai, ...rankCatalog()].filter((p, i, a) => a.findIndex(q => q.name === p.name) === i).slice(0, 12);
  const looks = rankLooks().slice(0, 8);
  el.innerHTML = `<div class="taste"><div>${has ? `<span class="label">your taste so far</span><div class="taste-chips">${likes.map(x => `<span>${esc(x)}</span>`).join("")}</div>` : `<p class="hint">scan, search or save a few pieces and this page learns your taste. for now, here are our editors’ picks.</p>`}</div>
    <div class="taste-actions">${cap.sample ? `<button class="btn solid" type="button" id="ai-refresh" ${aiBusy ? "disabled" : ""}>${aiBusy ? "styling your picks…" : (ai.length ? "refresh my picks" : "personalise with ai")}</button>` : ""}<a class="btn" href="#scan">scan a look</a></div></div>
    <h2 class="ex-title">picked for you</h2>
    <div class="picks">${currentPicks.map(pickCard).join("")}</div>
    ${looks.length ? `<h2 class="ex-title">looks like your style</h2><div class="grid">${looks.map(l => l.demo ? demoCardHTML(l) : cardHTML(l)).join("")}</div>` : ""}`;
}
async function refreshAI() {
  if (!cap.sample || aiBusy) return;
  aiBusy = true; renderExplore();
  const ctx = { categories: topKeys(taste.cat, 4), colours: topKeys(taste.col, 4), materials: topKeys(taste.mat, 3), styles: profile.styles || [], budget: profile.budget || "", saved: savedPieces.slice(0, 15).map(p => p.name), recentlyScanned: history.slice(0, 5).flatMap(h => (h.pieces || []).map(p => p.name)).slice(0, 12) };
  const prompt = `You are a personal stylist building a "for you" page for a fashion and beauty app.
Based on this person's taste signals, suggest 8 specific pieces they would love next. Mix categories, complement what they already saved without repeating it, and keep everything wearable.
Taste signals (JSON): ${JSON.stringify(ctx)}
Return ONLY JSON, no prose: {"picks":[{"name":string,"category":string,"colour":string,"material":string,"why":string,"query":string}]}
- name: a specific shoppable description in lowercase, no brand names.
- category: exactly one of ${CATS.slice(1).join(", ")}.
- colour: one simple colour word.
- why: under 9 words, lowercase, starting with "because" or "goes with".
- query: a Google Shopping search, at most 8 words.`;
  try {
    const r = await cap.sample(prompt, { modelTier: "default" });
    const t = r.text || ""; const v = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    const items = (Array.isArray(v.picks) ? v.picks : []).slice(0, 8).map(p => ({ name: String(p.name || "").slice(0, 80), category: CATS.includes(p.category) ? p.category : "Accessories", colour: String(p.colour || "").slice(0, 30), material: String(p.material || "").slice(0, 30), why: String(p.why || "").slice(0, 70), query: String(p.query || p.name || "").slice(0, 90), ai: true })).filter(p => p.name);
    if (items.length) { aiPicks = { at: Date.now(), items }; store.set("spotted-picks", aiPicks); if (signedIn()) putDoc("picks", aiPicks); toast("your picks are ready"); }
  } catch (e) {
    toast(e && e.code === "rate_limited" ? "too many requests. try again in a minute." : e && e.code === "not_granted" ? "ai access was declined for this page." : "couldn’t refresh your picks right now.");
  }
  aiBusy = false; renderExplore();
}
$("#explore-out").addEventListener("click", e => {
  if (e.target.id === "ai-refresh") { refreshAI(); return; }
  const sp = e.target.closest("[data-pick]");
  if (sp) { const p = currentPicks[+sp.dataset.pick]; if (p) openPicker({ key: "pick|" + p.name, name: p.name, brand: "", category: p.category, colour: p.colour, material: p.material, query: p.query || p.name, look: "for you" }, () => renderExplore()); return; }
  const o = e.target.closest("[data-open]"); if (o) openLook(feed.find(l => l.id === o.dataset.open), o);
});

/* ---------- Demo looks & boards (pieces identified in advance, no photos) ---------- */
const P = (name, category, colour, material, brand, brandConfidence, query) => ({ name, category, colour, material: material || "", brand: brand || null, brandConfidence: brand ? (brandConfidence || "medium") : null, query: query || ((brand ? brand.toLowerCase() + " " : "") + name) });
const DEMO = [
  { id: "demo-croc", title: "croc & leopard", summary: "burgundy croc leather over black tailoring, gold jewellery and a leopard scarf.", pieces: [
    P("burgundy croc-embossed leather jacket", "Outerwear", "burgundy", "leather"),
    P("black wide-leg pleated trousers", "Bottoms", "black", "wool"),
    P("black leather flap shoulder bag", "Bags", "black", "leather", "Chanel", "high"),
    P("black quilted cap-toe ballet flats with bow", "Shoes", "black", "leather", "Chanel", "high"),
    P("tortoiseshell aviator sunglasses, green lenses", "Eyewear", "brown", "", "Gucci", "medium"),
    P("chunky gold hoop earrings", "Jewellery", "gold", ""),
    P("leopard print silk scarf", "Accessories", "leopard", "silk"),
    P("gold spiked bangle bracelet", "Jewellery", "gold", "") ] },
  { id: "demo-suede", title: "suede season", summary: "tan suede jacket and knee boots with black basics and a beaded evening bag.", pieces: [
    P("tan suede cropped button jacket", "Outerwear", "tan", "suede"),
    P("black short-sleeve mock-neck top", "Tops", "black", "knit"),
    P("black flared trousers", "Bottoms", "black", ""),
    P("tan suede knee-high boots with stacked heel", "Shoes", "tan", "suede"),
    P("black beaded satin shoulder bag", "Bags", "black", "satin", "Miu Miu", "medium"),
    P("brown oval sunglasses", "Eyewear", "brown", ""),
    P("vintage gold watch with brown strap", "Accessories", "gold", "") ] },
  { id: "demo-blue", title: "blue & brown", summary: "a blue zip knit with chocolate cords, a suede bag and retro sneakers.", pieces: [
    P("blue ribbed zip-up knit cardigan", "Knitwear", "blue", "wool"),
    P("white ribbed tank top", "Tops", "white", "cotton"),
    P("chocolate corduroy straight-leg trousers", "Bottoms", "brown", "corduroy"),
    P("chocolate suede top-handle bag with belt", "Bags", "brown", "suede"),
    P("tortoiseshell cat-eye sunglasses", "Eyewear", "brown", ""),
    P("blue clover station bracelet", "Jewellery", "blue", ""),
    P("blue suede retro sneakers with cream stripes", "Shoes", "blue", "suede", "adidas", "high") ] },
  { id: "demo-coffee", title: "coffee run", summary: "black tee, white wide jeans, a woven tote and suede clogs.", pieces: [
    P("black long-sleeve fitted tee", "Tops", "black", "cotton"),
    P("white wide-leg jeans", "Bottoms", "white", "denim"),
    P("grey knit sweater worn over the shoulders", "Knitwear", "grey", "wool"),
    P("dark brown woven leather tote", "Bags", "brown", "leather"),
    P("taupe suede clogs", "Shoes", "taupe", "suede"),
    P("brown oval sunglasses", "Eyewear", "brown", ""),
    P("tortoiseshell claw clip", "Hair", "brown", ""),
    P("solitaire pendant necklace", "Jewellery", "silver", "") ] },
  { id: "demo-bandana", title: "bandana knit", summary: "a chunky black knit with a paisley bandana, white denim and woven flats.", pieces: [
    P("black chunky knit crewneck sweater", "Knitwear", "black", "wool"),
    P("olive paisley bandana scarf", "Accessories", "olive", "cotton"),
    P("white crew-neck t-shirt", "Tops", "white", "cotton"),
    P("white wide-leg jeans", "Bottoms", "white", "denim"),
    P("dark brown woven leather tote", "Bags", "brown", "leather"),
    P("black woven leather ballet flats", "Shoes", "black", "leather", "Bernardo", "medium"),
    P("tortoiseshell oval glasses", "Eyewear", "brown", ""),
    P("gold oval clip-on earrings", "Jewellery", "gold", "") ] },
  { id: "demo-check", title: "check trench", summary: "a checked trench over a white tee and jeans, loafers and a black bucket bag.", pieces: [
    P("plaid check trench coat", "Outerwear", "beige", "cotton", "The Row", "medium"),
    P("white fitted t-shirt", "Tops", "white", "cotton"),
    P("white wide-leg jeans", "Bottoms", "white", "denim"),
    P("black leather bucket shoulder bag", "Bags", "black", "leather"),
    P("black leather penny loafers", "Shoes", "black", "leather"),
    P("tortoiseshell rectangular glasses", "Eyewear", "brown", "", "Saint Laurent", "low"),
    P("gold rectangular watch with black strap", "Accessories", "gold", ""),
    P("black leather belt with gold buckle", "Accessories", "black", "leather") ] },
  { id: "demo-travel", title: "travel day", summary: "a black belted trench, grey wool trousers, suede loafers and a woven hobo.", pieces: [
    P("black belted trench coat", "Outerwear", "black", "cotton"),
    P("white fitted t-shirt", "Tops", "white", "cotton"),
    P("grey wool wide-leg trousers", "Bottoms", "grey", "wool"),
    P("chocolate woven suede hobo bag", "Bags", "brown", "suede"),
    P("chocolate suede penny loafers", "Shoes", "brown", "suede"),
    P("tortoiseshell oval glasses", "Eyewear", "brown", "") ] },
];
DEMO.forEach(l => { l.demo = true; });
const isWeb = () => typeof WEB !== "undefined" && WEB;
function demoCollage(l) { return `<span class="collage">${l.pieces.slice(0, 4).map(tileHTML).join("")}</span>`; }
function demoCardHTML(l) {
  return `<article class="card"><button type="button" data-demo="${esc(l.id)}" aria-label="Open demo look: ${esc(l.title)}, ${l.pieces.length} pieces identified"><span class="ph">${demoCollage(l)}<span class="over">${l.pieces.length} pieces identified</span></span><span class="cap"><b>${esc(l.title)}</b><span>demo · ${esc([...new Set(l.pieces.map(p => p.category))].slice(0, 3).join(" · "))}</span></span></button></article>`;
}
function demoFeedHTML() {
  return `<p class="demo-note"><span class="label">demo looks</span><span>${isWeb() ? "these looks show how spotted works. scanning your own photos runs in the spotted app." : "the feed is empty, so here are demo looks. scan and post your own to fill it."}</span></p><div class="grid">${DEMO.map(demoCardHTML).join("")}</div>`;
}
const demoLoaded = () => DEMO.every(l => boards.some(b => b.id === "bd-" + l.id));
function loadDemoBoards() {
  DEMO.slice().reverse().forEach(l => {
    const keys = l.pieces.map((p, i) => {
      const key = `${l.id}|${i}`;
      savePiece({ key, name: p.name, brand: p.brand || "", category: p.category, colour: p.colour, material: p.material, query: p.query, look: l.title });
      return key;
    });
    if (!boards.some(b => b.id === "bd-" + l.id)) boards.unshift({ id: "bd-" + l.id, name: l.title, keys, createdAt: Date.now(), demo: true });
  });
  persistBoards(); setSavedCount(); toast("7 demo boards added");
}
document.addEventListener("click", e => {
  if (e.target.id === "load-demo") { loadDemoBoards(); renderBoards(); return; }
  const d = e.target.closest("[data-demo]");
  if (d) openLook(DEMO.find(l => l.id === d.dataset.demo), d);
});

/* ---------- Scan history ---------- */
async function makeThumb(url) {
  const img = new Image(); img.src = url; await img.decode();
  const k = Math.min(1, 360 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", .62);
}
async function addHistory(look) {
  try {
    const thumb = await makeThumb(look.img);
    history.unshift({ id: look.id, title: look.title || "Untitled look", summary: look.summary, pieces: look.pieces, img: thumb, at: Date.now() });
    history = history.slice(0, 20);
    putDoc("history", { items: history });
  } catch (e) {}
}

/* ---------- Account view ---------- */
const STYLES = ["Minimal", "Classic", "Streetwear", "Romantic", "Grunge", "Old money", "Y2K", "Boho", "Sporty", "Edgy"];
const BUDGETS = [["", "No preference"], ["under €50", "Under €50"], ["under €100", "Under €100"], ["under €250", "Under €250"], ["luxury", "Luxury"]];
let confirmClear = false;
function renderAccount() {
  const el = $("#account-out");
  if (!me.loaded) { el.innerHTML = `<p class="hint">Checking your sign-in…</p>`; return; }
  if (WEB) {
    el.innerHTML = `<div class="card-box" style="max-width:640px"><span class="label">Account</span><h2>sign in with google in the app</h2><p>accounts, scan history and your style profile live in the spotted app, where you sign in with your google account through claude.ai. on this site, your boards and saved pieces stay in this browser.</p><div style="display:flex;flex-wrap:wrap;gap:10px"><a class="btn solid" href="${LIVE_APP}" target="_blank" rel="noopener noreferrer">open the app ↗</a><a class="btn" href="#saved">your boards</a></div></div>`;
    return;
  }
  if (!cap.user || !me.id) {
    el.innerHTML = `<div class="card-box" style="max-width:640px"><span class="label">Sign in</span><h2>sign in with google</h2>
      <p>spotted signs you in through claude.ai, where you can use your google account, so there is no new password to remember. your spotted account is created automatically the first time you come back signed in.</p>
      <ol class="hint" style="padding-left:18px;display:grid;gap:8px;margin:0 0 22px"><li>Click <strong>continue with google</strong> below. claude.ai opens in a new tab.</li><li>Choose <strong>Continue with Google</strong> and pick your google account. New here? That creates your free account in seconds.</li><li>Come back to this tab and refresh: your sizes, saved pieces and scan history appear here.</li></ol>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><a class="btn solid" href="https://claude.ai/login" target="_blank" rel="noopener noreferrer">continue with google ↗</a><button class="btn" type="button" onclick="location.reload()">i’ve signed in, refresh</button></div>
      <p class="hint" style="margin-top:16px">sign-in is handled by claude.ai. spotted never sees your google password.</p></div>`;
    return;
  }
  if (!cap.db) { el.innerHTML = `<div class="card-box"><h2>Account storage is unavailable</h2><p>You are signed in, but your account data can’t be reached in this view. Reload the page to try again.</p></div>`; return; }
  const pr = profile;
  el.innerHTML = `<div class="acct-grid">
    <div class="card-box">
      <div class="who"><span class="ini" aria-hidden="true">${esc(initials(me.name))}</span><div><b>${esc(me.name || "Signed in")}</b><span>signed in with your google / claude.ai account</span></div></div>
      <form class="form" id="profile-form">
        <span class="label">Style profile</span>
        <div class="field"><label>Sizes</label><div class="three">
          <label>Tops<input id="sz-tops" type="text" maxlength="12" placeholder="S / 36" value="${esc(pr.sizes.tops)}"></label>
          <label>Bottoms<input id="sz-bottoms" type="text" maxlength="12" placeholder="27 / 38" value="${esc(pr.sizes.bottoms)}"></label>
          <label>Shoes<input id="sz-shoes" type="text" maxlength="12" placeholder="EU 38" value="${esc(pr.sizes.shoes)}"></label></div></div>
        <div class="field"><label for="budget">Usual budget per piece</label><select id="budget">${BUDGETS.map(([v, l]) => `<option value="${esc(v)}" ${pr.budget === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <label class="check"><input id="budget-search" type="checkbox" ${pr.budgetInSearch ? "checked" : ""}><span>Add my budget to shop searches, so results lean towards my price range</span></label>
        <div class="field"><label for="shops">Favourite shops</label><input id="shops" type="text" maxlength="160" placeholder="Zara, COS, Net-a-Porter" value="${esc(pr.shops)}"><p class="hint">Separate with commas. Each one becomes its own search button on every piece.</p></div>
        <fieldset class="field"><legend>Your style</legend><div class="tags">${STYLES.map((st, i) => `<label><input type="checkbox" name="style" value="${esc(st)}" ${pr.styles.includes(st) ? "checked" : ""}><span>${st}</span></label>`).join("")}</div></fieldset>
        <div><button class="btn solid" type="submit" id="profile-save">Save profile</button></div>
      </form>
    </div>
    <div>
      <div class="card-box">
        <span class="label">${history.length} recent ${history.length === 1 ? "scan" : "scans"}</span><h2>Scan history</h2>
        ${history.length ? `<p>Every look you scan while signed in is kept here, private to you.</p><div class="history">${history.map((h, i) => `<button type="button" data-hist="${i}"><img src="${esc(h.img)}" alt="${esc(h.summary || h.title)}"><b>${esc(h.title)}</b><span>${h.pieces.length} pieces · ${new Date(h.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span></button>`).join("")}</div>` : `<p>No scans yet. Looks you scan while signed in are kept here.</p><a class="btn" href="#scan">Scan a look</a>`}
      </div>
      <div class="card-box" style="margin-top:24px">
        <span class="label">${savedPieces.length} saved</span><h2>Saved pieces</h2>
        <p>${savedPieces.length ? "Your saved pieces follow your account on any device." : "Pieces you save from a look appear here."}</p>
        <a class="btn" href="#saved">View saved pieces</a>
        <div class="danger"><p>Delete your profile, saved pieces and scan history from SPOTTED. Looks you posted to Discover stay public.</p>
          <button class="btn warn small" type="button" id="clear-data">${confirmClear ? "Yes, delete everything" : "Delete my SPOTTED data"}</button>${confirmClear ? `<button class="btn small" type="button" id="clear-cancel">Cancel</button>` : ""}</div>
      </div>
    </div>
  </div>`;
}
$("#account-out").addEventListener("submit", e => {
  if (e.target.id !== "profile-form") return;
  e.preventDefault();
  profile = {
    sizes: { tops: $("#sz-tops").value.trim(), bottoms: $("#sz-bottoms").value.trim(), shoes: $("#sz-shoes").value.trim() },
    budget: $("#budget").value, budgetInSearch: $("#budget-search").checked, shops: $("#shops").value.trim(),
    styles: [...document.querySelectorAll('#profile-form input[name="style"]:checked')].map(x => x.value),
  };
  putDoc("profile", profile).then(() => toast("Profile saved"));
});
$("#account-out").addEventListener("click", async e => {
  const h = e.target.closest("[data-hist]");
  if (h) { const it = history[+h.dataset.hist]; if (it) openLook({ id: it.id, img: it.img, title: it.title, summary: it.summary, pieces: it.pieces }, h); return; }
  if (e.target.id === "clear-cancel") { confirmClear = false; renderAccount(); return; }
  if (e.target.id === "clear-data") {
    if (!confirmClear) { confirmClear = true; renderAccount(); return; }
    confirmClear = false;
    try { await Promise.all(["profile", "saved", "history", "boards", "taste", "picks"].map(k => userDoc(k).delete().catch(() => {}))); } catch (err) {}
    profile = JSON.parse(JSON.stringify(EMPTY_PROFILE)); history = []; savedPieces.splice(0); store.set("spotted-saved", savedPieces); setSavedCount();
    boards = []; store.set("spotted-boards", boards); Object.assign(taste, { cat: {}, col: {}, mat: {}, n: 0 }); store.set("spotted-taste", taste); aiPicks = null; store.set("spotted-picks", null);
    renderAccount(); toast("Your SPOTTED data was deleted");
  }
});

/* ---------- Hero video: always loops, recovers from any pause ---------- */
const header = $("header.top"), hero = $("#hero"), video = $("#hero-video"), vt = $("#vid-toggle");
const ICON_PAUSE = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" fill="currentColor"/><rect x="8.5" y="1" width="3.5" height="12" fill="currentColor"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1l10 6-10 6z" fill="currentColor"/></svg>';
let userPaused = reduce(), heroVisible = true;
video.muted = true; video.defaultMuted = true; video.loop = true;
const shouldPlay = () => !userPaused && !document.hidden && heroVisible && !$("#view-discover").hidden;
function setIcon() { vt.innerHTML = userPaused ? ICON_PLAY : ICON_PAUSE; vt.setAttribute("aria-label", userPaused ? "Play the background video" : "Pause the background video"); }
function kick() {
  if (shouldPlay()) { if (video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); } }
  else if (!video.paused) video.pause();
}
video.addEventListener("ended", () => { video.currentTime = 0; kick(); });
video.addEventListener("pause", () => setTimeout(kick, 120));
["stalled", "waiting", "suspend", "emptied", "canplay", "loadeddata"].forEach(ev => video.addEventListener(ev, () => setTimeout(kick, 200)));
video.addEventListener("timeupdate", () => { if (video.duration && video.currentTime > video.duration - 0.3) video.currentTime = 0.02; });
document.addEventListener("visibilitychange", kick);
if ("IntersectionObserver" in window) new IntersectionObserver(es => { heroVisible = es[0].isIntersecting; kick(); }).observe(hero);
setInterval(kick, 1500);
vt.addEventListener("click", () => { userPaused = !userPaused; setIcon(); kick(); });
setIcon(); kick();

/* transparent header over the video */
function measure() { document.documentElement.style.setProperty("--hh", header.offsetHeight + "px"); }
function heroMode() {
  const on = !$("#view-discover").hidden && hero.getBoundingClientRect().bottom > header.offsetHeight + 8;
  document.body.classList.toggle("hero-mode", on);
}
window.addEventListener("scroll", heroMode, { passive: true });
window.addEventListener("resize", () => { measure(); heroMode(); });
if ("ResizeObserver" in window) new ResizeObserver(() => { measure(); heroMode(); }).observe(header);
$("#to-feed").addEventListener("click", () => $("#feed-start").scrollIntoView({ behavior: reduce() ? "auto" : "smooth" }));

/* ---------- Routing ---------- */
const VIEWS = ["discover", "explore", "scan", "saved", "account", "about"];
function route() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "discover";
  VIEWS.forEach(x => $("#view-" + x).hidden = x !== v);
  document.querySelectorAll("[data-nav]").forEach(a => a.dataset.nav === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  if (v === "saved") { openBoard = null; confirmDel = false; renderSaved(); }
  if (v === "explore") renderExplore();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
window.addEventListener("hashchange", () => { heroMode(); kick(); });

setSavedCount(); route(); measure(); heroMode(); mergeFeed([]); loadShared(); loadAccount();
})();
