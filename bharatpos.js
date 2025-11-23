/* ============================================================
  bharatpos.js — Full script for Bharat POS
  Updated: prefix search matching and non-intrusive search results
  plus universal barcode Enter handler and UPC auto-fill integration.
  ============================================================ */

/* -------------------------
   Storage keys & helpers
   ------------------------- */
const LS_KEYS = {
  PRODUCTS: 'bharatpos_products',
  SALES: 'bharatpos_sales',
  SETTINGS: 'bharatpos_settings'
};

function uid(prefix='id'){ return prefix + Date.now() + '-' + Math.floor(Math.random()*90000); }
function formatCurrency(n){ return '₹' + Number(n || 0).toFixed(2); }

function getSettings(){
  const defaults = { theme:'light', adminPw:'admin123', storeName:'BharatPOS', autoAddScanned:false };
  try { return JSON.parse(localStorage.getItem(LS_KEYS.SETTINGS) || JSON.stringify(defaults)); }
  catch(e){ localStorage.setItem(LS_KEYS.SETTINGS, JSON.stringify(defaults)); return defaults; }
}
function saveSettings(s){ localStorage.setItem(LS_KEYS.SETTINGS, JSON.stringify(s)); }

function getProducts(){
  try { return JSON.parse(localStorage.getItem(LS_KEYS.PRODUCTS) || '[]'); }
  catch(e){ localStorage.setItem(LS_KEYS.PRODUCTS, '[]'); return []; }
}
function saveProducts(arr){ localStorage.setItem(LS_KEYS.PRODUCTS, JSON.stringify(arr)); }

function getSales(){
  try { return JSON.parse(localStorage.getItem(LS_KEYS.SALES) || '[]'); }
  catch(e){ localStorage.setItem(LS_KEYS.SALES, '[]'); return []; }
}
function saveSales(arr){ localStorage.setItem(LS_KEYS.SALES, JSON.stringify(arr)); }

/* -------------------------
   Product functions
   ------------------------- */
function addProduct() {
  // Add product form elements expected on products.html:
  const nameEl = document.getElementById('productName');
  const priceEl = document.getElementById('productPrice');
  const stockEl = document.getElementById('productStock');
  const taxEl = document.getElementById('productTax');
  const catEl = document.getElementById('productCategory');
  const barcodeEl = document.getElementById('productBarcode');

  if (!nameEl || !priceEl || !stockEl || !catEl) {
    alert('Product form missing fields');
    return;
  }

  const name = nameEl.value.trim();
  const price = parseFloat(priceEl.value);
  const stock = parseInt(stockEl.value);
  const taxPercent = parseFloat(taxEl?.value) || 0;
  const category = catEl.value.trim() || 'General';
  const barcode = barcodeEl?.value.trim() || '';

  if (!name || isNaN(price) || isNaN(stock)) {
    alert('Enter valid product info');
    return;
  }

  const products = getProducts();
  const existing = products.find(p => p.name.toLowerCase() === name.toLowerCase() || (barcode && p.barcode === barcode));

  if (existing) {
    existing.stock = (existing.stock || 0) + stock;
    existing.price = Number(price);
    existing.taxPercent = Number(taxPercent);
    existing.category = category || existing.category;
    existing.barcode = barcode || existing.barcode;
  } else {
    products.push({
      id: uid('p'),
      name,
      price,
      stock,
      taxPercent,
      category,
      barcode
    });
  }

  saveProducts(products);

  // Clear input fields
  nameEl.value = '';
  priceEl.value = '';
  stockEl.value = '';
  taxEl.value = '';
  catEl.value = '';
  if (barcodeEl) barcodeEl.value = '';

  if (typeof window.renderCategoryFilters === 'function') window.renderCategoryFilters();
  if (typeof window._renderProductGrid === 'function') window._renderProductGrid();

  alert('Product saved');
}

/* existing functions preserved: renderCategoryFilters, filterByCategory, updateProduct, deleteProduct */

/* -------------------------
   Checkout & Sales
   ------------------------- */
function genInvoiceNo(){ return 'INV' + Date.now().toString().slice(-8); }
function todayISO(){ return new Date().toISOString(); }

