// ==========================================================
// --- 🟢 MASTER DATABASE BRIDGE (IndexedDB + LocalStorage) ---
// ==========================================================
window.dbSave = async function(key, data) {
    try {
        if (typeof localforage !== 'undefined') {
            await localforage.setItem(key, JSON.stringify(data));
            return true;
        } else {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        }
    } catch (err) {
        console.error(`Database Error saving ${key}:`, err);
        return false;
    }
};

window.dbGet = async function(key, defaultValue = '[]') {
    try {
        let value = null;
        if (typeof localforage !== 'undefined') {
            value = await localforage.getItem(key);
        }
        
        // Fallback to localStorage if not found in IndexedDB (migration)
        if (value === null) {
            value = localStorage.getItem(key);
        }

        if (value === null) return JSON.parse(defaultValue);
        return JSON.parse(value);
    } catch (err) {
        console.error(`Database Error reading ${key}:`, err);
        return JSON.parse(defaultValue);
    }
};


// ==========================================================
// --- 🛠️ CENTRALIZED GLOBAL UTILITIES ---
// ==========================================================
window.uid = function(prefix='id'){ return prefix + Date.now() + '-' + Math.floor(Math.random()*90000); };
window.formatCurrency = function(n){ return '₹' + Number(n || 0).toFixed(2); };

window.escapeHtml = function(str) { 
    return str ? String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; 
};
const escapeHTML = window.escapeHtml; // Alias for backward compatibility

window.showToast = function(msg, isError = false) {
    const t = document.getElementById('toast');
    if(!t) return;
    t.innerText = msg; 
    t.style.background = isError ? 'var(--danger)' : 'var(--success)';
    t.classList.add('show'); 
    setTimeout(() => t.classList.remove('show'), 3000);
};

window.showModal = function(id) {
    const m = document.getElementById(id);
    if(m) {
        m.style.display = 'flex';
        setTimeout(() => m.classList.add('show'), 10);
    }
};

window.hideModal = function(id) {
    const m = document.getElementById(id);
    if(m) {
        m.classList.remove('show');
        setTimeout(() => m.style.display = 'none', 300);
    }
};


// ==========================================================
// --- 🌐 I18N (INTERNATIONALIZATION) ENGINE ---
// ==========================================================
const i18nDictionary = {
    "nav_dashboard":    { "en": "Dashboard",          "hinglish": "Dashboard",         "hi": "डैशबोर्ड" },
    "nav_billing":      { "en": "Billing",            "hinglish": "Bill Banao",        "hi": "बिल बनाओ" },
    "nav_inventory":    { "en": "Inventory",          "hinglish": "Dukaan Ka Samaan",  "hi": "दुकान का सामान" },
    "nav_sales":        { "en": "Sales Ledger",       "hinglish": "Sales Record",      "hi": "सेल्स रिकॉर्ड" },
    "nav_finance":      { "en": "Finance HQ",         "hinglish": "Hisab Kitab",       "hi": "हिसाब किताब" },
    "nav_crm":          { "en": "Bharat CRM",         "hinglish": "Grahak (Customers)","hi": "ग्राहक" },
    "nav_ai":           { "en": "DemandMitra AI",     "hinglish": "AI Forecast",       "hi": "AI भविष्यवाणी" },
    "nav_settings":     { "en": "Settings",           "hinglish": "Settings",          "hi": "सेटिंग्स" },
    "top_pos_btn":      { "en": "Open POS",           "hinglish": "Bill Banao",        "hi": "बिल बनाओ" }
};

window.applyTranslations = function() {
    const lang = localStorage.getItem('app_lang') || 'en';
    
    // 1. Swap data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18nDictionary[key] && i18nDictionary[key][lang]) {
            el.innerText = i18nDictionary[key][lang];
        }
    });

    // 2. Handle the old hardcoded tri-lingual spans (Fallback to prevent breaking current pages)
    document.body.className = `lang-${lang}`;
};


// ==========================================================
// --- 🏗️ CENTRALIZED UI INJECTOR (Solves HTML Duplication) ---
// ==========================================================
window.toggleMenu = function() {
    document.getElementById('sideMenu')?.classList.toggle('open');
    const overlay = document.getElementById('menuOverlay');
    if(overlay) overlay.style.display = overlay.style.display === 'block' ? 'none' : 'block';
};

