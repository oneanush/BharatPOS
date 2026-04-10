
// ==========================================================
// 🟢 1. FIREBASE SDK INITIALIZATION
// ==========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, writeBatch, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyB6j3ywjmvNiSSXo9xZLPRVesYZZlJqzGE",
    authDomain: "bharatpos-244a5.firebaseapp.com",
    projectId: "bharatpos-244a5",
    storageBucket: "bharatpos-244a5.firebasestorage.app",
    messagingSenderId: "135502478185",
    appId: "1:135502478185:web:b22081b57bb34627b59bf8",
    measurementId: "G-49K3N22EHC"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// ==========================================================
// 🚀 2. AI MICROSERVICE ROUTING (Render.com)
// ==========================================================
const API_BASE = 'https://server-xy7s.onrender.com'; 

window.buildUrl = function(endpoint) {
    if (!endpoint) return API_BASE || '';
    const ep = endpoint.replace(/^\//,'');
    if (!API_BASE) return '/' + ep;
    const normalizedBase = API_BASE.replace(/\/+$/,'');
    if (normalizedBase.endsWith('/' + ep) || normalizedBase.endsWith(ep)) return normalizedBase;
    return normalizedBase + '/' + ep;
};
const buildUrl = window.buildUrl;

// ==========================================================
// 💾 3. STORAGE KEYS & HELPERS
// ==========================================================
const LS_KEYS = {
  PRODUCTS: 'bharatpos_products',
  SALES: 'bharatpos_sales',
  SETTINGS: 'bharatpos_settings'
};

window.uid = function(prefix='id'){ return prefix + Date.now() + '-' + Math.floor(Math.random()*90000); }
window.formatCurrency = function(n){ return '₹' + Number(n || 0).toFixed(2); }
window.escapeHTML = function(str) {
  if (str === undefined || str === null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
const uid = window.uid;
const formatCurrency = window.formatCurrency;
const escapeHTML = window.escapeHTML;

// --- SETTINGS CRUD ---
window.getSettings = function(){
  const defaults = { theme:'light', adminPw:'admin123', storeName:'BharatPOS' };
  try { return JSON.parse(localStorage.getItem(LS_KEYS.SETTINGS) || JSON.stringify(defaults)); }
  catch(e){ localStorage.setItem(LS_KEYS.SETTINGS, JSON.stringify(defaults)); return defaults; }
}
window.saveSettings = function(s){ localStorage.setItem(LS_KEYS.SETTINGS, JSON.stringify(s)); }

// --- PRODUCTS CRUD ---
window.getProducts = function(){
  try { return JSON.parse(localStorage.getItem(LS_KEYS.PRODUCTS) || '[]'); }
  catch(e){ localStorage.setItem(LS_KEYS.PRODUCTS, '[]'); return []; }
}
let _productSyncTimer = null;
window.saveProducts = function(arr){
  localStorage.setItem(LS_KEYS.PRODUCTS, JSON.stringify(arr));
  try { if (_productSyncTimer) clearTimeout(_productSyncTimer); } catch(e){}
  _productSyncTimer = setTimeout(()=> {
      try { pushProductsToServer(); } catch(e){ console.warn('Product push failed', e); }
  }, 900);
}
const getProducts = window.getProducts;
const saveProducts = window.saveProducts;

// --- SALES CRUD ---
window.getSales = function(){
  try { return JSON.parse(localStorage.getItem(LS_KEYS.SALES) || '[]'); }
  catch(e){ localStorage.setItem(LS_KEYS.SALES, '[]'); return []; }
}
window.saveSales = function(arr){ localStorage.setItem(LS_KEYS.SALES, JSON.stringify(arr)); }
const getSales = window.getSales;
const saveSales = window.saveSales;

// --- CUSTOMERS CRUD ---
window.getCustomers = function(){
  try { return JSON.parse(localStorage.getItem('bharatpos_customers') || '[]'); }
  catch(e){ localStorage.setItem('bharatpos_customers', '[]'); return []; }
}
let _customerSyncTimer = null;
window.saveCustomers = function(arr){
  localStorage.setItem('bharatpos_customers', JSON.stringify(arr));
  try { if (_customerSyncTimer) clearTimeout(_customerSyncTimer); } catch(e){}
  _customerSyncTimer = setTimeout(()=> {
      try { pushCustomersToServer(); } catch(e){ console.warn('Customer push failed', e); }
      pushFullBackupToServerDebounced(); 
  }, 900);
}
const getCustomers = window.getCustomers;
const saveCustomers = window.saveCustomers;

// ==========================================================
// ☁️ 4. FIREBASE SYNC ENGINE (Replaces Node.js Fetch)
// ==========================================================

window.pushProductsToServerDebounced = function() {
  if (typeof pushProductsToServer === 'function') {
    try { pushProductsToServer(); } catch(e){ console.warn('pushProductsToServer error', e); }
  }
}

window.pushProductsToServer = async function(){
  if(window.IS_CUSTOMER_APP || window.IS_ADMIN_APP) return;
  try{
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if(!user.merchantId) return;
    const products = getProducts();
    
    // Firebase Batch Write
    const batch = writeBatch(db);
    products.forEach(p => {
        const ref = doc(db, "shops", user.merchantId, "products", p.id);
        batch.set(ref, p);
    });
    await batch.commit();
    console.log('📦 Products pushed to Firestore for', user.merchantId);
  }catch(err){ console.warn('Product push failed', err); }
}
const pushProductsToServer = window.pushProductsToServer;

window.pushCustomersToServer = async function(){
  if(window.IS_CUSTOMER_APP || window.IS_ADMIN_APP) return;
  try{
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if(!user.merchantId) return;
    const customers = getCustomers();
    
    const batch = writeBatch(db);
    customers.forEach(c => {
        const ref = doc(db, "shops", user.merchantId, "customers", c.phone || c.id);
        batch.set(ref, c);
    });
    await batch.commit();
    console.log('👥 Customers pushed to Firestore for', user.merchantId);
  }catch(err){ console.warn('Customer push failed', err); }
}
const pushCustomersToServer = window.pushCustomersToServer;

window.syncBillToServer = async function(billData) {
    if(window.IS_CUSTOMER_APP || window.IS_ADMIN_APP) return;
    let userSettings = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if (!userSettings.merchantId) {
        userSettings.merchantId = "GUEST-SHOP-" + Math.floor(Math.random() * 1000);
        localStorage.setItem('bharatpos_user', JSON.stringify(userSettings));
    }
    billData.merchantId = userSettings.merchantId;

    try {
        // Sync Sale
        const billRef = doc(db, "shops", userSettings.merchantId, "sales", billData.id);
        await setDoc(billRef, billData);
        
        // Deduct Stock in Firestore Atomically
        const batch = writeBatch(db);
        const allProducts = getProducts();
        billData.items.forEach(cartItem => {
            const pRef = doc(db, "shops", userSettings.merchantId, "products", cartItem.id);
            const localP = allProducts.find(p => p.id === cartItem.id);
            if(localP) batch.update(pRef, { stock: localP.stock });
        });
        await batch.commit();

        console.log("✅ Bill & Stock synced to Firestore");
    } catch (error) { console.warn("⚠️ Firestore Sync Failed (Offline Mode):", error); }
}
const syncBillToServer = window.syncBillToServer;

window.registerOrUpdateMerchantProfile = async function(){
  try{
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const payload = {
      ownerName: user.name || localStorage.getItem('shopOwner') || '',
      mobile: user.mobile || localStorage.getItem('shopPhone') || '',
      shopName: localStorage.getItem('shopName') || user.shopName || '',
      category: user.category || '',
      state: user.state || localStorage.getItem('shopState') || '',
      city: user.city || localStorage.getItem('shopCity') || '',
      pincode: user.pincode || localStorage.getItem('shopPincode') || '',
      lat: user.lat || null,
      lng: user.lng || null
    };
    if(!user.merchantId || !payload.mobile) return;

    const shopRef = doc(db, "shops", user.merchantId);
    await setDoc(shopRef, { profile: payload, merchantId: user.merchantId }, { merge: true });
    
    try { await pushProductsToServer(); } catch(e){}
    try { await pushCustomersToServer(); } catch(e){}
    try { await pushFullBackupToServer(); } catch(e){}
  }catch(e){ console.warn('Profile update failed', e); }
}

// --- FULL BACKUP (Legacy Stringifier Fallback) ---
window.gatherFullLocalBackup = function() {
  const keysOfInterest = [ 'bharatpos_products','bharatpos_sales','bharatpos_customers','bharatpos_settings', 'shopName','shopPhone','shopAddress','bharatpos_bill_footer','bharatpos_bill_size', 'upiQR','bharatpos_user','bill_items','temp_add_product_id','temp_new_barcode', 'bharatpos_last_import','bharatpos_last_sent_reports_snapshot_hash' ];
  const backup = {};
  keysOfInterest.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null && v !== undefined) {
      try { backup[k] = JSON.parse(v); } catch(e) { backup[k] = v; }
    }
  });
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith('bharatpos_') && !backup.hasOwnProperty(k)) {
      try { backup[k] = JSON.parse(localStorage.getItem(k)); } catch(e) { backup[k] = localStorage.getItem(k); }
    }
  }
  try { backup._meta = { generatedAt: new Date().toISOString(), userAgent: navigator.userAgent }; } catch(e){}
  return backup;
}

