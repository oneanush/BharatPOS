// File: /js/pages/khata_store.js

import { db } from '../core/firebase.js';
import { collection, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { Security } from '../utils/security.js';

// --- ENCAPSULATED STATE ---
let currentShopProducts = [];
let filteredProducts = [];
let activeCategory = 'ALL';
let cart = {}; 
let userMobile = '';
let wizState = { prod: null, variant: null, brand: null, qty: 1 };

// --- INITIALIZATION ---
export async function initStore(phone) {
    userMobile = phone;
    
    // Allow the main tab switcher to trigger a refresh
    window.refreshKhataStore = () => {
        if(document.getElementById('tab-store').classList.contains('active')) {
            loadShopCatalog(window.KhataData?.activeShopId);
        }
    };
    
    // Bind all static modal and button events once
    bindWizardEvents();

    // Initial load
    loadShopCatalog(window.KhataData?.activeShopId);
}

// --- DATA ENGINE ---
async function loadShopCatalog(shopId) {
    const container = document.getElementById('storeContent');
    if(!container) return;
    
    // Auto-select the first available shop if 'ALL' or null is passed
    if(!shopId || shopId === 'ALL') {
        const firstShop = Object.keys(window.KhataData?.shopsMap || {})[0];
        if(firstShop) {
            const globalSelect = document.getElementById('globalShopSelect');
            if(globalSelect) globalSelect.value = firstShop;
            window.KhataData.activeShopId = firstShop;
            shopId = firstShop;
        } else {
            container.innerHTML = `<div style="text-align:center; padding:50px; color:var(--text-muted); font-weight:700;"><i class="fa-solid fa-store-slash fa-2x"></i><br><br>No shop is linked to your Khata yet.</div>`;
            return;
        }
    }

    container.innerHTML = `<div style="text-align:center; padding:50px; color:var(--primary);"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br><br>Loading catalog...</div>`;

    try {
        const snap = await getDocs(collection(db, "shops", shopId, "products"));
        currentShopProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        filteredProducts = [...currentShopProducts];
        
        renderCategories();
        renderProducts();
    } catch(e) {
        console.error("Store Load Error:", e);
        container.innerHTML = `<div style="text-align:center; padding:50px; color:var(--danger); font-weight:700;"><i class="fa-solid fa-triangle-exclamation fa-2x"></i><br><br>Failed to load catalog. Check connection.</div>`;
    }
}

// --- UI RENDERERS ---
function renderCategories() {
    const catContainer = document.getElementById('storeCategories');
    if(!catContainer) return;

    const categories = new Set(currentShopProducts.map(p => p.category || 'Uncategorized'));
    
    let html = `<button class="chip ${activeCategory === 'ALL' ? 'active' : ''}" data-cat="ALL">All Items</button>`;
    categories.forEach(c => {
        html += `<button class="chip ${activeCategory === c ? 'active' : ''}" data-cat="${Security.escapeHtml(c)}">${Security.escapeHtml(c)}</button>`;
    });

    catContainer.innerHTML = html;

    catContainer.querySelectorAll('.chip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            catContainer.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeCategory = e.target.getAttribute('data-cat');
            
            if(activeCategory === 'ALL') filteredProducts = currentShopProducts;
            else filteredProducts = currentShopProducts.filter(p => p.category === activeCategory);
            
            renderProducts();
        });
    });
}