function checkoutCart(cartItems, customer='Walk-in', paymentMode='cash', discount=0){
  if(!cartItems || !Array.isArray(cartItems) || cartItems.length===0) throw new Error('Cart empty');

  const products = getProducts();
  cartItems.forEach(it=>{
    const p = products.find(x=>x.id===it.id);
    if(p){ p.stock = Math.max(0, (Number(p.stock)||0) - Number(it.qty||0)); }
  });
  saveProducts(products);

  const subtotal = cartItems.reduce((s,it)=> s + (Number(it.price||0) * Number(it.qty||0)), 0);
  const taxSum = cartItems.reduce((s,it)=> s + ((Number(it.price||0) * Number(it.qty||0)) * Number(it.taxPercent||0)/100), 0);
  const total = subtotal + taxSum - Number(discount||0);

  const sale = {
    invoiceNo: genInvoiceNo(),
    date: todayISO(),
    customer,
    items: cartItems.map(it=>({ 
      id: it.id, name: it.name, price: Number(it.price), qty: Number(it.qty), taxPercent: Number(it.taxPercent||0),
      taxAmount: (Number(it.price||0)*Number(it.qty||0)*Number(it.taxPercent||0)/100)
    })),
    subtotal, taxAmount: taxSum, discount: Number(discount||0), total, paymentMode
  };

  const sales = getSales();
  sales.push(sale);
  saveSales(sales);

  return sale;
}

/* -------------------------
   Export / Import
   ------------------------- */
function exportAll(){
  const payload = { settings: getSettings(), products: getProducts(), sales: getSales() };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'BharatPOS_export_'+Date.now()+'.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function importAllFile(file, callback){
  const reader = new FileReader();
  reader.onload = function(e){
    try{
      const obj = JSON.parse(e.target.result);
      if(obj.settings) localStorage.setItem(LS_KEYS.SETTINGS, JSON.stringify(obj.settings));
      if(obj.products) localStorage.setItem(LS_KEYS.PRODUCTS, JSON.stringify(obj.products));
      if(obj.sales) localStorage.setItem(LS_KEYS.SALES, JSON.stringify(obj.sales));
      callback && callback(null,'Imported');
    }catch(err){ callback && callback(err); }
  };
  reader.readAsText(file);
}

/* -------------------------
   Theme
   ------------------------- */
function applyTheme(){
  const s = getSettings();
  if(s.theme==='dark'){
    document.documentElement.style.setProperty('--bg','#0b1220');
    document.documentElement.style.setProperty('--card','#091021');
    document.documentElement.style.setProperty('--accent','#3b82f6');
    document.body.style.color='#cce1faff';
  }else{
    document.documentElement.style.removeProperty('--bg');
    document.documentElement.style.removeProperty('--card');
    document.documentElement.style.removeProperty('--accent');
    document.body.style.color='#111';
  }
}
function toggleTheme(){
  const s = getSettings(); s.theme = s.theme==='dark'?'light':'dark'; saveSettings(s); applyTheme();
}

/* -------------------------
   Init
   ------------------------- */
(function initBharatPOS(){
  if(!localStorage.getItem(LS_KEYS.SETTINGS)) saveSettings(getSettings());
  if(!localStorage.getItem(LS_KEYS.PRODUCTS)) saveProducts([]);
  if(!localStorage.getItem(LS_KEYS.SALES)) saveSales([]);
  applyTheme();
})();

/* -------------------------
   Billing page logic (unchanged core but included)
   ------------------------- */