window.injectLayout = function(activePageCode) {
    // 1. Construct Sidebar HTML
    const getActive = (code) => activePageCode === code ? 'active-link' : '';
    
    const sidebarHtml = `
      <div id="menuOverlay" class="menu-overlay" onclick="window.toggleMenu()"></div>
      <div id="sideMenu" class="side-menu">
        <div class="side-menu-brand">
          <div class="side-menu-brand-text">Bharat<span>POS</span></div>
          <button onclick="window.toggleMenu()" style="background:none;border:none;color:var(--text-muted);font-size:22px;cursor:pointer;line-height:1;">&times;</button>
        </div>
        <div class="side-menu-links">
          <a href="dashboard.html" class="${getActive('dashboard')}"><i class="fa-solid fa-house"></i> <span data-i18n="nav_dashboard">Dashboard</span></a>
          <a href="billing.html" class="${getActive('billing')}"><i class="fa-solid fa-file-invoice"></i> <span data-i18n="nav_billing">Billing</span></a>
          <a href="products.html" class="${getActive('products')}"><i class="fa-solid fa-box-open"></i> <span data-i18n="nav_inventory">Inventory</span></a>
          <a href="sales.html" class="${getActive('sales')}"><i class="fa-solid fa-chart-line"></i> <span data-i18n="nav_sales">Sales Ledger</span></a>
          <a href="my_dukkan.html" class="${getActive('finance')}"><i class="fa-solid fa-wallet"></i> <span data-i18n="nav_finance">Finance HQ</span></a>
          <a href="customers.html" class="${getActive('crm')}"><i class="fa-solid fa-users"></i> <span data-i18n="nav_crm">Bharat CRM</span></a>
          <a href="forecast.html" class="${getActive('forecast')}"><i class="fa-solid fa-brain"></i> <span data-i18n="nav_ai">DemandMitra AI</span></a>
          <a href="settings.html" class="${getActive('settings')}"><i class="fa-solid fa-gear"></i> <span data-i18n="nav_settings">Settings</span></a>
        </div>
      </div>
    `;

    // 2. Construct Navbar HTML
    let iconClass = 'fa-cash-register';
    let pageTitle = 'Dashboard';
    
    if(activePageCode === 'billing') { iconClass = 'fa-file-invoice'; pageTitle = 'Point of Sale'; }
    if(activePageCode === 'products') { iconClass = 'fa-boxes-stacked'; pageTitle = 'Inventory'; }
    if(activePageCode === 'sales') { iconClass = 'fa-chart-line'; pageTitle = 'Sales Ledger'; }
    
    const navbarHtml = `
      <nav class="navbar">
        <div class="brand">
          <button onclick="window.toggleMenu()" class="menu-btn"><i class="fa-solid fa-bars"></i></button>
          <div class="brand-logo-wrap"><i class="fa-solid ${iconClass}"></i></div>
          <div class="nav-breadcrumb">
            <span>BharatPOS</span> <span style="color:var(--border-hover);">/</span> 
            <strong><span data-i18n="nav_${activePageCode}">${pageTitle}</span></strong>
          </div>
        </div>
        <div class="nav-actions">
          <select id="globalShopSwitcher" class="shop-switcher" style="display:none;"></select>
          <button id="globalLangToggle" class="btn btn-outline btn-icon-only" style="font-weight:800; padding:6px 10px; border-radius:8px;">A/अ</button>
          ${activePageCode !== 'billing' ? `
          <button onclick="window.location.href='billing.html'" class="btn btn-success" style="padding:8px 16px;font-size:13px;width:auto;">
            <i class="fa-solid fa-cash-register"></i> <span data-i18n="top_pos_btn">Open POS</span>
          </button>` : `
          <div id="btnOnlineOrders" class="bell-icon" title="Online Orders">
              <i class="fa-solid fa-bell"></i><div class="bell-badge" id="onlineBadge">0</div>
          </div>`}
        </div>
      </nav>
      <div id="toast">✅ Action Successful</div>
    `;

    // 3. Inject into Body
    document.body.insertAdjacentHTML('afterbegin', navbarHtml);
    document.body.insertAdjacentHTML('afterbegin', sidebarHtml);

    // 4. Bind Global Nav Events
    const langBtn = document.getElementById('globalLangToggle');
    if(langBtn) {
        langBtn.addEventListener('click', () => {
            const langs = ['en', 'hinglish', 'hi'];
            let currentIdx = langs.indexOf(localStorage.getItem('app_lang') || 'en');
            currentIdx = (currentIdx + 1) % langs.length;
            localStorage.setItem('app_lang', langs[currentIdx]);
            window.applyTranslations();
        });
    }

    // Apply translations immediately upon injection
    window.applyTranslations();
};