function renderProducts() {
    const grid = document.getElementById('storeContent');
    if(!grid) return;
    grid.innerHTML = '';

    // 1. INJECT THE PREMIUM SERVICE REQUEST CARD FIRST
    const serviceCard = document.createElement('div');
    serviceCard.innerHTML = `
        <div class="product-card" style="display:flex; flex-direction:column; overflow:hidden; border:2px dashed var(--primary); border-radius:16px; background:#eff6ff; cursor:pointer; transition:0.2s; height:100%; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.1);" onclick="addCustomService()">
            <div style="height:140px; display:flex; align-items:center; justify-content:center; color:var(--primary); font-size:48px;">
                <i class="fa-solid fa-screwdriver-wrench"></i>
            </div>
            <div style="padding:16px; display:flex; flex-direction:column; flex:1; text-align:center;">
                <div style="font-size:16px; font-weight:800; color:var(--primary); margin-bottom:4px;">Request a Service</div>
                <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:12px;">Fan Repair, Plumbing, Custom List...</div>
                <button class="btn-main" style="margin-top:auto; padding:8px 16px; border-radius:100px; font-size:13px; background:var(--primary); color:white; border:none;">Request Now <i class="fa-solid fa-arrow-right"></i></button>
            </div>
        </div>
    `;
    grid.appendChild(serviceCard.firstElementChild);

    // 2. RENDER PHYSICAL PRODUCTS
    if(filteredProducts.length === 0 && currentShopProducts.length > 0) {
        grid.innerHTML += `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted); font-weight:700;">No items found in this category.</div>`;
        return;
    }

    filteredProducts.forEach(p => {
        let minPrice = Infinity;
        (p.variants || []).forEach(v => { if(Number(v.price) < minPrice) minPrice = Number(v.price); });
        if(minPrice === Infinity) minPrice = 0;

        const el = document.createElement('div');
        el.innerHTML = `
            <div class="product-card" style="display:flex; flex-direction:column; overflow:hidden; border:1.5px solid var(--border); border-radius:16px; background:white; box-shadow:0 4px 10px rgba(0,0,0,0.03); height:100%;">
                <div style="height:140px; background:linear-gradient(135deg, #f8fafc, #f1f5f9); display:flex; align-items:center; justify-content:center; color:#cbd5e1; font-size:48px;">
                    <i class="fa-solid fa-box-open"></i>
                </div>
                <div style="padding:16px; display:flex; flex-direction:column; flex:1;">
                    <div style="font-size:10px; font-weight:800; color:var(--primary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">${Security.escapeHtml(p.category || 'Item')}</div>
                    <div style="font-size:15px; font-weight:800; color:var(--text-main); margin-bottom:8px; line-height:1.3; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${Security.escapeHtml(p.name)}</div>
                    
                    <div style="margin-top:auto; display:flex; justify-content:space-between; align-items:center; padding-top:10px; border-top:1px dashed var(--border);">
                        <div style="font-size:16px; font-weight:800; color:var(--success); font-family:'JetBrains Mono';">₹${minPrice.toFixed(2)}</div>
                        <button class="btn-main" style="padding:6px 14px; border-radius:100px; font-size:12px; border:none; background:var(--primary); color:white; cursor:pointer;" onclick="openStoreWizard('${p.id}')">Add <i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(el.firstElementChild);
    });
}

// --- WIZARD & CART LOGIC ---
window.openStoreWizard = (prodId) => {
    const prod = currentShopProducts.find(p => p.id === prodId);
    if(!prod) return;

    wizState = { prod: prod, variant: null, brand: null, qty: 1 };
    
    document.getElementById('wizardStepVariant').style.display = 'block';
    document.getElementById('wizardStepBrand').style.display = 'none';
    document.getElementById('wizardStepQty').style.display = 'none';

    const vGrid = document.getElementById('wizardVariantGrid');
    vGrid.innerHTML = prod.variants.map((v, idx) => `
        <div class="wizard-option" onclick="selectWizVariant(${idx})" style="padding:15px; border:1.5px solid var(--border); border-radius:12px; text-align:center; cursor:pointer; background:white;">
            <div style="font-weight:800; color:var(--text-main);">${Security.escapeHtml(String(v.quantity))}</div>
            <div style="font-size:14px; color:var(--primary); font-weight:800; margin-top:6px; font-family:'JetBrains Mono';">₹${v.price}</div>
        </div>
    `).join('');

    document.getElementById('storeWizardModal').style.display = 'flex';
};

window.selectWizVariant = (idx) => {
    const variant = wizState.prod.variants[idx];
    wizState.variant = variant;

    if(variant.brands && variant.brands.length > 0) {
        document.getElementById('wizardStepVariant').style.display = 'none';
        document.getElementById('wizardStepBrand').style.display = 'block';
        
        const bGrid = document.getElementById('wizardBrandGrid');
        bGrid.innerHTML = variant.brands.map((b, bIdx) => `
            <div class="wizard-option" onclick="selectWizBrand(${bIdx})" style="padding:15px; border:1.5px solid var(--border); border-radius:12px; text-align:center; cursor:pointer; background:white;">
                <div style="font-weight:800; color:var(--text-main);">${Security.escapeHtml(b.name)}</div>
            </div>
        `).join('');
    } else {
        window.goToWizQty();
    }
};

window.selectWizBrand = (idx) => {
    wizState.brand = wizState.variant.brands[idx].name;
    window.goToWizQty();
};

window.goToWizQty = () => {
    document.getElementById('wizardStepVariant').style.display = 'none';
    document.getElementById('wizardStepBrand').style.display = 'none';
    document.getElementById('wizardStepQty').style.display = 'block';
    
    wizState.qty = 1;
    document.getElementById('wizQtyDisplay').innerText = wizState.qty;
};

// --- CUSTOM SERVICE HANDLER ---
window.addCustomService = () => {
    const serviceName = prompt("Enter the service you need (e.g., Fan Repair, Plumbing, Custom Grocery List):");
    if(!serviceName || serviceName.trim() === '') return;
    
    const serviceId = 'srv_' + Date.now();
    cart[serviceId] = {
        id: serviceId,
        name: "Service Request: " + serviceName,
        price: 0, 
        qty: 1,
        isService: true
    };
    
    window.updateCartUI();
    alert(serviceName + " added to your request list!");
};

// --- EVENTS AND UI UPDATES ---
function bindWizardEvents() {
    document.getElementById('wizClose')?.addEventListener('click', () => {
        document.getElementById('storeWizardModal').style.display = 'none';
    });

    document.getElementById('wizQtyMinus')?.addEventListener('click', () => {
        if(wizState.qty > 1) { wizState.qty--; document.getElementById('wizQtyDisplay').innerText = wizState.qty; }
    });

    document.getElementById('wizQtyPlus')?.addEventListener('click', () => {
        wizState.qty++; document.getElementById('wizQtyDisplay').innerText = wizState.qty;
    });

    document.getElementById('wizAddToCart')?.addEventListener('click', () => {
        const p = wizState.prod;
        const v = wizState.variant;
        const b = wizState.brand;
        const q = wizState.qty;

        const cartId = `${p.id}_${v.id}_${b || 'none'}`;
        const displayName = b ? `${p.name} (${v.quantity}) - ${b}` : `${p.name} (${v.quantity})`;

        if(cart[cartId]) cart[cartId].qty += q;
        else cart[cartId] = { id: cartId, prodId: p.id, name: displayName, price: Number(v.price), qty: q };

        window.updateCartUI();
        document.getElementById('storeWizardModal').style.display = 'none';
    });

    document.getElementById('fabCart')?.addEventListener('click', () => {
        const modal = document.getElementById('cartWizModal');
        const list = document.getElementById('cartWizItems');
        if(!modal || !list) return;
        
        list.innerHTML = Object.values(cart).map(item => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:15px; background:#f8fafc; border:1px solid var(--border); border-radius:12px; margin-bottom:10px;">
                <div>
                    <div style="font-weight:800; font-size:14px; color:var(--text-main);">${Security.escapeHtml(item.name)}</div>
                    <div style="font-size:13px; color:var(--primary); font-weight:800; margin-top:4px; font-family:'JetBrains Mono';">
                        ${item.isService ? '<span style="color:var(--text-muted);">Price set by merchant</span>' : `₹${item.price.toFixed(2)} x ${item.qty}`}
                    </div>
                </div>
                <button onclick="removeFromCart('${item.id}')" style="background:#fee2e2; border:none; color:var(--danger); width:36px; height:36px; border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
            </div>
        `).join('');

        modal.style.display = 'flex';
    });

    document.getElementById('btnCartClose')?.addEventListener('click', () => {
        document.getElementById('cartWizModal').style.display = 'none';
    });

    document.getElementById('btnPlaceOrder')?.addEventListener('click', placeOrder);
}