(function billingEverything(){
  if(!window.location.href.includes('billing.html')) return;

  let billItems = JSON.parse(localStorage.getItem('bill_items') || '[]');
  const syncToStorage = () => localStorage.setItem('bill_items', JSON.stringify(billItems));
  const loadFromStorage = () => { billItems = JSON.parse(localStorage.getItem('bill_items') || '[]'); };

  // ----------------- Add to bill -----------------
  window.addToBill = function(id){
    const products = getProducts();
    const product = products.find(p => p.id === id);
    if(!product) return;

    let item = billItems.find(b => b.id === id);
    if(item){
      if(Number(product.stock||0) && item.qty >= Number(product.stock)){
        alert('Stock limit reached for ' + product.name);
        return;
      }
      item.qty += 1;
    } else {
      billItems.push({
        id: product.id,
        name: product.name,
        price: Number(product.price||0),
        qty: 1,
        taxPercent: Number(product.taxPercent||0)
      });
    }
    syncToStorage();
    renderCart();
  };

  // ----------------- Cart render (same as your original) -----------------
  function renderCart(){
    loadFromStorage();
    const container = document.getElementById('cartList');
    if(!container) return;

    if(!billItems.length){
      container.innerHTML = '<div class="small">Cart empty</div>';
      document.getElementById('grandTotal').innerText='Total: ₹0';
      return;
    }

    let subtotal=0, taxTotal=0;
    let html = '<table style="width:100%"><tr><th>Item</th><th>Qty</th><th>Price</th><th>Tax</th><th>Total</th><th>Action</th></tr>';

    billItems.forEach((it,i)=>{
      const price = Number(it.price||0);
      const qty = Number(it.qty||0);
      const tax = price*qty*(Number(it.taxPercent||0)/100);
      const total = price*qty + tax;
      subtotal += price*qty;
      taxTotal += tax;

      html += `<tr>
        <td>${escapeHTML(it.name)}</td>
        <td>${qty}</td>
        <td>₹${price.toFixed(2)}</td>
        <td>₹${tax.toFixed(2)}</td>
        <td>₹${total.toFixed(2)}</td>
        <td style="min-width:120px">
          <button class="cart-inc" data-index="${i}">+</button>
          <button class="cart-dec" data-index="${i}">-</button>
          <button class="cart-remove" data-index="${i}" style="background:#dc3545;color:#fff">X</button>
        </td>
      </tr>`;
    });

    html += '</table>';
    container.innerHTML = html;

    const discount = Number(document.getElementById('discount')?.value||0);
    const grand = subtotal + taxTotal - discount;
    document.getElementById('grandTotal').innerText=
      `Subtotal: ₹${subtotal.toFixed(2)} | Tax: ₹${taxTotal.toFixed(2)} | Discount: ₹${discount.toFixed(2)} → Grand Total: ₹${grand.toFixed(2)}`;

    // Attach cart button events
    container.querySelectorAll('.cart-inc').forEach(btn=>{
      btn.onclick = ()=>{ const i = Number(btn.dataset.index); if(!billItems[i]) return; billItems[i].qty += 1; syncToStorage(); renderCart(); };
    });
    container.querySelectorAll('.cart-dec').forEach(btn=>{
      btn.onclick = ()=>{ const i = Number(btn.dataset.index); if(!billItems[i]) return; billItems[i].qty -= 1; if(billItems[i].qty <= 0) billItems.splice(i,1); syncToStorage(); renderCart(); };
    });
    container.querySelectorAll('.cart-remove').forEach(btn=>{
      btn.onclick = ()=>{ const i = Number(btn.dataset.index); if(!billItems[i]) return; billItems.splice(i,1); syncToStorage(); renderCart(); };
    });
  }
  window.renderCart = renderCart;

  // ----------------- Product grid (prefix matching) -----------------
  let activeCategory = null;
  let searchQuery = '';

  function renderProductGrid(){
    const productList = document.getElementById('productList');
    if(!productList) return;

    let products = getProducts();
    if(activeCategory) products = products.filter(p=>p.category === activeCategory);
    if(searchQuery) {
      const q = searchQuery.toLowerCase();
      products = products.filter(p => (p.name || '').toLowerCase().startsWith(q));
    }

    if(!products.length){ productList.innerHTML='<div class="small">No products</div>'; return; }

    productList.innerHTML = products.map(p=>{
      const qty = Number(p.stock||0), disabled = qty<=0?'disabled':'';
      return `<button class="prod-btn" ${disabled} data-id="${p.id}">
                <div class="prod-name">${escapeHTML(p.name)}</div>
                <div class="prod-qty">×${qty}</div>
              </button>`;
    }).join('');

    // Attach click handlers
    productList.querySelectorAll('.prod-btn').forEach(btn=>{
      const pid = btn.dataset.id;
      btn.onclick = ()=>window.addToBill(pid);
    });
  }
  window._renderProductGrid = renderProductGrid;

  // ----------------- Category filter -----------------
  window.filterCategory = function(cat){
    activeCategory = cat==='All'?null:cat;
    renderProductGrid();
  };

  // ----------------- Search results (non-intrusive) -----------------
  function debounce(fn, wait){
    let t;
    return function(...args){
      clearTimeout(t);
      t = setTimeout(()=>fn.apply(this,args), wait);
    };
  }

  function renderSearchResults(query){
    const resultsBox = document.getElementById('searchResults');
    if(!resultsBox) return;
    const q = (query || '').trim().toLowerCase();
    if(!q){
      resultsBox.innerHTML = '';
      resultsBox.style.display = 'none';
      return;
    }

    const products = getProducts();
    const matches = products.filter(p => {
      const name = (p.name || '').toLowerCase();
      const barcode = String(p.barcode || '').toLowerCase();
      return name.startsWith(q) || barcode.startsWith(q);
    }).slice(0, 8);

    if(!matches.length){
      resultsBox.innerHTML = `<div class="small" style="padding:8px">No matches</div>`;
      resultsBox.style.display = 'block';
      return;
    }

    const html = matches.map(p=>{
      const price = Number(p.price||0);
      const stock = Number(p.stock||0);
      const tax = Number(p.taxPercent||0);
      return `<div class="search-result">
        <div class="info">
          <div class="title">${escapeHTML(p.name || 'Unnamed')}</div>
          <div class="meta">Price: ₹${price.toFixed(2)} • Stock: ${stock} • Tax: ${tax}%</div>
        </div>
        <div>
          <button class="search-add-btn" data-id="${p.id}">Add</button>
        </div>
      </div>`;
    }).join('');

    resultsBox.innerHTML = html;
    resultsBox.style.display = 'block';

    resultsBox.querySelectorAll('.search-add-btn').forEach(btn=>{
      btn.onclick = ()=>{
        const id = btn.dataset.id;
        if(!id) return;
        if (typeof window.addToBill === 'function') {
          window.addToBill(id);
          btn.textContent = 'Added';
          btn.disabled = true;
          setTimeout(()=>{ btn.textContent = 'Add'; btn.disabled = false; }, 600);
        }
      };
    });
  }

  const debouncedRenderSearchResults = debounce(renderSearchResults, 160);

  const searchInput = document.getElementById('productSearch');
  if(searchInput){
    searchInput.addEventListener('input', ()=>{
      searchQuery = searchInput.value.trim();
      renderProductGrid(); // grid uses prefix matching now
      debouncedRenderSearchResults(searchQuery);
    });

    // Enter: add top prefix-matching product
    searchInput.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') {
        const q = searchInput.value.trim().toLowerCase();
        if (!q) return;
        const products = getProducts();
        const matches = products.filter(p => {
          const name = (p.name || '').toLowerCase();
          const barcode = String(p.barcode || '').toLowerCase();
          return name.startsWith(q) || barcode.startsWith(q);
        });
        if (matches && matches.length) {
          if (typeof window.addToBill === 'function') {
            window.addToBill(matches[0].id);
          } else {
            localStorage.setItem('temp_add_product_id', matches[0].id);
            window.location.href = 'billing.html';
          }
          e.preventDefault();
        }
      } else if (e.key === 'Escape') {
        const resultsBox = document.getElementById('searchResults');
        if (resultsBox) { resultsBox.innerHTML = ''; resultsBox.style.display = 'none'; }
      }
    });

    // click outside closes results
    document.addEventListener('click', (ev) => {
      const resultsBox = document.getElementById('searchResults');
      if (!resultsBox || resultsBox.style.display === 'none') return;
      const target = ev.target;
      const isInsideSearch = target === searchInput || searchInput.contains(target);
      const isInsideResults = resultsBox.contains(target);
      if (!isInsideSearch && !isInsideResults) {
        resultsBox.innerHTML = '';
        resultsBox.style.display = 'none';
      }
    });
  }

  // ----------------- Checkout -----------------
  window.completeSale = function(){
    loadFromStorage();
    if(!billItems.length){ alert('Cart empty'); return; }

    const customer = document.getElementById('custName')?.value||'Walk-in';
    const discount = Number(document.getElementById('discount')?.value||0);
    const sale = checkoutCart(billItems, customer, 'cash', discount);

    billItems=[]; syncToStorage(); renderCart(); renderProductGrid();

    const modal = document.getElementById('invoiceModal');
    const content = document.getElementById('invoiceContent');
    if(content){
      content.innerHTML = `<h3>🛰️ Bharat POS</h3>
      <div><b>Invoice:</b>${sale.invoiceNo}<br><b>Date:</b>${new Date(sale.date).toLocaleString()}<br><b>Customer:</b>${sale.customer}</div>
      <table style="width:100%;margin-top:8px;border-collapse:collapse">
        <tr><th>Item</th><th>Qty</th><th>Price</th><th>Tax</th><th>Total</th></tr>
        ${sale.items.map(it=>`<tr><td>${escapeHTML(it.name)}</td><td>${it.qty}</td><td>₹${it.price.toFixed(2)}</td><td>₹${it.taxAmount.toFixed(2)}</td><td>₹${(it.price*it.qty+it.taxAmount).toFixed(2)}</td></tr>`).join('')}
      </table>
      <div style="text-align:right;margin-top:8px"><b>Grand Total: ₹${sale.total.toFixed(2)}</b></div>`;
    }
    if(modal) modal.classList.remove('hidden');
  };
  window.closeInvoice = ()=>document.getElementById('invoiceModal')?.classList.add('hidden');

  // ----------------- Init -----------------
  document.addEventListener('DOMContentLoaded', ()=>{
    renderProductGrid();
    renderCart();
  });
})();