// ==========================================================
// 🟢 FIREBASE SDK INITIALIZATION
// ==========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, writeBatch, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
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
// 🚀 AI MICROSERVICE ROUTING (Render.com)
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
// 💾 ASYNC STORAGE KEYS & BACKWARD COMPATIBILITY HELPERS
// ==========================================================
const LS_KEYS = {
  PRODUCTS: 'bharatpos_products',
  SALES: 'bharatpos_sales',
  SETTINGS: 'bharatpos_settings'
};

window.getSettings = async function(){
  const defaults = { theme:'light', adminPw:'admin123', storeName:'BharatPOS' };
  try { return await window.dbGet(LS_KEYS.SETTINGS, JSON.stringify(defaults)); }
  catch(e){ await window.dbSave(LS_KEYS.SETTINGS, defaults); return defaults; }
}
window.saveSettings = async function(s){ await window.dbSave(LS_KEYS.SETTINGS, s); }

window.getProducts = async function(){
  try { return await window.dbGet(LS_KEYS.PRODUCTS, '[]'); }
  catch(e){ await window.dbSave(LS_KEYS.PRODUCTS, []); return []; }
}
let _productSyncTimer = null;
window.saveProducts = async function(arr){
  await window.dbSave(LS_KEYS.PRODUCTS, arr);
  try { if (_productSyncTimer) clearTimeout(_productSyncTimer); } catch(e){}
  _productSyncTimer = setTimeout(()=> {
      try { pushProductsToServer(); } catch(e){ console.warn('Product push failed', e); }
  }, 900);
}

window.getSales = async function(){
  try { return await window.dbGet(LS_KEYS.SALES, '[]'); }
  catch(e){ await window.dbSave(LS_KEYS.SALES, []); return []; }
}
window.saveSales = async function(arr){ await window.dbSave(LS_KEYS.SALES, arr); }

window.getCustomers = async function(){
  try { return await window.dbGet('bharatpos_customers', '[]'); }
  catch(e){ await window.dbSave('bharatpos_customers', []); return []; }
}
let _customerSyncTimer = null;
window.saveCustomers = async function(arr){
  await window.dbSave('bharatpos_customers', arr);
  try { if (_customerSyncTimer) clearTimeout(_customerSyncTimer); } catch(e){}
  _customerSyncTimer = setTimeout(()=> {
      try { pushCustomersToServer(); } catch(e){ console.warn('Customer push failed', e); }
      pushFullBackupToServerDebounced(); 
  }, 900);
}


// ==========================================================
// ☁️ FIREBASE SYNC ENGINE (Legacy Uploaders)
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
    const products = await window.getProducts(); 
    
    const batch = writeBatch(db);
    products.forEach(p => {
        const ref = doc(db, "shops", user.merchantId, "products", p.id);
        batch.set(ref, p);
    });
    await batch.commit();
    console.log('📦 Products pushed to Firestore for', user.merchantId);
  }catch(err){ console.warn('Product push failed', err); }
}

window.pushCustomersToServer = async function(){
  if(window.IS_CUSTOMER_APP || window.IS_ADMIN_APP) return;
  try{
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if(!user.merchantId) return;
    const customers = await window.getCustomers(); 
    
    const batch = writeBatch(db);
    customers.forEach(c => {
        const ref = doc(db, "shops", user.merchantId, "customers", c.phone || c.id);
        batch.set(ref, c);
    });
    await batch.commit();
    console.log('👥 Customers pushed to Firestore for', user.merchantId);
  }catch(err){ console.warn('Customer push failed', err); }
}

window.syncBillToServer = async function(billData) {
    if(window.IS_CUSTOMER_APP || window.IS_ADMIN_APP) return;
    let userSettings = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    
    if (!userSettings.merchantId) {
        userSettings.merchantId = "GUEST-SHOP-" + Math.floor(Math.random() * 1000);
        localStorage.setItem('bharatpos_user', JSON.stringify(userSettings));
    }
    billData.merchantId = userSettings.merchantId;

    try {
        const billRef = doc(db, "shops", userSettings.merchantId, "sales", billData.id);
        await setDoc(billRef, billData);
        
        const batch = writeBatch(db);
        const allProducts = await window.getProducts(); 
        billData.items.forEach(cartItem => {
            const pRef = doc(db, "shops", userSettings.merchantId, "products", cartItem.id);
            const localP = allProducts.find(p => p.id === cartItem.id);
            if(localP) batch.update(pRef, { stock: localP.stock });
        });
        await batch.commit();
        console.log("✅ Bill & Stock synced to Firestore");
    } catch (error) { console.warn("⚠️ Firestore Sync Failed (Offline Mode):", error); }
}

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
    
    try { await window.pushProductsToServer(); } catch(e){}
    try { await window.pushCustomersToServer(); } catch(e){}
    try { await window.pushFullBackupToServer(); } catch(e){}
  }catch(e){ console.warn('Profile update failed', e); }
}