window.removeFromCart = (cartId) => {
    delete cart[cartId];
    window.updateCartUI();
    const fab = document.getElementById('fabCart');
    if(fab && fab.style.display !== 'none') fab.click(); // Refresh modal view
};

window.updateCartUI = () => {
    const fab = document.getElementById('fabCart');
    const txt = document.getElementById('fabCartText');
    if(!fab || !txt) return;

    let total = 0, items = 0;
    Object.values(cart).forEach(item => { 
        total += (item.price * item.qty); 
        items += item.qty; 
    });

    if(items > 0) {
        const hasService = Object.values(cart).some(i => i.isService);
        txt.innerText = hasService ? `${items} Items/Services added` : `${items} Items | ₹${total.toFixed(2)}`;
        fab.style.display = 'flex';
    } else {
        fab.style.display = 'none';
        const modal = document.getElementById('cartWizModal');
        if(modal) modal.style.display = 'none';
    }
};

// --- FIREBASE ORDER SUBMISSION ---
async function placeOrder() {
    // 1. Secure Shop ID Validation
    const shopId = window.KhataData?.activeShopId;
    if (!shopId || shopId === 'ALL') {
        return alert("Please select a specific shop from the top dropdown before placing your order.");
    }

    if(Object.keys(cart).length === 0) return;

    const btn = document.getElementById('btnPlaceOrder');
    if(btn) { btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`; btn.disabled = true; }

    const hasService = Object.values(cart).some(i => i.isService);
    const orderType = hasService ? "Service Request" : "Home Delivery";

    // 2. Fetch Live Location (Silently fails if blocked)
    let location = null;
    try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, {timeout:5000}));
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch(e) {
        console.warn("Location permission denied or timeout");
    }

    // 3. Build & Send Payload
    try {
        let total = 0;
        const itemsArr = Object.values(cart).map(i => { total += (i.price * i.qty); return i; });

        const order = {
            date: new Date().toISOString(),
            customerMobile: userMobile,
            customerName: "Khata App User",
            status: "PENDING",
            orderType: orderType,
            location: location,
            totalAmount: total,
            items: itemsArr
        };

        // Sends to Firebase exactly where the Merchant's online_orders.js is listening!
        await addDoc(collection(db, "shops", shopId, "onlineOrders"), order);
        
        alert("Request sent successfully! The merchant will process your request shortly.");
        
        // Clear cart and close modals
        cart = {}; 
        window.updateCartUI();
        const modal = document.getElementById('cartWizModal');
        if(modal) modal.style.display = 'none';
        
    } catch (error) {
        console.error("Order Error:", error);
        alert("Failed to send request. Please check your internet connection and try again.");
    } finally {
        if(btn) { btn.innerHTML = `Place Order`; btn.disabled = false; }
    }
}