/* -------------------------
   Universal barcode Enter-key handler
   - If barcode matches product -> add to bill (if billing page).
   - If not found -> redirect to products.html with temp_new_barcode filled.
   NOTE: Scanner code on billing page now calls the same logic via
         localStorage.newProductData or temp_new_barcode for the products page.
   ------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const barcodeInput = document.getElementById('barcodeInput');
  if (!barcodeInput) return;

  barcodeInput.addEventListener('keypress', function (e) {
    if (e.key !== 'Enter') return;
    const code = barcodeInput.value.trim();
    if (!code) return;

    try {
      const products = getProducts();
      const found = products.find(p => String(p.barcode) === String(code));
      if (found) {
        if (typeof window.addToBill === 'function') {
          window.addToBill(found.id);
        } else {
          localStorage.setItem('temp_add_product_id', found.id);
          window.location.href = 'billing.html';
        }
      } else {
        // not found: save for products page flow
        localStorage.setItem('temp_new_barcode', String(code));
        window.location.href = 'products.html';
      }
    } catch (err) {
      console.error('Barcode processing error', err);
      localStorage.setItem('temp_new_barcode', String(code));
      window.location.href = 'products.html';
    } finally {
      barcodeInput.value = '';
    }
  });
});

/* -------------------------
   Utility
   ------------------------- */