let _fullBackupTimer = null;
window.pushFullBackupToServerDebounced = function(delay = 1000) {
  if(window.IS_CUSTOMER_APP || window.IS_ADMIN_APP) return;
  try { if (_fullBackupTimer) clearTimeout(_fullBackupTimer); } catch(e){}
  _fullBackupTimer = setTimeout(() => { pushFullBackupToServer().catch(()=>{}); }, delay);
}
const pushFullBackupToServerDebounced = window.pushFullBackupToServerDebounced;

window.pushFullBackupToServer = async function() {
  if(window.IS_CUSTOMER_APP || window.IS_ADMIN_APP) return;
  try {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if (!user.merchantId) return; 
    const payload = window.gatherFullLocalBackup();
    
    // Store in Firestore as a legacy massive document
    const backupRef = doc(db, "shops", user.merchantId, "legacy_backup", "latest");
    await setDoc(backupRef, { backupData: payload, timestamp: new Date().toISOString() });
    console.log('🔁 Full backup pushed to Firestore for', user.merchantId);
  } catch (err) { console.warn('Full backup failed', err); }
}
const pushFullBackupToServer = window.pushFullBackupToServer;

// ==========================================================
// 🏢 5. STRICT MULTI-BRANCH ENGINE
// ==========================================================
window.loadOwnedShops = async function(mobileNum) {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const searchMobile = mobileNum || user.mobile || user.phone;
    if (!searchMobile) return [];

    try {
        const shopsRef = collection(db, "shops");
        const q = query(shopsRef, where("profile.mobile", "==", searchMobile));
        const snap = await getDocs(q);
        
        let shops = snap.docs.map(d => ({
            merchantId: d.data().merchantId || d.id,
            shopName: d.data().profile?.shopName || d.id,
            category: d.data().profile?.category || "Retail",
            isMain: !d.data().profile?.isBranch
        }));

        // 🛟 THE IRONCLAD SAFETY NET
        // If Firebase missed the main shop due to old data structures, force it back in!
        const mainId = user.masterId || user.merchantId;
        const mainExists = shops.find(s => s.merchantId === mainId || s.isMain === true);
        
        if (!mainExists && mainId) {
            shops.unshift({
                merchantId: mainId,
                shopName: localStorage.getItem('shopName') || user.shopName || "Main Shop",
                category: user.category || "Retail",
                isMain: true
            });
        }

        if (shops.length > 0) {
            localStorage.setItem(`bharatpos_shops_${searchMobile}`, JSON.stringify(shops));
            return shops;
        }
    } catch (e) { 
        console.warn("Failed to fetch shops from Firestore. Using cache."); 
    }
    
    return JSON.parse(localStorage.getItem(`bharatpos_shops_${searchMobile}`) || '[]');
}
window.switchActiveShop = async function(targetMerchantId) {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if(user.merchantId === targetMerchantId) return; 
    
    const savedMobile = user.mobile || user.phone;
    if (typeof pushFullBackupToServer === 'function') { try { await pushFullBackupToServer(); } catch(e){} }

    try {
        // Wipe local memory for isolation
        localStorage.removeItem('bharatpos_products');
        localStorage.removeItem('bharatpos_sales');
        localStorage.removeItem('bharatpos_customers');
        localStorage.removeItem('bill_items');

        // Fetch Shop Profile
        const shopRef = doc(db, "shops", targetMerchantId);
        const shopSnap = await getDoc(shopRef);
        
        if (shopSnap.exists()) {
            let merchantData = shopSnap.data().profile || {};
            merchantData.merchantId = targetMerchantId;
            merchantData.mobile = savedMobile; 
            localStorage.setItem('bharatpos_user', JSON.stringify(merchantData));
            localStorage.setItem('shopName', merchantData.shopName || '');

            // Fetch Subcollections
            const pSnap = await getDocs(collection(db, "shops", targetMerchantId, "products"));
            const fetchedProducts = pSnap.docs.map(d => d.data());
            if(fetchedProducts.length) localStorage.setItem('bharatpos_products', JSON.stringify(fetchedProducts));

            const cSnap = await getDocs(collection(db, "shops", targetMerchantId, "customers"));
            const fetchedCustomers = cSnap.docs.map(d => d.data());
            if(fetchedCustomers.length) localStorage.setItem('bharatpos_customers', JSON.stringify(fetchedCustomers));

            const sSnap = await getDocs(collection(db, "shops", targetMerchantId, "sales"));
            const fetchedSales = sSnap.docs.map(d => d.data());
            if(fetchedSales.length) localStorage.setItem('bharatpos_sales', JSON.stringify(fetchedSales));

            alert(`✅ Switched to: ${merchantData.shopName}`);
            window.location.href = 'dashboard.html'; 
        } else {
            // Empty Branch
            const allShops = await window.loadOwnedShops(savedMobile);
            const targetShopInfo = allShops.find(s => s.merchantId === targetMerchantId);
            
            if(targetShopInfo) {
                const newProfile = { ...user, merchantId: targetMerchantId, shopName: targetShopInfo.shopName, category: targetShopInfo.category, mobile: savedMobile };
                localStorage.setItem('bharatpos_user', JSON.stringify(newProfile));
                localStorage.setItem('shopName', targetShopInfo.shopName);
                
                alert(`✅ Logged into empty branch: ${targetShopInfo.shopName}`);
                window.location.href = 'dashboard.html';
            } else {
                alert("Failed to locate branch info.");
                window.location.reload();
            }
        }
    } catch(e) {
        alert("Network error while switching.");
        window.location.reload();
    }
}

