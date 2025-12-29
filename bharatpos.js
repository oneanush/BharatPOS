
// --- CONFIGURATION START ---
// Change this single line whenever your Cloudflare URL changes
const API_BASE = 'https://troubleshooting-rack-scale-graphical.trycloudflare.com'; 
// ---------------------------

// This function is now available globally
function buildUrl(endpoint) {
  if (!endpoint) return API_BASE || '';
  const ep = endpoint.replace(/^\//,'');
  if (!API_BASE) return '/' + ep;
  const normalizedBase = API_BASE.replace(/\/+$/,'');
  if (normalizedBase.endsWith('/' + ep) || normalizedBase.endsWith(ep)) return normalizedBase;
  return normalizedBase + '/' + ep;
}







/* ============================================================
   bharatpos.js — FULL & CORRECTED
   Fixed: Udhaar Logic, Syntax Errors, and Cart Syncing
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
  const defaults = { theme:'light', adminPw:'admin123', storeName:'BharatPOS' };
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
  const nameEl = document.getElementById('productName');
  const priceEl = document.getElementById('productPrice');
  const stockEl = document.getElementById('productStock');
  const taxEl = document.getElementById('productTax');
  const catEl = document.getElementById('productCategory');
  const barcodeEl = document.getElementById('productBarcode');
  
  // Read the Quantity/Unit field
  const qtyEl = document.getElementById('productQuantity'); 

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
  const quantity = qtyEl?.value.trim() || ''; 

  if (!name || isNaN(price) || isNaN(stock)) {
    alert('Enter valid product info');
    return;
  }

  const products = getProducts();
  const existing = products.find(p => p.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    existing.stock = (existing.stock || 0) + stock;
    existing.price = Number(price);
    existing.taxPercent = Number(taxPercent);
    existing.category = category || existing.category;
    existing.barcode = barcode || existing.barcode;
    existing.quantity = quantity || existing.quantity; 
  } else {
    products.push({
      id: uid('p'),
      name,
      price,
      stock,
      taxPercent,
      category,
      barcode,
      quantity 
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
  if (qtyEl) qtyEl.value = '';

  if (typeof window.renderCategoryFilters === 'function') window.renderCategoryFilters();
  if (typeof window._renderProductGrid === 'function') window._renderProductGrid();
}

function renderCategoryFilters(){
  const products = getProducts();
  const categories = [...new Set(products.map(p => p.category || 'General'))];
  const filterBox = document.getElementById("categoryFilters");
  if(!filterBox) return;
  filterBox.innerHTML = `<button onclick="filterByCategory('all')">All</button>` +
    categories.map(c => `<button onclick="filterByCategory('${c}')">${c}</button>`).join("");
}

function filterByCategory(cat){
  const products = getProducts();
  const filtered = cat === 'all' ? products : products.filter(p => p.category === cat);
  const productList = document.getElementById('productList');
  if(!productList) return;
  productList.innerHTML = filtered.map(p=>{
    const qty = Number(p.stock||0);
    const disabled = qty <= 0 ? 'disabled' : '';
    return `<button class="prod-btn" data-id="${p.id}" ${disabled}>
              <div class="prod-name">${escapeHTML(p.name)}</div>
              <div class="small" style="color:#0b5ed7;font-weight:bold;">${p.quantity || ''}</div>
              <div class="prod-qty">×${qty}</div>
            </button>`;
  }).join('');
  attachProductGridHandlers();
}

function updateProduct(id, data){
  const products = getProducts();
  const i = products.findIndex(p=>p.id===id);
  if(i===-1) return false;
  products[i] = {...products[i], ...data};
  saveProducts(products);
  return true;
}

function deleteProduct(pid){
  let products = getProducts();
  products = products.filter(p=>p.id!==pid);
  saveProducts(products);
  return products;
}

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
   Billing page logic
   ------------------------- */
(function billingEverything(){
  if(!window.location.href.includes('billing.html')) return;

  let billItems = JSON.parse(localStorage.getItem('bill_items') || '[]');
  
  // FIX: Sync global variable for WhatsApp Button
  window.cart = billItems;

  const syncToStorage = () => {
    localStorage.setItem('bill_items', JSON.stringify(billItems));
    window.cart = billItems; // Keep global in sync
  };
  
  const loadFromStorage = () => { 
      billItems = JSON.parse(localStorage.getItem('bill_items') || '[]'); 
      window.cart = billItems; // Keep global in sync
  };

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
        taxPercent: Number(product.taxPercent||0),
        unit: product.quantity || '' 
      });
    }
    syncToStorage();
    renderCart();
  };

  // ----------------- Cart render -----------------
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

      const unitLabel = it.unit ? `<span class="small" style="color:#0b5ed7">${it.unit}</span> ` : '';

      html += `<tr>
        <td>${escapeHTML(it.name)} <br>${unitLabel}</td>
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
    document.getElementById('grandTotal').innerText= `Total: ₹${grand.toFixed(2)}`;

    container.querySelectorAll('.cart-inc').forEach(btn=>{
      btn.onclick = ()=>{
        const i = Number(btn.dataset.index);
        if(!billItems[i]) return;
        billItems[i].qty += 1;
        syncToStorage(); renderCart();
      };
    });
    container.querySelectorAll('.cart-dec').forEach(btn=>{
      btn.onclick = ()=>{
        const i = Number(btn.dataset.index);
        if(!billItems[i]) return;
        billItems[i].qty -= 1;
        if(billItems[i].qty <= 0) billItems.splice(i,1);
        syncToStorage(); renderCart();
      };
    });
    container.querySelectorAll('.cart-remove').forEach(btn=>{
      btn.onclick = ()=>{
        const i = Number(btn.dataset.index);
        if(!billItems[i]) return;
        billItems.splice(i,1);
        syncToStorage(); renderCart();
      };
    });
  }
  window.renderCart = renderCart;

  // ----------------- Product grid -----------------
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
      const unitDisplay = p.quantity ? `<div style="font-size:10px;font-weight:bold;color:#0b5ed7">${p.quantity}</div>` : '';
      
      return `<button class="prod-btn" ${disabled} data-id="${p.id}">
                <div class="prod-name">${escapeHTML(p.name)}</div>
                ${unitDisplay}
                <div class="prod-qty">×${qty}</div>
              </button>`;
    }).join('');

    productList.querySelectorAll('.prod-btn').forEach(btn=>{
      const pid = btn.dataset.id;
      btn.onclick = ()=>window.addToBill(pid);
    });
  }
  window._renderProductGrid = renderProductGrid;

  window.filterCategory = function(cat){
    activeCategory = cat==='All'?null:cat;
    renderProductGrid();
  };

  // ----------------- Search results -----------------
  function debounce(fn, wait){
    let t; return function(...args){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), wait); };
  }

  function renderSearchResults(query){
    const resultsBox = document.getElementById('searchResults');
    if(!resultsBox) return;
    const q = (query || '').trim().toLowerCase();
    if(!q){ resultsBox.innerHTML = ''; resultsBox.style.display = 'none'; return; }

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
      return `<div class="search-result">
        <div class="info">
          <div class="title">${escapeHTML(p.name || 'Unnamed')}</div>
          <div class="meta">Price: ₹${price.toFixed(2)} • Stock: ${stock}</div>
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
      renderProductGrid(); 
      debouncedRenderSearchResults(searchQuery);
    });

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

  /* ==========================================================
     UPDATED: COMPLETE SALE (Correctly placed logic)
     ========================================================== */
  window.completeSale = function(){
    // 1. Basic Checks
    let cart = window.cart; 
    if (!cart || cart.length === 0) {
        try { cart = JSON.parse(localStorage.getItem('bill_items') || '[]'); } catch(e){}
    }
    if (!cart || cart.length === 0) { alert('Cart empty'); return; }

    // 2. Get Form Data
    const customer = document.getElementById('custName')?.value.trim();
    const phone = document.getElementById('custPhone')?.value.trim();
    const discount = Number(document.getElementById('discount')?.value || 0);
    const payModeEl = document.querySelector('input[name="payMode"]:checked');
    const paymentMode = payModeEl ? payModeEl.value : 'Cash';

    // 3. UDHAAR VALIDATION
    if (paymentMode === 'Udhaar') {
        if (!customer || customer.length < 3) {
            alert("⚠️ For Udhaar, Customer Name is mandatory!");
            document.getElementById('custName').focus(); return;
        }
        if (!phone || phone.length < 10) {
            alert("⚠️ For Udhaar, valid Phone Number is mandatory!");
            document.getElementById('custPhone').focus(); return;
        }
    }

    // 4. PROCESS SALE FIRST (Source of Truth)
    const sale = checkoutCart(cart, customer || 'Walk-in', paymentMode, discount);

    // 5. SAVE TO LEDGER (Syncing the ID)
    if (paymentMode === 'Udhaar') {
        const ledgerEntry = {
            id: sale.invoiceNo,       
            date: sale.date,
            customer: customer,
            phone: phone,
            amount: sale.total,
            items: sale.items, // [FIXED] Saving items list for detailed view 
            isPaid: false
        };
        
        const ledger = JSON.parse(localStorage.getItem('bharatpos_ledger') || '[]');
        ledger.push(ledgerEntry);
        localStorage.setItem('bharatpos_ledger', JSON.stringify(ledger));
    }

    // 6. Cleanup
    window.cart = []; 
    localStorage.setItem('bill_items', '[]'); 
    if(window.renderCart) window.renderCart(); 
    if(typeof window.renderProductGrid === 'function') window.renderProductGrid();

    // 7. Show Invoice Modal
    const modal = document.getElementById('invoiceModal');
    const content = document.getElementById('invoiceContent');
    if (content) {
        const statusBadge = paymentMode === 'Udhaar' 
            ? `<div style="background:#dc3545; color:#fff; padding:5px; text-align:center; font-weight:bold; margin-bottom:10px;">⚠️ PAYMENT PENDING (UDHAAR)</div>`
            : '';

        content.innerHTML = `
            <h3>🛰️ Bharat POS</h3>
            ${statusBadge}
            <div><b>Invoice:</b> ${sale.invoiceNo}</div> 
            <div><b>Date:</b> ${new Date(sale.date).toLocaleString()}</div>
            <div><b>Customer:</b> ${sale.customer}</div>
            <table style="width:100%;margin-top:8px;border-collapse:collapse">
                <tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
                ${sale.items.map(it => `<tr><td>${escapeHTML(it.name)}</td><td>${it.qty}</td><td>₹${it.price.toFixed(2)}</td><td>₹${(it.price * it.qty).toFixed(2)}</td></tr>`).join('')}
            </table>
            <div style="text-align:right;margin-top:8px"><b>Grand Total: ₹${sale.total.toFixed(2)}</b></div>
        `;
    }
    if (modal) modal.classList.remove('hidden');

    // 8. Auto-WhatsApp Logic (NOW INSIDE THE FUNCTION CORRECTLY)
    if (paymentMode === 'Udhaar' && phone) {
        if(confirm("Send Udhaar record to customer via WhatsApp?")) {
            const msg = `Hello ${customer}, you have a pending amount of ₹${sale.total.toFixed(2)} at BharatPOS. Invoice: ${sale.invoiceNo}. Please pay soon.`;
            window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`, '_blank');
        }
    }
  }; // <--- Correct closing bracket placement

  window.closeInvoice = ()=>document.getElementById('invoiceModal')?.classList.add('hidden');

  // ----------------- Init -----------------
  document.addEventListener('DOMContentLoaded', ()=>{
    renderProductGrid();
    renderCart();
  });
})();

/* -------------------------
   Universal barcode Enter-key handler
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

function attachProductGridHandlers() {
  const productList = document.getElementById('productList');
  if (!productList) return;
  productList.querySelectorAll('.prod-btn').forEach(btn=>{
    const pid = btn.dataset.id;
    btn.onclick = ()=>window.addToBill(pid);
  });
}

function applyShopDetails() {
  const name = localStorage.getItem("shopName");
  const phone = localStorage.getItem("shopPhone");

  const shopNameEls = document.querySelectorAll(".shop-name");
  const shopPhoneEls = document.querySelectorAll(".shop-phone");

  shopNameEls.forEach(el => { if (name) el.textContent = name; });
  shopPhoneEls.forEach(el => { if (phone) el.textContent = phone; });
}
document.addEventListener("DOMContentLoaded", applyShopDetails);

function loadUPIQR() {
  const qr = localStorage.getItem("upiQR");
  if (qr) {
    const el = document.getElementById("upiQRImg");
    if(el) el.src = qr;
    const sec = document.getElementById("upiSection");
    if(sec) sec.style.display = "block";
  }
}
document.addEventListener("DOMContentLoaded", loadUPIQR);

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
}
function applyTheme() {
  const theme = localStorage.getItem("theme");
  if (theme === "dark") { document.body.classList.add("dark"); }
}
document.addEventListener("DOMContentLoaded", applyTheme);















