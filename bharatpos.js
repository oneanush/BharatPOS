



/* ============================================================
  bharatpos.js — Full corrected script
  - Removes old stockList usage
  - Uses productList grid on billing.html only
  - Live add-to-cart, + / - / remove, checkout/invoice
  - Product CRUD, export/import, theme
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
  const barcodeEl = document.getElementById('productBarcode'); // new field

  if (!nameEl || !priceEl || !stockEl || !catEl) {
    alert('Product form missing fields');
    return;
  }

  const name = nameEl.value.trim();
  const price = parseFloat(priceEl.value);
  const stock = parseInt(stockEl.value);
  const taxPercent = parseFloat(taxEl?.value) || 0;
  const category = catEl.value.trim() || 'General';
  const barcode = barcodeEl?.value.trim() || ''; // new barcode value

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
  } else {
    products.push({
      id: uid('p'),
      name,
      price,
      stock,
      taxPercent,
      category,
      barcode // new property
    });
  }
if (!barcode) {
  alert("Scan barcode first");
  return;
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
              <div class="prod-name">${p.name}</div>
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

      html += `<tr>
        <td>${it.name}</td>
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
      btn.onclick = ()=>{
        const i = Number(btn.dataset.index);
        if(!billItems[i]) return;
        billItems[i].qty += 1;
        syncToStorage();
        renderCart();
      };
    });
    container.querySelectorAll('.cart-dec').forEach(btn=>{
      btn.onclick = ()=>{
        const i = Number(btn.dataset.index);
        if(!billItems[i]) return;
        billItems[i].qty -= 1;
        if(billItems[i].qty <= 0) billItems.splice(i,1);
        syncToStorage();
        renderCart();
      };
    });
    container.querySelectorAll('.cart-remove').forEach(btn=>{
      btn.onclick = ()=>{
        const i = Number(btn.dataset.index);
        if(!billItems[i]) return;
        billItems.splice(i,1);
        syncToStorage();
        renderCart();
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
    if(searchQuery) products = products.filter(p=>p.name.toLowerCase().includes(searchQuery.toLowerCase()));

    if(!products.length){ productList.innerHTML='<div class="small">No products</div>'; return; }

    productList.innerHTML = products.map(p=>{
      const qty = Number(p.stock||0), disabled = qty<=0?'disabled':'';
      return `<button class="prod-btn" ${disabled} data-id="${p.id}">
                <div class="prod-name">${p.name}</div>
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

  // ----------------- Search -----------------
  const searchInput = document.getElementById('productSearch');
  if(searchInput){
    searchInput.addEventListener('input', ()=>{
      searchQuery = searchInput.value.trim();
      renderProductGrid();
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
        ${sale.items.map(it=>`<tr><td>${it.name}</td><td>${it.qty}</td><td>₹${it.price.toFixed(2)}</td><td>₹${it.taxAmount.toFixed(2)}</td><td>₹${(it.price*it.qty+it.taxAmount).toFixed(2)}</td></tr>`).join('')}
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






const barcodeInput = document.getElementById("barcodeInput");

barcodeInput.addEventListener("keypress", function (e) {
  if (e.key === "Enter") {
    const code = barcodeInput.value.trim();
    if (!code) return;

    const products = JSON.parse(localStorage.getItem("bharatpos_products")) || [];
    const found = products.find(p => p.barcode == code);

    if (found) {
      addToCart(found.id);        // existing function = OK
    } else {
      if (confirm("Product not found. Add it now?")) {
        // open product page and auto fill barcode
        localStorage.setItem("temp_new_barcode", code);
        window.location.href = "products.html";
      }
    }

    barcodeInput.value = "";
  }
});

























function sanitizeInput(str) {
  return str.replace(/[<>]/g, ''); // remove < and >
}

const customerName = sanitizeInput(input.value);









function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


document.getElementById("openCamera").addEventListener("click", async () => {
 
  const videoElement = document.getElementById("preview");
  videoElement.style.display = "block";

  const result = await codeReader.decodeOnceFromVideoDevice(null, 'preview');
  barcodeInput.value = result.text;
  videoElement.style.display = "none";
  codeReader.reset();
});


document.addEventListener("DOMContentLoaded", () => {

  const barcodeInput = document.getElementById("barcodeInput");
  const camBtn = document.getElementById("openCamera");
  const video = document.getElementById("preview");

  // Barcode input by typing
  if (barcodeInput) {
    barcodeInput.addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        const code = barcodeInput.value.trim();
        if (!code) return;

        const products = getProducts();
        const found = products.find(p => p.barcode == code);

        if (found) {
          window.addToBill(found.id);
        } else {
          if (confirm("Product not found! Add new product?")) {
            localStorage.setItem("temp_new_barcode", code);
            window.location.href = "products.html";
          }
        }
        barcodeInput.value = "";
      }
    });
  }

  // Stop button
  const stopBtn = document.createElement("button");
  stopBtn.textContent = "Stop Scanner";
  stopBtn.style.display = "none";
  stopBtn.style.marginTop = "6px";
  stopBtn.style.padding = "6px 10px";
  stopBtn.style.background = "#d9534f";
  stopBtn.style.color = "#fff";
  stopBtn.style.borderRadius = "6px";
  camBtn.insertAdjacentElement("afterend", stopBtn);

  let scanningActive = false;

  if (camBtn && video && barcodeInput) {

    camBtn.addEventListener("click", () => {
      scanningActive = true;
      stopBtn.style.display = "inline-block";
      video.style.display = "block";

      Quagga.init({
        inputStream: {
          name: "Live",
          type: "LiveStream",
          target: video,
          constraints: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "environment"
          }
        },
        decoder: {
          readers: ["code_128_reader", "ean_reader", "ean_8_reader", "upc_reader"]
        },
        locate: true
      }, function(err) {
        if (err) {
          console.error(err);
          alert("Camera initialization failed: " + err);
          video.style.display = "none";
          stopBtn.style.display = "none";
          return;
        }
        Quagga.start();
      });

      Quagga.onDetected(function(result) {
        if (!scanningActive) return;
        if (result && result.codeResult && result.codeResult.code) {
          console.log("Detected barcode:", result.codeResult.code);
          barcodeInput.value = result.codeResult.code;
          barcodeInput.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter" }));

          // Optional beep feedback
          try { new Audio("beep.mp3").play(); } catch(e){}

          // Stop scanner automatically after detection (optional)
          scanningActive = false;
          Quagga.stop();
          video.style.display = "none";
          stopBtn.style.display = "none";
        }
      });
    });

    stopBtn.addEventListener("click", () => {
      scanningActive = false;
      Quagga.stop();
      video.style.display = "none";
      stopBtn.style.display = "none";
    });
  }

});