// ==========================================================
// 📦 6. PRODUCT / INVENTORY FUNCTIONS
// ==========================================================
window.addProduct = function() {
  const nameEl = document.getElementById('productName');
  const priceEl = document.getElementById('productPrice');
  const stockEl = document.getElementById('productStock');
  const taxEl = document.getElementById('productTax');
  const catEl = document.getElementById('productCategory');
  const barcodeEl = document.getElementById('productBarcode');
  const qtyEl = document.getElementById('productQuantity'); 

  if (!nameEl || !priceEl || !stockEl || !catEl) { alert('Product form missing fields'); return; }

  const name = nameEl.value.trim();
  const price = parseFloat(priceEl.value);
  const stock = parseInt(stockEl.value);
  const taxPercent = parseFloat(taxEl?.value) || 0;
  const category = catEl.value.trim() || 'General';
  const barcode = barcodeEl?.value.trim() || '';
  const quantity = qtyEl?.value.trim() || ''; 

  if (!name || isNaN(price) || isNaN(stock)) { alert('Enter valid product info'); return; }

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
    products.push({ id: uid('p'), name, price, stock, taxPercent, category, barcode, quantity });
  }

  saveProducts(products);

  nameEl.value = ''; priceEl.value = ''; stockEl.value = ''; taxEl.value = ''; catEl.value = '';
  if (barcodeEl) barcodeEl.value = '';
  if (qtyEl) qtyEl.value = '';

  if (typeof window.renderCategoryFilters === 'function') window.renderCategoryFilters();
  if (typeof window._renderProductGrid === 'function') window._renderProductGrid();
}

