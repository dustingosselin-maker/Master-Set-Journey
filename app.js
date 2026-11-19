// ========== STATE ==========
const STORAGE_KEY = "pokevault_v1";
let state = {
  collection: [],
  wishlist: [],
  sealed: [],
  theme: "dark",
  page: "dashboard"
};

const API = "https://api.pokemontcg.io/v2";
const PAGE_SIZE = 40; // 10 columns x 4 rows

let cat = {
  query: "",
  page: 1,
  cards: [],
  totalCount: 0,
  loading: false,
  error: null
};

let openSet = null;
let setCards = [];
let setCardsPage = 1;
let setCardsHasMore = true;
let setCardsLoading = false;
let setSort = "number";

let currentBinder = null;
let selectedIds = new Set();

// ========== PERSISTENCE ==========
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", state.theme || "dark");
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ========== UI HELPERS ==========
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2800);
}

function openModal(title, html) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = html;
  document.getElementById("modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ========== PRICE HELPERS ==========
function extractPrices(card) {
  const prices = [];

  if (card?.tcgplayer?.prices) {
    const p = card.tcgplayer.prices;
    const variants = [
      ["TCGplayer · Normal Market", p.normal?.market],
      ["TCGplayer · Normal Low", p.normal?.low],
      ["TCGplayer · Normal Mid", p.normal?.mid],
      ["TCGplayer · Normal High", p.normal?.high],
      ["TCGplayer · Holofoil Market", p.holofoil?.market],
      ["TCGplayer · Holofoil Low", p.holofoil?.low],
      ["TCGplayer · Holofoil Mid", p.holofoil?.mid],
      ["TCGplayer · Holofoil High", p.holofoil?.high],
      ["TCGplayer · Reverse Holo Market", p.reverseHolofoil?.market],
      ["TCGplayer · Reverse Holo Low", p.reverseHolofoil?.low],
      ["TCGplayer · Reverse Holo Mid", p.reverseHolofoil?.mid],
      ["TCGplayer · Reverse Holo High", p.reverseHolofoil?.high],
      ["TCGplayer · 1st Ed Market", p["1stEditionHolofoil"]?.market || p["1stEditionNormal"]?.market],
    ];
    variants.forEach(([label, value]) => {
      if (typeof value === "number" && value > 0) {
        prices.push({ source: "TCGplayer", label, value });
      }
    });
  }

  if (card?.cardmarket?.prices) {
    const cm = card.cardmarket.prices;
    const cmVariants = [
      ["Cardmarket · Average Sell", cm.averageSellPrice],
      ["Cardmarket · Low", cm.lowPrice],
      ["Cardmarket · Trend", cm.trendPrice],
      ["Cardmarket · Avg 7 days", cm.avg7],
      ["Cardmarket · Avg 30 days", cm.avg30],
    ];
    cmVariants.forEach(([label, value]) => {
      if (typeof value === "number" && value > 0) {
        prices.push({ source: "Cardmarket", label, value });
      }
    });
  }

  const seen = new Set();
  return prices.filter(p => {
    const key = p.source + p.value.toFixed(2);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getAveragePrice(card) {
  const prices = extractPrices(card);
  if (!prices.length) return 0;
  return prices.reduce((s, p) => s + p.value, 0) / prices.length;
}

function getMarketPrice(card) {
  const prices = extractPrices(card);
  if (!prices.length) return 0;
  const preferred = prices.find(p =>
    p.label.toLowerCase().includes("market") ||
    p.label.toLowerCase().includes("average sell") ||
    p.label.toLowerCase().includes("trend")
  );
  return preferred ? preferred.value : getAveragePrice(card);
}

// ========== API ==========
async function fetchCards({ q = "", page = 1, pageSize = PAGE_SIZE, orderBy = "name" } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), orderBy });
  if (q.trim()) params.set("q", q.trim());
  const res = await fetch(`${API}/cards?${params}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function fetchSets() {
  const res = await fetch(`${API}/sets?pageSize=250&orderBy=-releaseDate`);
  if (!res.ok) throw new Error("Failed to load sets");
  return res.json();
}

// ========== ROUTING ==========
function go(page) {
  state.page = page;
  openSet = null;
  currentBinder = null;
  save();
  render();
}

// ========== RENDER ==========
function render() {
  document.querySelectorAll(".nav-item").forEach(b => {
    b.classList.toggle("active", b.dataset.page === state.page);
  });

  const titles = {
    dashboard: "Dashboard",
    catalogue: "Catalogue",
    collection: "Collection",
    binder: currentBinder ? (currentBinder.type === "all" ? "All Cards" : currentBinder.setName) : "Binder",
    sets: openSet ? openSet.name : "Sets",
    pokedex: "Pokédex",
    wishlist: "Wishlist",
    sealed: "Sealed Products",
    portfolio: "Portfolio"
  };

  document.getElementById("breadcrumb").textContent = (state.page || "").toUpperCase();
  document.getElementById("pageTitle").textContent = titles[state.page] || state.page;

  const content = document.getElementById("content");
  content.innerHTML = "";

  switch (state.page) {
    case "dashboard":  renderDashboard(content); break;
    case "catalogue":  renderCatalogue(content); break;
    case "collection": renderCollection(content); break;
    case "binder":     renderBinder(content); break;
    case "sets":       openSet ? renderSetDetail(content) : renderSets(content); break;
    case "pokedex":    renderPokedex(content); break;
    case "wishlist":   renderWishlist(content); break;
    case "sealed":     renderSealed(content); break;
    case "portfolio":  renderPortfolio(content); break;
  }

  // Keep the TCGplayer link outside #content so async page renders do not remove it.
  let footer = document.getElementById("appFooter");
  if (!footer) {
    footer = document.createElement("footer");
    footer.id = "appFooter";
    content.insertAdjacentElement("afterend", footer);
  }
  footer.innerHTML = `
    <div style="text-align:center;padding:24px 12px;margin-top:28px;border-top:1px solid var(--border);color:var(--muted);font-size:13px">
      <a href="https://www.tcgplayer.com/" target="_blank" rel="noopener noreferrer"
         style="color:var(--accent);font-weight:600;text-decoration:none">
        Visit TCGplayer
      </a>
    </div>
  `;
}

// ========== DASHBOARD ==========
function renderDashboard(el) {
  const totalCards = state.collection.reduce((s, c) => s + (c.qty || 1), 0);
  const unique = new Set(state.collection.map(c => c.cardId)).size;
  const market = state.collection.reduce((s, c) => s + (c.market || 0) * (c.qty || 1), 0);
  const cost = state.collection.reduce((s, c) => s + (c.price || 0) * (c.qty || 1), 0);

  el.innerHTML = `
    <div class="hero">
      <div>
        <small>MASTER SET JOURNEY</small>
        <h2>Your collection,<br>organized.</h2>
        <p>Search the catalogue, track variants & conditions, fill binders, and watch portfolio value.</p>
      </div>
      <div class="hero-ball">◉</div>
    </div>
    <div class="stats">
      <div class="stat"><small>TOTAL CARDS</small><strong>${totalCards}</strong></div>
      <div class="stat"><small>UNIQUE</small><strong>${unique}</strong></div>
      <div class="stat"><small>EST. MARKET</small><strong>$${market.toFixed(0)}</strong></div>
      <div class="stat"><small>COST BASIS</small><strong>$${cost.toFixed(0)}</strong></div>
    </div>
    <div class="toolbar">
      <button class="primary" onclick="go('catalogue')">Search Catalogue</button>
      <button class="secondary" onclick="go('collection')">View Collection</button>
      <button class="secondary" onclick="go('binder')">Open Binders</button>
    </div>
  `;
}function cardTile(c, owned) {
  const avg = getAveragePrice(c);
  return `
    <div class="card ${owned ? "owned" : ""}" data-card-id="${c.id}" style="cursor:pointer">
      <img src="${c.images?.small || ""}" alt="${escapeHtml(c.name)}" loading="lazy"
           onerror="this.src='https://via.placeholder.com/150x210?text=No+Image'" />
      <strong title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</strong>
      <small>${escapeHtml(c.set?.name || "")} · #${escapeHtml(c.number)}</small>
      <small>${escapeHtml(c.rarity || "")}</small>
      <div style="margin:6px 0 2px;font-weight:600;color:var(--accent);font-size:14px">
        ${avg > 0 ? "$" + avg.toFixed(2) + " avg" : "—"}
      </div>
      <div class="card-actions">
        <button data-action="add" data-id="${c.id}">+ Collect</button>
        <button data-action="wish" data-id="${c.id}">♡</button>
      </div>
    </div>
  `;
}

// ========== CARD DETAIL ==========
function showCardDetail(card) {
  const prices = extractPrices(card);
  const avg = getAveragePrice(card);

  let priceHtml = prices.length === 0
    ? `<p style="color:var(--muted)">No free price data available.</p>`
    : Object.entries(prices.reduce((acc, p) => {
        if (!acc[p.source]) acc[p.source] = [];
        acc[p.source].push(p);
        return acc;
      }, {})).map(([source, list]) => `
        <div style="margin-bottom:14px">
          <strong style="display:block;margin-bottom:6px">${escapeHtml(source)}</strong>
          ${list.map(p => `
            <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">
              <span style="color:var(--muted);font-size:13px">${escapeHtml(p.label.replace(source + " · ", ""))}</span>
              <span style="font-weight:600">$${p.value.toFixed(2)}</span>
            </div>
          `).join("")}
        </div>
      `).join("");

  openModal(card.name, `
    <div style="text-align:center;margin-bottom:14px">
      <img src="${card.images?.large || card.images?.small || ""}" style="max-width:180px;border-radius:8px" />
    </div>
    <div style="color:var(--muted);font-size:13px;margin-bottom:12px">
      ${escapeHtml(card.set?.name || "")} · #${escapeHtml(card.number)} · ${escapeHtml(card.rarity || "")}
    </div>
    <div style="background:var(--panel2);padding:14px;border-radius:10px;margin-bottom:16px;text-align:center">
      <div style="font-size:12px;color:var(--muted)">AVERAGE PRICE</div>
      <div style="font-size:26px;font-weight:700;color:var(--accent)">${avg > 0 ? "$" + avg.toFixed(2) : "—"}</div>
    </div>
    <h3 style="margin:0 0 10px;font-size:15px">Price Breakdown</h3>
    ${priceHtml}
    <div style="margin-top:18px;display:flex;gap:10px">
      <button class="primary" style="flex:1" data-action="add" data-id="${card.id}">+ Add to Collection</button>
      <button class="secondary" style="flex:1" data-action="wish" data-id="${card.id}">♡ Wishlist</button>
    </div>
  `);
}

// Event delegation
document.addEventListener("click", e => {
  const cardEl = e.target.closest("[data-card-id]");
  if (cardEl && !e.target.closest("[data-action]")) {
    const id = cardEl.dataset.cardId;
    const card = cat.cards.find(c => c.id === id) || setCards.find(c => c.id === id);
    if (card) {
      showCardDetail(card);
      return;
    }
  }

  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const card = cat.cards.find(c => c.id === id) || setCards.find(c => c.id === id);

  if ((action === "add" || action === "add-set") && card) {
    closeModal();
    addToCollection(card);
  }
  if (action === "wish" && card) {
    addToWishlist({ id: card.id, name: card.name, image: card.images?.small, set: card.set?.name });
  }
});

// ========== ADD TO COLLECTION ==========
function addToCollection(card) {
  const market = getMarketPrice(card);
  openModal("Add to Collection", `
    <img src="${card.images?.small || ""}" style="width:90px;display:block;margin:0 auto 12px;border-radius:6px" />
    <strong>${escapeHtml(card.name)}</strong>
    <small style="display:block;color:var(--muted)">${escapeHtml(card.set?.name || "")} #${escapeHtml(card.number)}</small>
    <label class="field">Quantity <input type="number" id="mQty" value="1" min="1" /></label>
    <label class="field">Variant
      <select id="mVariant">
        <option>Normal</option><option>Holofoil</option><option>Reverse Holo</option>
        <option>1st Edition</option><option>Shadowless</option><option>Other</option>
      </select>
    </label>
    <label class="field">Condition
      <select id="mCond">
        <option>Near Mint</option><option>Lightly Played</option><option>Moderately Played</option>
        <option>Heavily Played</option><option>Damaged</option>
      </select>
    </label>
    <label class="field">Graded (optional) <input id="mGraded" placeholder="PSA 10, CGC 9.5..." /></label>
    <label class="field">Purchase Price ($) <input type="number" id="mPrice" step="0.01" placeholder="0.00" /></label>
    <label class="field">Notes <textarea id="mNotes" rows="2"></textarea></label>
    <button class="primary full" id="confirmAdd">Add to Collection</button>
  `);

  document.getElementById("confirmAdd").onclick = () => {
    state.collection.push({
      id: uid(),
      cardId: card.id,
      name: card.name,
      image: card.images?.small,
      set: card.set?.name,
      setId: card.set?.id,
      number: card.number,
      qty: +document.getElementById("mQty").value || 1,
      variant: document.getElementById("mVariant").value,
      condition: document.getElementById("mCond").value,
      graded: document.getElementById("mGraded").value.trim(),
      notes: document.getElementById("mNotes").value.trim(),
      price: +document.getElementById("mPrice").value || 0,
      market: market || 0
    });
    save();
    closeModal();
    toast("Added to collection");
    render();
  };
}

function addToWishlist(item) {
  if (state.wishlist.some(w => w.id === item.id)) {
    toast("Already on wishlist");
    return;
  }
  state.wishlist.push(item);
  save();
  toast("Added to wishlist");
}

// ========== COLLECTION ==========
function renderCollection(el) {
  selectedIds.clear();

  if (!state.collection.length) {
    el.innerHTML = `<div class="empty">No cards yet. Search the Catalogue and add some!</div>`;
    return;
  }

  // Default settings if none are saved yet
  if (!state.collectionSort) state.collectionSort = "set";
  if (!state.collectionView) state.collectionView = "list";

  el.innerHTML = `
    <div class="toolbar" style="flex-wrap:wrap;gap:10px">
      <button class="secondary" id="selectAll">Select All</button>
      <button class="danger" id="bulkDelete" disabled>Delete Selected</button>
      <button class="secondary" id="exportCsv">Export CSV</button>

      <div style="margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <label style="color:var(--muted);font-size:13px">Sort:</label>
        <select id="collSort">
          <option value="set" ${state.collectionSort === "set" ? "selected" : ""}>Set (A → Z)</option>
          <option value="default" ${state.collectionSort === "default" ? "selected" : ""}>Date Added</option>
          <option value="name" ${state.collectionSort === "name" ? "selected" : ""}>Name (A → Z)</option>
          <option value="price-desc" ${state.collectionSort === "price-desc" ? "selected" : ""}>Value: High → Low</option>
          <option value="price-asc" ${state.collectionSort === "price-asc" ? "selected" : ""}>Value: Low → High</option>
        </select>

        <button class="${state.collectionView === "list" ? "primary" : "secondary"}" id="viewListBtn">☰ List</button>
        <button class="${state.collectionView === "grid" ? "primary" : "secondary"}" id="viewGridBtn">⊞ Grid</button>
      </div>
    </div>
    <div id="collList"></div>
  `;

  const list = document.getElementById("collList");

  function getSortedCollection() {
    const items = [...state.collection];

    if (state.collectionSort === "set") {
      items.sort((a, b) => {
        const setCompare = (a.set || "").localeCompare(b.set || "");
        if (setCompare !== 0) return setCompare;
        const na = parseInt(a.number, 10) || 9999;
        const nb = parseInt(b.number, 10) || 9999;
        if (na !== nb) return na - nb;
        return String(a.number || "").localeCompare(String(b.number || ""));
      });
    } else if (state.collectionSort === "name") {
      items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (state.collectionSort === "price-desc") {
      items.sort((a, b) => ((b.market || 0) * (b.qty || 1)) - ((a.market || 0) * (a.qty || 1)));
    } else if (state.collectionSort === "price-asc") {
      items.sort((a, b) => ((a.market || 0) * (a.qty || 1)) - ((b.market || 0) * (b.qty || 1)));
    }

    return items;
  }

  function paintCollection() {
    const items = getSortedCollection();

    // Highlight active view button
    document.getElementById("viewListBtn").className = state.collectionView === "list" ? "primary" : "secondary";
    document.getElementById("viewGridBtn").className = state.collectionView === "grid" ? "primary" : "secondary";

    if (state.collectionView === "grid") {
      // Grid View (matches the Catalogue search area look)
      list.innerHTML = `
        <div class="card-grid card-grid-10x4">
          ${items.map(c => {
            const isSelected = selectedIds.has(c.id);
            return `
              <div class="card ${isSelected ? "selected-card" : ""}">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                  <button class="check" data-id="${c.id}" style="padding:2px 6px;font-size:12px">${isSelected ? "☑" : "☐"}</button>
                  <small style="color:var(--muted)">Qty ${c.qty}</small>
                </div>
                <img src="${c.image || ""}" alt="${escapeHtml(c.name)}" loading="lazy"
                     onerror="this.src='https://via.placeholder.com/150x210?text=No+Image'" />
                <strong title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</strong>
                <small title="${escapeHtml(c.set)} #${escapeHtml(c.number)}">${escapeHtml(c.set)} · #${escapeHtml(c.number)}</small>
                <small>${escapeHtml(c.variant)} · ${escapeHtml(c.condition)}${c.graded ? " · " + escapeHtml(c.graded) : ""}</small>
                <div style="margin:6px 0 2px;font-weight:600;color:var(--accent);font-size:13px">
                  $${((c.market || 0) * c.qty).toFixed(2)}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    } else {
      // List View
      list.innerHTML = items.map(c => {
        const isSelected = selectedIds.has(c.id);
        return `
          <div class="collection-row">
            <button class="check" data-id="${c.id}">${isSelected ? "☑" : "☐"}</button>
            <img src="${c.image || ""}" alt="" />
            <div class="collection-details">
              <strong>${escapeHtml(c.name)}</strong>
              <small>${escapeHtml(c.set)} #${escapeHtml(c.number)} · ${escapeHtml(c.variant)} · ${escapeHtml(c.condition)}${c.graded ? " · " + escapeHtml(c.graded) : ""} · Qty ${c.qty}</small>
            </div>
            <div class="price">
              <div>$${((c.market || 0) * c.qty).toFixed(2)}</div>
              <small>cost $${(c.price * c.qty).toFixed(2)}</small>
            </div>
          </div>
        `;
      }).join("");
    }

    // Re-attach checkbox click listeners
    list.querySelectorAll(".check").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        if (selectedIds.has(id)) {
          selectedIds.delete(id);
        } else {
          selectedIds.add(id);
        }
        document.getElementById("bulkDelete").disabled = selectedIds.size === 0;
        paintCollection();
      };
    });
  }

  // Sort & View toggle events
  document.getElementById("collSort").onchange = e => {
    state.collectionSort = e.target.value;
    save();
    paintCollection();
  };

  document.getElementById("viewListBtn").onclick = () => {
    state.collectionView = "list";
    save();
    paintCollection();
  };

  document.getElementById("viewGridBtn").onclick = () => {
    state.collectionView = "grid";
    save();
    paintCollection();
  };

  // Bulk action events
  document.getElementById("selectAll").onclick = () => {
    state.collection.forEach(c => selectedIds.add(c.id));
    document.getElementById("bulkDelete").disabled = false;
    paintCollection();
  };

  document.getElementById("bulkDelete").onclick = () => {
    if (!confirm(`Delete ${selectedIds.size} items?`)) return;
    state.collection = state.collection.filter(c => !selectedIds.has(c.id));
    save();
    render();
    toast("Deleted");
  };

  document.getElementById("exportCsv").onclick = () => {
    const headers = ["Name","Set","Number","Qty","Variant","Condition","Graded","Notes","Cost","Market"];
    const rows = getSortedCollection().map(c => [c.name, c.set, c.number, c.qty, c.variant, c.condition, c.graded, c.notes, c.price, c.market]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], {type:"text/csv"}));
    a.download = "master-set-journey-collection.csv";
    a.click();
  };

  paintCollection();
}

// ========== BINDER ==========
function renderBinder(el) {
  if (!currentBinder) {
    renderBinderHub(el);
  } else {
    renderBinderPages(el);
  }
}

function renderBinderHub(el) {
  const bySet = {};
  state.collection.forEach(c => {
    const key = c.set || "Unknown Set";
    if (!bySet[key]) bySet[key] = [];
    bySet[key].push(c);
  });
  const setNames = Object.keys(bySet).sort();

  el.innerHTML = `
    <p style="color:var(--muted);margin-bottom:12px">Choose a binder to open</p>
    <div class="binder-hub">
      <div class="binder-cover" data-binder="all">
        <div class="cover-icon">📚</div>
        <strong>All Cards</strong>
                <small>${state.collection.length} cards</small>
      </div>
      ${setNames.map(name => `
        <div class="binder-cover" data-binder="set" data-set="${escapeHtml(name)}">
          <div class="cover-icon">🗂️</div>
          <strong>${escapeHtml(name)}</strong>
          <small>${bySet[name].length} cards</small>
        </div>
      `).join("")}
    </div>
  `;

  el.querySelectorAll(".binder-cover").forEach(cover => {
    cover.onclick = () => {
      currentBinder = cover.dataset.binder === "all"
        ? { type: "all", sort: "number" }
        : { type: "set", setName: cover.dataset.set, sort: "number" };
      render();
    };
  });
}

function renderBinderPages(el) {
  let cards = currentBinder.type === "all"
    ? [...state.collection]
    : state.collection.filter(c => c.set === currentBinder.setName);

  const title = currentBinder.type === "all" ? "All Cards" : currentBinder.setName;

  if (!currentBinder.sort) currentBinder.sort = "number";

  if (currentBinder.sort === "price-desc") {
    cards.sort((a, b) => (b.market || 0) - (a.market || 0));
  } else if (currentBinder.sort === "price-asc") {
    cards.sort((a, b) => (a.market || 0) - (b.market || 0));
  } else {
    cards.sort((a, b) => {
      const na = parseInt(a.number, 10) || 9999;
      const nb = parseInt(b.number, 10) || 9999;
      if (na !== nb) return na - nb;
      return String(a.number).localeCompare(String(b.number));
    });
  }

  const totalPages = Math.max(1, Math.ceil(cards.length / 9));
  let page = 0;

  function draw() {
    const start = page * 9;
    const pageCards = cards.slice(start, start + 9);

    el.innerHTML = `
      <div class="binder-opening">
        <div class="toolbar" style="flex-wrap:wrap;gap:10px">
          <button class="secondary" id="backToHub">← All Binders</button>
          <strong>${escapeHtml(title)}</strong>

          <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
            <label style="color:var(--muted);font-size:13px">Sort:</label>
            <select id="binderSortSelect" style="min-width:150px">
              <option value="number" ${currentBinder.sort === "number" ? "selected" : ""}>Card Number</option>
              <option value="price-desc" ${currentBinder.sort === "price-desc" ? "selected" : ""}>Price: High → Low</option>
              <option value="price-asc" ${currentBinder.sort === "price-asc" ? "selected" : ""}>Price: Low → High</option>
            </select>
          </div>
        </div>

        <div class="binder-page-controls">
          <button class="secondary" id="prevPage" ${page === 0 ? "disabled" : ""}>← Prev</button>
          <span>Page ${page + 1} of ${totalPages}</span>
          <button class="secondary" id="nextPage" ${page >= totalPages - 1 ? "disabled" : ""}>Next →</button>
        </div>

        <div class="binder-grid">
          ${Array.from({ length: 9 }, (_, i) => {
            const c = pageCards[i];
            if (c) {
              return `
                <div class="binder-slot" draggable="true" data-id="${c.id}">
                  <img src="${c.image || ""}" title="${escapeHtml(c.name)}" loading="lazy" />
                </div>`;
            }
            return `<div class="binder-slot empty-slot"></div>`;
          }).join("")}
        </div>
        <p style="text-align:center;color:var(--muted);font-size:13px;margin-top:14px">
          Drag cards to rearrange • Sorting is temporary
        </p>
      </div>
    `;

    document.getElementById("backToHub").onclick = () => {
      currentBinder = null;
      render();
    };
    document.getElementById("prevPage").onclick = () => {
      if (page > 0) { page--; draw(); }
    };
    document.getElementById("nextPage").onclick = () => {
      if (page < totalPages - 1) { page++; draw(); }
    };
    document.getElementById("binderSortSelect").onchange = e => {
      currentBinder.sort = e.target.value;
      renderBinderPages(el);
    };

    let draggedId = null;
    el.querySelectorAll(".binder-slot").forEach(slot => {
      slot.addEventListener("dragstart", e => {
        if (slot.classList.contains("empty-slot")) {
          e.preventDefault();
          return;
        }
        draggedId = slot.dataset.id;
        slot.style.opacity = "0.4";
      });

      slot.addEventListener("dragend", () => {
        slot.style.opacity = "1";
      });

      slot.addEventListener("dragover", e => {
        e.preventDefault();
        slot.style.borderColor = "var(--accent)";
      });

      slot.addEventListener("dragleave", () => {
        slot.style.borderColor = "";
      });

      slot.addEventListener("drop", e => {
        e.preventDefault();
        slot.style.borderColor = "";
        const targetId = slot.dataset.id;
        if (!draggedId || !targetId || draggedId === targetId) return;

        const fromIdx = state.collection.findIndex(c => c.id === draggedId);
        const toIdx = state.collection.findIndex(c => c.id === targetId);
        if (fromIdx === -1 || toIdx === -1) return;

        [state.collection[fromIdx], state.collection[toIdx]] = [state.collection[toIdx], state.collection[fromIdx]];
        save();
        renderBinderPages(el);
        toast("Card moved");
      });
    });
  }

  draw();
}

// ========== SETS ==========
async function renderSets(el) {
  el.innerHTML = `<div class="loading">Loading sets…</div>`;
  try {
    const data = await fetchSets();
    const ownedBySet = {};
    state.collection.forEach(c => {
      const key = c.setId || c.set || "Unknown";
      ownedBySet[key] = (ownedBySet[key] || 0) + 1;
    });

    el.innerHTML = `
      <div class="set-grid">
        ${(data.data || []).map(s => {
          const owned = ownedBySet[s.id] || ownedBySet[s.name] || 0;
          const total = s.printedTotal || s.total || 1;
          const pct = Math.min(100, Math.round((owned / total) * 100));
          return `
            <div class="set-card" data-set-id="${s.id}">
              <img src="${s.images?.logo || s.images?.symbol || ""}" alt="" />
              <strong>${escapeHtml(s.name)}</strong>
              <small>${escapeHtml(s.series || "")} · ${s.releaseDate || ""}</small>
              <div class="progress"><div style="width:${pct}%"></div></div>
              <small>${owned} / ${total} · ${pct}%</small>
            </div>
          `;
        }).join("")}
      </div>
    `;

    el.querySelectorAll(".set-card").forEach(card => {
      card.onclick = () => {
        const set = (data.data || []).find(s => s.id === card.dataset.setId);
        if (set) {
          openSet = set;
          setCards = [];
          setCardsPage = 1;
          setCardsHasMore = true;
          setSort = "number";
          render();
        }
      };
    });
  } catch (e) {
    el.innerHTML = `<div class="empty">Could not load sets</div>`;
  }
}

async function renderSetDetail(el) {
  const set = openSet;
  if (!set) return;

  el.innerHTML = `
    <div class="set-header">
      <div>
        <button class="secondary back-btn" id="backToSets">← Back to Sets</button>
        ${set.images?.logo ? `<img class="logo" src="${set.images.logo}" alt="" />` : ""}
      </div>
      <div class="meta">
        <h2 style="margin:0 0 6px">${escapeHtml(set.name)}</h2>
        <small style="color:var(--muted)" id="setMetaCount">${escapeHtml(set.series || "")} · Loading cards…</small>
      </div>
    </div>
    <div class="toolbar" style="flex-wrap:wrap;gap:10px">
      <label style="color:var(--muted);font-size:13px">Sort by:</label>
      <select id="setSortSelect">
        <option value="number" ${setSort === "number" ? "selected" : ""}>Card Number</option>
        <option value="price-desc" ${setSort === "price-desc" ? "selected" : ""}>Price: High → Low</option>
        <option value="price-asc" ${setSort === "price-asc" ? "selected" : ""}>Price: Low → High</option>
      </select>

      <select id="setFilterSelect">
        <option value="all">Show: All Cards</option>
        <option value="missing">Show: Missing Only</option>
        <option value="owned">Show: Owned Only</option>
      </select>
      <button class="secondary" id="refreshSetCards" type="button">↻ Refresh Cards</button>
    </div>
    <div id="setCardGrid" class="checklist-grid"></div>
  `;

  document.getElementById("backToSets").onclick = () => { openSet = null; render(); };

  const grid = document.getElementById("setCardGrid");
  const metaCount = document.getElementById("setMetaCount");
  let setFilter = "all";

  document.getElementById("setSortSelect").onchange = e => {
    setSort = e.target.value;
    paintSetCards();
  };

  document.getElementById("setFilterSelect").onchange = e => {
    setFilter = e.target.value;
    paintSetCards();
  };

  // Refresh only the currently selected set's cards; do not reload the page.
  document.getElementById("refreshSetCards").onclick = async () => {
    if (setCardsLoading) return;

    const refreshButton = document.getElementById("refreshSetCards");
    setCardsLoading = true;
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing…";

    try {
      let page = 1;
      let allFetched = [];
      let totalCount = Infinity;

      while (allFetched.length < totalCount) {
        const data = await fetchCards({
          q: `set.id:${set.id}`,
          page,
          pageSize: 250,
          orderBy: "number"
        });

        const batch = data.data || [];
        totalCount = data.totalCount ?? batch.length;
        allFetched = allFetched.concat(batch);

        if (batch.length < 250) break;
        page++;
      }

      setCards = allFetched;
      paintSetCards();
      toast(`Refreshed ${setCards.length} cards`);
    } catch (err) {
      toast(`Could not refresh cards: ${err.message}`);
    } finally {
      setCardsLoading = false;
      const button = document.getElementById("refreshSetCards");
      if (button) {
        button.disabled = false;
        button.textContent = "↻ Refresh Cards";
      }
    }
  };

  function paintSetCards() {
    const ownedSet = new Set(state.collection.map(c => c.cardId));
    let list = [...setCards];

    // Filter by All / Missing / Owned
    if (setFilter === "missing") {
      list = list.filter(c => !ownedSet.has(c.id));
    } else if (setFilter === "owned") {
      list = list.filter(c => ownedSet.has(c.id));
    }

    // Sort cards
    if (setSort === "price-desc") {
      list.sort((a, b) => getAveragePrice(b) - getAveragePrice(a));
    } else if (setSort === "price-asc") {
      list.sort((a, b) => getAveragePrice(a) - getAveragePrice(b));
    } else {
      list.sort((a, b) => {
        const na = parseInt(String(a.number).replace(/\D/g, ""), 10) || 9999;
        const nb = parseInt(String(b.number).replace(/\D/g, ""), 10) || 9999;
        if (na !== nb) return na - nb;
        return String(a.number || "").localeCompare(String(b.number || ""));
      });
    }

    const ownedInSet = setCards.filter(c => ownedSet.has(c.id)).length;
    metaCount.textContent = `${set.series || ""} · ${ownedInSet} / ${setCards.length} cards owned`;

    if (!list.length) {
      grid.innerHTML = `<div class="empty">No cards match this filter.</div>`;
      return;
    }

    grid.innerHTML = list.map(c => {
      const owned = ownedSet.has(c.id);
      const avg = getAveragePrice(c);
      return `
        <div class="card ${owned ? "owned" : ""}" data-card-id="${c.id}" style="cursor:pointer;${owned ? "" : "opacity:0.78"}">
          <img src="${c.images?.small || ""}" alt="${escapeHtml(c.name)}" loading="lazy"
               onerror="this.src='https://via.placeholder.com/150x210?text=No+Image'" />
          <strong title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</strong>
          <small>#${escapeHtml(c.number)} · ${escapeHtml(c.rarity || "")}</small>
          <div style="margin:6px 0 2px;font-weight:600;color:var(--accent);font-size:13px">
            ${avg > 0 ? "$" + avg.toFixed(2) : "—"}
          </div>
          <div class="card-actions">
            <button data-action="add-set" data-id="${c.id}">${owned ? "✓ Owned (+1)" : "+ Collect"}</button>
            <button data-action="wish" data-id="${c.id}">♡</button>
          </div>
        </div>
      `;
    }).join("");
  }

  // Fetch all pages of this set (250 per request is the API maximum)
  if (setCards.length === 0 && !setCardsLoading) {
    setCardsLoading = true;
    grid.innerHTML = `<div class="loading">Loading all cards in ${escapeHtml(set.name)}…</div>`;
    try {
      let page = 1;
      let allFetched = [];
      let totalCount = Infinity;

      while (allFetched.length < totalCount) {
        const data = await fetchCards({
          q: `set.id:${set.id}`,
          page,
          pageSize: 250,
          orderBy: "number"
        });
        const batch = data.data || [];
        totalCount = data.totalCount ?? batch.length;
        allFetched = allFetched.concat(batch);
        if (batch.length < 250) break;
        page++;
      }

      setCards = allFetched;
    } catch (err) {
      grid.innerHTML = `<div class="empty">Could not load cards: ${escapeHtml(err.message)}</div>`;
      setCardsLoading = false;
      return;
    } finally {
      setCardsLoading = false;
    }
  }

  paintSetCards();
}// ========== POKEDEX ==========
function renderPokedex(el) {
  const species = new Set();
  state.collection.forEach(c => {
    const name = (c.name || "").split(" ")[0];
    if (name) species.add(name);
  });
  el.innerHTML = `
    <div class="stats"><div class="stat"><small>SPECIES</small><strong>${species.size}</strong></div></div>
    <div class="dex-grid">
      ${[...species].sort().map(n => `<div class="dex-item owned">${escapeHtml(n)}</div>`).join("") || `<div class="empty">Add cards to start</div>`}
    </div>
  `;
}

// ========== WISHLIST ==========
function renderWishlist(el) {
  if (!state.wishlist.length) {
    el.innerHTML = `<div class="empty">Wishlist is empty</div>`;
    return;
  }
  el.innerHTML = `
    <div class="card-grid">
      ${state.wishlist.map(w => `
        <div class="card">
          <img src="${w.image || ""}" />
          <strong>${escapeHtml(w.name)}</strong>
          <small>${escapeHtml(w.set || "")}</small>
          <div class="card-actions">
            <button class="danger" onclick="removeWishlist('${w.id}')">Remove</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function removeWishlist(id) {
  state.wishlist = state.wishlist.filter(w => w.id !== id);
  save();
  render();
}

// ========== SEALED ==========
function renderSealed(el) {
  el.innerHTML = `
    <div class="toolbar"><button class="primary" id="addSealed">+ Add Sealed Product</button></div>
    <div id="sealedList"></div>
  `;
  function draw() {
    const list = document.getElementById("sealedList");
    if (!state.sealed.length) {
      list.innerHTML = `<div class="empty">No sealed products yet</div>`;
      return;
    }
    list.innerHTML = state.sealed.map(s => `
      <div class="collection-row">
        <div class="collection-details">
          <strong>${escapeHtml(s.name)}</strong>
          <small>Qty ${s.qty} · $${s.price}</small>
        </div>
        <button class="danger" onclick="removeSealed('${s.id}')">Delete</button>
      </div>
    `).join("");
  }
  document.getElementById("addSealed").onclick = () => {
    openModal("Add Sealed Product", `
      <label class="field">Name <input id="sName" /></label>
      <label class="field">Quantity <input type="number" id="sQty" value="1" min="1" /></label>
      <label class="field">Price each ($) <input type="number" id="sPrice" step="0.01" /></label>
      <button class="primary full" id="confirmSealed">Save</button>
    `);
    document.getElementById("confirmSealed").onclick = () => {
      state.sealed.push({
        id: uid(),
        name: document.getElementById("sName").value.trim() || "Sealed",
        qty: +document.getElementById("sQty").value || 1,
        price: +document.getElementById("sPrice").value || 0
      });
      save();
      closeModal();
      draw();
    };
  };
  draw();
}

function removeSealed(id) {
  state.sealed = state.sealed.filter(s => s.id !== id);
  save();
  render();
}

// ========== PORTFOLIO ==========
function renderPortfolio(el) {
  const market = state.collection.reduce((s, c) => s + (c.market || 0) * (c.qty || 1), 0);
  const cost = state.collection.reduce((s, c) => s + (c.price || 0) * (c.qty || 1), 0);
  const sealedValue = state.sealed.reduce((s, p) => s + p.price * p.qty, 0);
  const gain = market - cost;

  el.innerHTML = `
    <div class="stats">
      <div class="stat"><small>COLLECTION MARKET</small><strong>$${market.toFixed(2)}</strong></div>
      <div class="stat"><small>COST BASIS</small><strong>$${cost.toFixed(2)}</strong></div>
      <div class="stat"><small>SEALED VALUE</small><strong>$${sealedValue.toFixed(2)}</strong></div>
      <div class="stat"><small>UNREALIZED P/L</small>
        <strong style="color:${gain >= 0 ? 'var(--success)' : '#f17c83'}">$${gain.toFixed(2)}</strong>
      </div>
    </div>
  `;
}

// ========== EVENTS ==========
document.getElementById("nav").onclick = e => {
  const btn = e.target.closest("[data-page]");
  if (btn) go(btn.dataset.page);
};

document.getElementById("themeToggle").onclick = () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", state.theme);
  save();
};

document.getElementById("closeModal").onclick = closeModal;
document.getElementById("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };

document.getElementById("backupBtn").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
  a.download = `pokevault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  toast("Backup downloaded");
};

document.getElementById("restoreInput").onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      Object.assign(state, JSON.parse(reader.result));
      save();
      document.documentElement.setAttribute("data-theme", state.theme);
      render();
      toast("Backup restored");
    } catch {
      toast("Invalid backup file");
    }
  };
  reader.readAsText(file);
};

// ========== INIT ==========
load();
render();