function escapeHTML(str) {
  if (str === undefined || str === null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* -------------------------
   attachProductGridHandlers helper (used by filterByCategory)
   ------------------------- */
function attachProductGridHandlers() {
  const productList = document.getElementById('productList');
  if (!productList) return;
  productList.querySelectorAll('.prod-btn').forEach(btn=>{
    const pid = btn.dataset.id;
    btn.onclick = ()=>window.addToBill(pid);
  });
}

/* ============================
   Auto-fill scanned product on products.html
   - Looks for `localStorage.newProductData` or `localStorage.temp_new_barcode`
   - Prefills add-product form fields: barcode, productName, productPrice(MRP), productBrand
   - If settings.autoAddScanned === true -> automatically save product with minimal defaults.
   ============================ */

(function autoFillScannedProduct(){
  // Only run on products page
  if (!window.location.href.includes('products.html')) return;

  document.addEventListener('DOMContentLoaded', () => {
    try {
      const raw = localStorage.getItem('newProductData');
      const tempBarcode = localStorage.getItem('temp_new_barcode');
      if(!raw && !tempBarcode) return; // nothing to do

      let data = raw ? JSON.parse(raw) : { barcode: tempBarcode, name:'', mrp:'', brand:'' };

      // Map to form element IDs that your add product UI uses. Adjust IDs if different.
      const barcodeEl = document.getElementById('productBarcode');
      const nameEl = document.getElementById('productName');
      const priceEl = document.getElementById('productPrice'); // price input
      const stockEl = document.getElementById('productStock');
      const taxEl = document.getElementById('productTax');
      const brandEl = document.getElementById('productBrand'); // if exists
      const categoryEl = document.getElementById('productCategory');

      if (barcodeEl && data.barcode) barcodeEl.value = data.barcode;
      if (nameEl && data.name) nameEl.value = data.name;
      if (priceEl && (data.mrp || data.price)) priceEl.value = data.mrp || data.price || '';
      if (brandEl && data.brand) brandEl.value = data.brand;
      if (categoryEl && !categoryEl.value) categoryEl.value = 'General';
      if (stockEl && !stockEl.value) stockEl.value = 0;
      if (taxEl && !taxEl.value) taxEl.value = (getSettings().defaultTax || '') ;

      // Small visual log for user
      const infoBox = document.createElement('div');
      infoBox.style.padding = '8px';
      infoBox.style.marginTop = '10px';
      infoBox.style.background = '#f1f8ff';
      infoBox.style.border = '1px solid #dfeffd';
      infoBox.style.borderRadius = '8px';
      infoBox.innerHTML = `<b>Auto-filled from scan:</b><br>
                           Barcode: ${escapeHTML(data.barcode||'—')}<br>
                           Name: ${escapeHTML(data.name||'—')}<br>
                           MRP: ${escapeHTML(String(data.mrp||'—'))}`;
      // Insert near the top of the product form if container exists
      const formContainer = document.querySelector('.card') || document.body;
      formContainer.insertBefore(infoBox, formContainer.firstChild);

      // If user wants automatic save (optionally enabled in settings), do it:
      const settings = getSettings();
      if (settings.autoAddScanned === true) {
        // minimal default stock 1 if not provided
        const pName = nameEl ? nameEl.value.trim() : (data.name || '').trim() || 'Unnamed Product';
        const pPrice = priceEl && priceEl.value ? parseFloat(priceEl.value) : (data.mrp ? Number(data.mrp) : 0);
        const pStock = stockEl && stockEl.value ? parseInt(stockEl.value) : 1;
        const pTax = taxEl && taxEl.value ? parseFloat(taxEl.value) : (data.tax ? Number(data.tax) : 0);
        const pCategory = categoryEl && categoryEl.value ? categoryEl.value : 'General';
        const pBarcode = barcodeEl && barcodeEl.value ? barcodeEl.value : (data.barcode || '');

        // push product
        const products = getProducts();
        products.unshift({
          id: uid('p'),
          name: pName,
          price: pPrice,
          stock: pStock,
          taxPercent: pTax,
          category: pCategory,
          barcode: pBarcode
        });
        saveProducts(products);
        // cleanup and notify
        localStorage.removeItem('newProductData');
        localStorage.removeItem('temp_new_barcode');
        alert('Product auto-added from scan: ' + pName);
        // re-render grid if present
        if (typeof window.renderCategoryFilters === 'function') window.renderCategoryFilters();
        if (typeof window._renderProductGrid === 'function') window._renderProductGrid();
        return;
      }

      // If not auto-adding, keep data in localStorage so user can review and press Add Product
      // Note: we DO NOT remove newProductData so user can still see it if they reload
    } catch (err) {
      console.error('autoFillScannedProduct error', err);
    }
  });
})();

/******************************************
  UPC/OPENFOOD FETCH + AUTOFILL + CACHE
  Paste this at the end of bharatpos.js (after other functions)
******************************************/

// CACHE helpers - store API results to reduce requests
const UPC_CACHE_KEY = 'upc_cache_v1';
function readUpcCache(){
  try { return JSON.parse(localStorage.getItem(UPC_CACHE_KEY) || '{}'); }
  catch(e){ return {}; }
}
function writeUpcCache(obj){ localStorage.setItem(UPC_CACHE_KEY, JSON.stringify(obj)); }

// MAIN fetcher: try OpenFoodFacts then UPCItemDB
async function fetchProductData(barcode){
  barcode = String(barcode || '').trim();
  if(!barcode) return { found:false };

  // 1) cache check
  const cache = readUpcCache();
  if(cache[barcode]) {
    // Ensure cached object shape
    return { found:true, source:'cache', ...cache[barcode] };
  }

  // Normalized result object
  const result = { found:false, name:'', brand:'', mrp:'', image:'', source:'' };

  // Helper to save to cache
  const saveAndReturn = (r) => {
    try {
      const cache2 = readUpcCache();
      cache2[barcode] = { name: r.name||'', brand: r.brand||'', mrp: r.mrp||'', image: r.image||'', source: r.source||'' , ts: Date.now() };
      writeUpcCache(cache2);
    } catch(e){ console.warn('cache save failed', e); }
    return { found:true, ...r };
  };

  // --- Try OpenFoodFacts (food/beauty) ---
  try {
    // try general OpenProduct (food)
    let url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`;
    let resp = await fetch(url);
    if (resp && resp.ok) {
      const data = await resp.json();
      if (data && data.status === 1 && data.product) {
        result.name = data.product.product_name || data.product.generic_name || '';
        result.brand = data.product.brands || (data.product.brands_tags && data.product.brands_tags[0]) || '';
        // price field is not standardized: try price or stores_tags or nutriments fields
        result.mrp = data.product.price || data.product.stores || data.product.stores_tags?.[0] || '';
        result.image = data.product.image_small_url || data.product.image_url || '';
        result.source = 'openfoodfacts';
        return saveAndReturn(result);
      }
    }
  } catch (e) {
    console.warn('OpenFoodFacts error', e);
  }

  // --- Try OpenBeautyFacts (cosmetics) as second fallback ---
  try {
    let urlB = `https://world.openbeautyfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`;
    let respB = await fetch(urlB);
    if (respB && respB.ok) {
      const dataB = await respB.json();
      if (dataB && dataB.status === 1 && dataB.product) {
        result.name = dataB.product.product_name || '';
        result.brand = dataB.product.brands || '';
        result.mrp = dataB.product.price || '';
        result.image = dataB.product.image_small_url || dataB.product.image_url || '';
        result.source = 'openbeauty';
        return saveAndReturn(result);
      }
    }
  } catch (e) {
    console.warn('OpenBeautyFacts error', e);
  }

  // --- Try UPCItemDB trial API (100 requests/day) as general fallback ---
  // trial endpoint doesn't require a key: /prod/trial/lookup?upc=
  try {
    const upcUrl = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
    const r2 = await fetch(upcUrl);
    if (r2 && r2.ok) {
      const j2 = await r2.json();
      if (j2 && j2.code === 'OK' && j2.total && j2.total > 0 && j2.items && j2.items.length) {
        const it = j2.items[0];
        // item fields: title, brand, offers (price), images, category
        result.name = it.title || it.description || '';
        result.brand = it.brand || (it.category ? it.category.split('›')?.[0]?.trim() : '');
        // mrp: try offers -> lowest_recorded_price or offers[0].price
        result.mrp = (it.offers && it.offers[0] && (it.offers[0].price || it.offers[0].currency)) || (it.lowest_recorded_price || '');
        // sometimes price is like "₹199" or 199. Keep raw.
        result.image = (it.images && it.images[0]) || '';
        result.source = 'upcitemdb';
        return saveAndReturn(result);
      } else {
        // if trial limit reached the response may differ - just continue to manual
        console.warn('UPCItemDB: no items or trial limit reached', j2);
      }
    }
  } catch (e) {
    console.warn('UPCItemDB error', e);
  }

  // nothing found
  return { found:false };
}

// CENTRAL handler to call when a barcode is unknown (scanner's acceptCode or Enter handler)
async function handleUnknownBarcodeAndFetch(code) {
  try {
    if(!code) return;
    code = String(code).trim();
    // Quick UI: set product barcode input on product page if exists
    try {
      const pb = document.getElementById('productBarcode') || document.getElementById('barcodeInput');
      if(pb) pb.value = code;
    } catch(e){}

    // check local products first (maybe added earlier)
    const products = getProducts();
    const foundLocal = products.find(p => String(p.barcode) === String(code));
    if (foundLocal) {
      // if we're on billing page - add to bill
      if (window.location.href.includes('billing.html') && typeof window.addToBill === 'function') {
        window.addToBill(foundLocal.id);
        return;
      }
      // otherwise redirect to products page with selection
      localStorage.setItem('temp_add_product_id', foundLocal.id);
      window.location.href = 'products.html';
      return;
    }

    // Not in local DB: fetch via APIs
    const apiResult = await fetchProductData(code);

    if (apiResult && apiResult.found) {
      // prepare newProductData object consumed by products page auto-fill
      const newProductData = {
        barcode: code,
        name: apiResult.name || '',
        brand: apiResult.brand || '',
        mrp: apiResult.mrp || '',
        image: apiResult.image || '',
        source: apiResult.source || ''
      };
      localStorage.setItem('newProductData', JSON.stringify(newProductData));

      // If we are on billing page: optionally auto-add to products & cart
      if (window.location.href.includes('billing.html')) {
        // If settings say autoAddScanned -> create product and add to bill
        const settings = getSettings();
        if (settings.autoAddScanned === true) {
          const prodName = newProductData.name || ('Product ' + code);
          const prodPrice = parseFloat(String(newProductData.mrp || '0').replace(/[^\d.]/g,'')) || 0;
          const prod = {
            id: uid('p'),
            name: prodName,
            price: prodPrice,
            stock: 1000, // large initial stock for billing convenience
            taxPercent: 0,
            category: 'General',
            barcode: code,
            brand: newProductData.brand || ''
          };
          const pArr = getProducts();
          pArr.unshift(prod);
          saveProducts(pArr);
          // add to bill
          if (typeof window.addToBill === 'function') {
            window.addToBill(prod.id);
          }
          // cleanup newProductData
          localStorage.removeItem('newProductData');
          return;
        } else {
          // Not auto-adding: open products page so user can review & save
          window.location.href = 'products.html';
          return;
        }
      }

      // If on products page: stay so the product form will auto-fill (products.html reads newProductData)
      if (window.location.href.includes('products.html')) {
        // the products.html DOMContentLoaded handler reads newProductData only at load,
        // so we reload to force auto-fill, or directly set fields if they exist now.
        const nameEl = document.getElementById('productName');
        const mrpEl = document.getElementById('productMRP') || document.getElementById('productPrice');
        const brandEl = document.getElementById('brand') || document.getElementById('productBrand');
        const barcodeEl = document.getElementById('productBarcode');
        if (nameEl) nameEl.value = newProductData.name || '';
        if (mrpEl) mrpEl.value = newProductData.mrp || '';
        if (brandEl) brandEl.value = newProductData.brand || '';
        if (barcodeEl) barcodeEl.value = newProductData.barcode || '';
        // leave newProductData in localStorage for persistence
        return;
      }

      // default fallback: go to products page to let user confirm and save
      window.location.href = 'products.html';
      return;
    } else {
      // Not found in any API: store temp barcode and go to products page for manual entry
      localStorage.setItem('temp_new_barcode', String(code));
      window.location.href = 'products.html';
      return;
    }
  } catch (err) {
    console.error('handleUnknownBarcodeAndFetch error', err);
    // fallback behavior
    localStorage.setItem('temp_new_barcode', String(code));
    window.location.href = 'products.html';
  }
}

// -----------------------------
// Adaptation: make addProduct read productMRP & brand if present in DOM
// (This keeps compatibility with your product.html that has productMRP and brand IDs)
const _origAddProduct = addProduct;
function addProduct_withMRP() {
  // Try to map productMRP -> productPrice for internal storage
  const mrpEl = document.getElementById('productMRP');
  if (mrpEl) {
    // if your addProduct uses #productPrice, copy MRP value there so original code works
    const priceEl = document.getElementById('productPrice');
    if (!priceEl) {
      // create a hidden price input so existing code finds it (minimal change)
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.id = 'productPrice';
      hidden.value = mrpEl.value;
      document.getElementById('productForm')?.appendChild(hidden);
    } else {
      priceEl.value = mrpEl.value;
    }
  }

  // Map brand -> productBrand or productBrand -> productBrand expected id
  const brandEl = document.getElementById('brand');
  if (brandEl) {
    let pb = document.getElementById('productBrand');
    if (!pb) {
      const h = document.createElement('input');
      h.type = 'hidden';
      h.id = 'productBrand';
      h.value = brandEl.value;
      document.getElementById('productForm')?.appendChild(h);
    } else {
      pb.value = brandEl.value;
    }
  }

  // now call original addProduct logic (which reads productPrice, etc.)
  try {
    return _origAddProduct();
  } catch (e) {
    console.warn('fallback addProduct failed, trying orig', e);
    // fallback: try original if available
    return _origAddProduct();
  }
}
// Replace addProduct in global scope so product.html's handleAddProduct triggers this updated version
window.addProduct = addProduct_withMRP;

// -----------------------------
// Hook universal Enter-key barcode handler to call fetch if not found locally.
// We will patch existing handler by wrapping its 'not found' branch to call handleUnknownBarcodeAndFetch.
// If your file already has barcodeInput keypress logic, it will still work — this is a safety net.

// Find barcode input and attach a supplementary listener
document.addEventListener('DOMContentLoaded', ()=>{
  const barcodeInput = document.getElementById('barcodeInput') || document.getElementById('productBarcode');
  if (!barcodeInput) return;
  // don't duplicate listeners
  barcodeInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const code = String(barcodeInput.value || '').trim();
    if (!code) return;
    // If local product exists, existing logic already handles it. Otherwise call our fetch handler.
    const products = getProducts();
    const found = products.find(p => String(p.barcode) === String(code));
    if (!found) {
      e.preventDefault();
      await handleUnknownBarcodeAndFetch(code);
      // clear input
      barcodeInput.value = '';
    }
  });
});

async function fetchProductData(barcode) {
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.items || data.items.length === 0) {
            return null;
        }

        const item = data.items[0];

        return {
            name: item.title || "",
            brand: item.brand || "",
            mrp: item.lowest_recorded_price || ""
        };

    } catch (err) {
        console.error("API Error:", err);
        return null;
    }
}