window.renderCategoryFilters = function(){
  const products = getProducts();
  const categories = [...new Set(products.map(p => p.category || 'General'))];
  const filterBox = document.getElementById("categoryFilters");
  if(!filterBox) return;
  filterBox.innerHTML = `<button onclick="filterByCategory('all')">All</button>` +
    categories.map(c => `<button onclick="filterByCategory('${c}')">${c}</button>`).join("");
}

window.filterByCategory = function(cat){
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

window.updateProduct = function(id, data){
  const products = getProducts();
  const i = products.findIndex(p=>p.id===id);
  if(i===-1) return false;
  products[i] = {...products[i], ...data};
  saveProducts(products);
  return true;
}

window.deleteProduct = function(pid){
  let products = getProducts();
  products = products.filter(p=>p.id!==pid);
  saveProducts(products);
  return products;
}

// ==========================================================
// 🛒 7. CHECKOUT & BILLING LOGIC
// ==========================================================
window.genInvoiceNo = function(){ return 'INV' + Date.now().toString().slice(-8); }
window.todayISO = function(){ return new Date().toISOString(); }
const genInvoiceNo = window.genInvoiceNo;
const todayISO = window.todayISO;

window.checkoutCart = function(cartItems, customer='Walk-in', paymentMode='cash', discount=0){
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
 
  pushFullBackupToServerDebounced();
  return sale;
}
const checkoutCart = window.checkoutCart;

(function billingEverything(){
  if(!window.location.href.includes('billing.html')) return;

  let billItems = JSON.parse(localStorage.getItem('bill_items') || '[]');
  window.cart = billItems;

  const syncToStorage = () => {
    localStorage.setItem('bill_items', JSON.stringify(billItems));
    window.cart = billItems; 
  };
  
  const loadFromStorage = () => { 
      billItems = JSON.parse(localStorage.getItem('bill_items') || '[]'); 
      window.cart = billItems; 
  };

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
        id: product.id, name: product.name, price: Number(product.price||0), qty: 1,
        taxPercent: Number(product.taxPercent||0), unit: product.quantity || '' 
      });
    }
    syncToStorage();
    renderCart();
  };

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
})();