// --- ASYNC FULL BACKUP ---
window.gatherFullLocalBackup = async function() {
  const keysOfInterest = [ 'bharatpos_products','bharatpos_sales','bharatpos_customers','bharatpos_settings', 'shopName','shopPhone','shopAddress','bharatpos_bill_footer','bharatpos_bill_size', 'upiQR','bharatpos_user','bill_items','temp_add_product_id','temp_new_barcode', 'bharatpos_last_import','bharatpos_last_sent_reports_snapshot_hash' ];
  const backup = {};
  
  // Scrape synchronous fallback data
  keysOfInterest.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null && v !== undefined) {
      try { backup[k] = JSON.parse(v); } catch(e) { backup[k] = v; }
    }
  });
  
  // Scrape IndexedDB Async Data
  try {
      if (typeof localforage !== 'undefined') {
          const lfKeys = await localforage.keys();
          for(let k of lfKeys) {
              const v = await localforage.getItem(k);
              try { backup[k] = JSON.parse(v); } catch(e) { backup[k] = v; }
          }
      }
  } catch(e) { console.error("Backup IndexedDB scrape failed", e); }

  try { backup._meta = { generatedAt: new Date().toISOString(), userAgent: navigator.userAgent }; } catch(e){}
  return backup;
}

let _fullBackupTimer = null;
window.pushFullBackupToServerDebounced = function(delay = 1000) {
  if(window.IS_CUSTOMER_APP || window.IS_ADMIN_APP) return;
  try { if (_fullBackupTimer) clearTimeout(_fullBackupTimer); } catch(e){}
  _fullBackupTimer = setTimeout(() => { window.pushFullBackupToServer().catch(()=>{}); }, delay);
}

window.pushFullBackupToServer = async function() {
  if(window.IS_CUSTOMER_APP || window.IS_ADMIN_APP) return;
  try {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if (!user.merchantId) return; 
    const payload = await window.gatherFullLocalBackup();
    
    const backupRef = doc(db, "shops", user.merchantId, "legacy_backup", "latest");
    await setDoc(backupRef, { backupData: payload, timestamp: new Date().toISOString() });
    console.log('🔁 Full backup pushed to Firestore for', user.merchantId);
  } catch (err) { console.warn('Full backup failed', err); }
}


// ==========================================================
// 🏢 STRICT MULTI-BRANCH ENGINE (Hub & Spoke)
// ==========================================================
window.loadOwnedShops = async function(mobileNum) {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const searchMobile = mobileNum || user.mobile || user.phone;
    if (!searchMobile || !db) return [];

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
        console.warn("Failed to fetch shops from Firestore. Using local cache."); 
    }
    
    return JSON.parse(localStorage.getItem(`bharatpos_shops_${searchMobile}`) || '[]');
}

window.switchActiveShop = async function(targetMerchantId) {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if(user.merchantId === targetMerchantId) return; 
    
    const savedMobile = user.mobile || user.phone;
    
    if (typeof window.pushFullBackupToServer === 'function') { 
        try { await window.pushFullBackupToServer(); } catch(e){} 
    }

    try {
        // Wipe local memory (IndexedDB wipe)
        if (typeof localforage !== 'undefined') {
            await localforage.removeItem('bharatpos_products');
            await localforage.removeItem('bharatpos_sales');
            await localforage.removeItem('bharatpos_customers');
            await localforage.removeItem('bill_items');
            await localforage.removeItem('bharatpos_ai_cache');
            
            // Wipe Enterprise Master Caches to force refresh on switch
            await localforage.removeItem('bharatpos_enterprise_sales');
            await localforage.removeItem('bharatpos_enterprise_products');
            await localforage.removeItem('bharatpos_enterprise_pos');
            await localforage.removeItem('bharatpos_enterprise_expenses');
        }

        const shopRef = doc(db, "shops", targetMerchantId);
        const shopSnap = await getDoc(shopRef);
        
        if (shopSnap.exists()) {
            let merchantData = shopSnap.data().profile || {};
            merchantData.merchantId = targetMerchantId;
            merchantData.mobile = savedMobile; 
            localStorage.setItem('bharatpos_user', JSON.stringify(merchantData));
            localStorage.setItem('shopName', merchantData.shopName || '');

            const pSnap = await getDocs(collection(db, "shops", targetMerchantId, "products"));
            const fetchedProducts = pSnap.docs.map(d => d.data());
            if(fetchedProducts.length) await window.dbSave('bharatpos_products', fetchedProducts);

            const cSnap = await getDocs(collection(db, "shops", targetMerchantId, "customers"));
            const fetchedCustomers = cSnap.docs.map(d => d.data());
            if(fetchedCustomers.length) await window.dbSave('bharatpos_customers', fetchedCustomers);

            const sSnap = await getDocs(collection(db, "shops", targetMerchantId, "sales"));
            const fetchedSales = sSnap.docs.map(d => d.data());
            if(fetchedSales.length) await window.dbSave('bharatpos_sales', fetchedSales);

            window.location.reload(); 
        } else {
            const allShops = await window.loadOwnedShops(savedMobile);
            const targetShopInfo = allShops.find(s => s.merchantId === targetMerchantId);
            
            if(targetShopInfo) {
                const newProfile = { ...user, merchantId: targetMerchantId, shopName: targetShopInfo.shopName, category: targetShopInfo.category, mobile: savedMobile };
                localStorage.setItem('bharatpos_user', JSON.stringify(newProfile));
                localStorage.setItem('shopName', targetShopInfo.shopName);
                window.location.reload();
            } else {
                alert("Failed to locate branch info.");
                window.location.reload();
            }
        }
    } catch(e) {
        console.error("Switching error:", e);
        alert("Network error while switching branches.");
        window.location.reload();
    }
}