// ==========================================================
// 🎯 8. UNIVERSAL BARCODE & UTILS
// ==========================================================
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

window.attachProductGridHandlers = function() {
  const productList = document.getElementById('productList');
  if (!productList) return;
  productList.querySelectorAll('.prod-btn').forEach(btn=>{
    const pid = btn.dataset.id;
    btn.onclick = ()=>window.addToBill(pid);
  });
}
const attachProductGridHandlers = window.attachProductGridHandlers;

window.applyShopDetails = function() {
  const name = localStorage.getItem("shopName");
  const phone = localStorage.getItem("shopPhone");

  const shopNameEls = document.querySelectorAll(".shop-name");
  const shopPhoneEls = document.querySelectorAll(".shop-phone");

  shopNameEls.forEach(el => { if (name) el.textContent = name; });
  shopPhoneEls.forEach(el => { if (phone) el.textContent = phone; });
}
document.addEventListener("DOMContentLoaded", window.applyShopDetails);

window.loadUPIQR = function() {
  const qr = localStorage.getItem("upiQR");
  if (qr) {
    const el = document.getElementById("upiQRImg");
    if(el) el.src = qr;
    const sec = document.getElementById("upiSection");
    if(sec) sec.style.display = "block";
  }
}
document.addEventListener("DOMContentLoaded", window.loadUPIQR);

window.toggleTheme = function() {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
}
window.applyTheme = function() {
  const theme = localStorage.getItem("theme");
  if (theme === "dark") { document.body.classList.add("dark"); }
}
document.addEventListener("DOMContentLoaded", window.applyTheme);

window.exportAll = function(){
  const payload = { settings: window.getSettings(), products: getProducts(), sales: getSales() };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'BharatPOS_export_'+Date.now()+'.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

window.importAllFile = function(file, callback){
  const reader = new FileReader();
  reader.onload = function(e){
    try{
      const obj = JSON.parse(e.target.result);
      if(obj.settings) localStorage.setItem(LS_KEYS.SETTINGS, JSON.stringify(obj.settings));
      if(obj.products) localStorage.setItem(LS_KEYS.PRODUCTS, JSON.stringify(obj.products));
      if(obj.sales) localStorage.setItem(LS_KEYS.SALES, JSON.stringify(obj.sales));
      callback && callback(null,'Imported');

      try { pushProductsToServer(); } catch(e){}
      try { pushCustomersToServer(); } catch(e){}
    }catch(err){ callback && callback(err); }
  };
  reader.readAsText(file);
}

window.addEventListener('storage', (e) => {
  if (!e) return;
  if (e.key === 'bharatpos_last_import') {
    console.log('BharatPOS: import detected -> reloading to sync data.');
    location.reload();
  }
});

// ==========================================================
// ✅ 9. COMPLETE SALE FUNCTION
// ==========================================================
window.completeSale = function() {
    // 1. Basic Checks
    let cart = window.cart;
    if (!cart || cart.length === 0) {
        try { cart = JSON.parse(localStorage.getItem('bill_items') || '[]'); } catch (e) {}
    }
    if (!cart || cart.length === 0) { alert('Cart empty'); return; }

    // 2. Get Form Data
    const customer = document.getElementById('custName')?.value.trim();
    const phone = document.getElementById('custPhone')?.value.trim();
    const discount = Number(document.getElementById('discount')?.value || 0);
    const payModeEl = document.querySelector('input[name="payMode"]:checked');
    const paymentMode = payModeEl ? payModeEl.value : 'Cash';

    // 3. Validation for Udhaar
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

    // 4. PROCESS SALE
    const sale = checkoutCart(cart, customer || 'Walk-in', paymentMode, discount);

    // 5. UPDATE CUSTOMERS (Live Sync)
    if (phone) {
      try {
        const customers = getCustomers();
        const exists = customers.find(c => c.phone === phone);
        if (!exists) {
          const newCust = { id: uid('c'), name: customer || '', phone, lastSeen: new Date().toISOString() };
          customers.push(newCust);
          saveCustomers(customers); 
        } else {
          exists.lastSeen = new Date().toISOString();
          saveCustomers(customers);
        }
      } catch(e) { console.warn('Customer add failed', e); }
    }

    // 6. PREPARE SERVER DATA
    const billForServer = {
        id: sale.invoiceNo,
        date: sale.date,
        customerName: customer || "Walk-in",
        phone: phone || "",
        amount: sale.total,
        items: sale.items,
        paymentMode: paymentMode,
        isPaid: paymentMode !== 'Udhaar'
    };

    // 7. SYNC TO SERVER (Firestore)
    if (typeof syncBillToServer === 'function') {
        syncBillToServer(billForServer);
    } else if (typeof window.syncBillToServer === 'function') {
        window.syncBillToServer(billForServer);
    } else {
        console.warn("⚠️ syncBillToServer not found. Bill saved locally only.");
    }

    // 8. SAVE TO LOCAL LEDGER (Backup)
    if (paymentMode === 'Udhaar') {
        const ledgerEntry = { ...billForServer, isPaid: false };
        const ledger = JSON.parse(localStorage.getItem('bharatpos_ledger') || '[]');
        ledger.push(ledgerEntry);
        localStorage.setItem('bharatpos_ledger', JSON.stringify(ledger));
    }

    // 9. CLEANUP
    window.cart = [];
    localStorage.setItem('bill_items', '[]');
    
    if (window.renderCart) window.renderCart();
    if (typeof window._renderProductGrid === 'function') window._renderProductGrid();

    // 10. SHOW INVOICE MODAL
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

    // 11. WHATSAPP
    if (paymentMode === 'Udhaar' && phone) {
        if (confirm("Send Udhaar record to customer via WhatsApp?")) {
            const msg = `Hello ${customer}, you have a pending amount of ₹${sale.total.toFixed(2)} at BharatPOS. Invoice: ${sale.invoiceNo}. Please pay soon.`;
            window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`, '_blank');
        }
    }
};

(function initBharatPOS(){
  if(!localStorage.getItem(LS_KEYS.SETTINGS)) saveSettings(window.getSettings());
  if(!localStorage.getItem(LS_KEYS.PRODUCTS)) saveProducts([]);
  if(!localStorage.getItem(LS_KEYS.SALES)) saveSales([]);
  window.applyTheme();

  // On startup try to push any existing data
  try { setTimeout(()=> { pushProductsToServer(); pushCustomersToServer(); }, 1200); } catch(e){}
  try { setTimeout(()=> { pushFullBackupToServerDebounced(); }, 2000); } catch(e){}
})();