// ==========================================================
// 🛒 CORE CHECKOUT & BILLING LOGIC
// ==========================================================
window.genInvoiceNo = function(){ return 'INV' + Date.now().toString().slice(-8); }
window.todayISO = function(){ return new Date().toISOString(); }

window.checkoutCart = async function(cartItems, customer='Walk-in', paymentMode='cash', discount=0){
  if(!cartItems || !Array.isArray(cartItems) || cartItems.length===0) throw new Error('Cart empty');

  const products = await window.getProducts();
  cartItems.forEach(it=>{
    const p = products.find(x=>x.id===it.id);
    if(p){ p.stock = Math.max(0, (Number(p.stock)||0) - Number(it.qty||0)); }
  });
  await window.saveProducts(products);

  const subtotal = cartItems.reduce((s,it)=> s + (Number(it.price||0) * Number(it.qty||0)), 0);
  const taxSum = cartItems.reduce((s,it)=> s + ((Number(it.price||0) * Number(it.qty||0)) * Number(it.taxPercent||0)/100), 0);
  const total = subtotal + taxSum - Number(discount||0);

  const sale = {
    invoiceNo: window.genInvoiceNo(),
    date: window.todayISO(),
    customer,
    items: cartItems.map(it=>({ 
      id: it.id, name: it.name, price: Number(it.price), qty: Number(it.qty), taxPercent: Number(it.taxPercent||0),
      taxAmount: (Number(it.price||0)*Number(it.qty||0)*Number(it.taxPercent||0)/100)
    })),
    subtotal, taxAmount: taxSum, discount: Number(discount||0), total, paymentMode
  };

  const sales = await window.getSales();
  sales.push(sale);
  await window.saveSales(sales);
  
  window.pushFullBackupToServerDebounced();
  return sale;
}


// ==========================================================
// 🏁 SYSTEM INIT & THEME APPLIER
// ==========================================================
window.toggleTheme = function() {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
}
window.applyTheme = function() {
  const theme = localStorage.getItem("theme");
  if (theme === "dark") { document.body.classList.add("dark"); }
}

window.applyShopDetails = function() {
  const name = localStorage.getItem("shopName");
  const phone = localStorage.getItem("shopPhone");
  const shopNameEls = document.querySelectorAll(".shop-name");
  const shopPhoneEls = document.querySelectorAll(".shop-phone");
  shopNameEls.forEach(el => { if (name) el.textContent = name; });
  shopPhoneEls.forEach(el => { if (phone) el.textContent = phone; });
};

(async function initBharatPOS(){
  // Apply visual configurations immediately
  window.applyTheme();
  document.addEventListener("DOMContentLoaded", window.applyShopDetails);

  // Initialize defaults if they do not exist
  if((await window.dbGet(LS_KEYS.SETTINGS, null)) === null) await window.saveSettings(await window.getSettings());
  if((await window.dbGet(LS_KEYS.PRODUCTS, null)) === null) await window.saveProducts([]);
  if((await window.dbGet(LS_KEYS.SALES, null)) === null) await window.saveSales([]);

  // On startup try to push any existing data silently
  try { setTimeout(()=> { window.pushProductsToServer(); window.pushCustomersToServer(); }, 1200); } catch(e){}
  try { setTimeout(()=> { window.pushFullBackupToServerDebounced(); }, 2000); } catch(e){}
})();
