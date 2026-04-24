// File: /js/pages/khata_store.js

import { db } from '../core/firebase.js';
import { collection, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { Security } from '../utils/security.js';

let currentShopProducts = [];
let filteredProducts = [];
let activeCategory = 'ALL';
let cart = {}; 
let userMobile = '';

let wizState = { prod: null, variant: null, brand: null, qty: 1 };

export async function initStore(phone) {
    userMobile = phone;
    
    window.refreshKhataStore = () => {
        if(document.getElementById('tab-store').classList.contains('active')) {
            loadShopCatalog(window.KhataData.activeShopId);
        }
    };
    
    loadShopCatalog(window.KhataData.activeShopId);
    bindWizardEvents();
}

async function loadShopCatalog(shopId) {
    const container = document.getElementById('storeContent');
    
    if(!shopId || shopId === 'ALL') {
        const firstShop = Object.keys(window.KhataData.shopsMap)[0];
        if(firstShop) {
            document.getElementById('globalShopSelect').value = firstShop;
            window.KhataData.activeShopId = firstShop;
            shopId = firstShop;
        } else {
            container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-sub);">No shops linked to your Khata yet.</div>`;
            return;
        }
    }

    container.innerHTML = `<div style="text-align:center; padding:40px;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i></div>`;

    try {
        const snap = await getDocs(collection(db, "shops", shopId, "products"));
        currentShopProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        filteredProducts = [...currentShopProducts];
        
        renderCategories();
        renderProducts();
    } catch(e) {
        console.error("Store Load Error:", e);
        container.innerHTML = `<div style="text-align:center; padding:40px; color:red;">Failed to load catalog.</div>`;
    }
}

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
    grid.innerHTML = '';

    // --- NEW FEATURE: DEDICATED SERVICE REQUEST CARD ---
    // This card always stays at the top of the store, allowing custom service requests.
    const serviceCard = document.createElement('div');
    serviceCard.className = 'product-card';
    serviceCard.style.border = '2px dashed var(--brand-primary)';
    serviceCard.innerHTML = `
        <div style="background:#e0e7ff; color:var(--brand-primary); height:120px; display:flex; align-items:center; justify-content:center; font-size:40px;">
            <i class="fa-solid fa-screwdriver-wrench"></i>
        </div>
        <div class="p-15">
            <div style="font-weight:800; font-size:15px; color:var(--text-main);">Request a Service</div>
            <div style="font-size:12px; color:var(--text-sub); margin-top:4px;">Fan Repair, Electrician, Plumber, etc.</div>
            <button class="btn-main" style="width:100%; margin-top:10px; padding:8px;" onclick="addCustomService()">Add Service</button>
        </div>
    `;
    grid.appendChild(serviceCard);

    // Render standard physical products
    if(filteredProducts.length === 0) {
        grid.innerHTML += `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-sub);">No items found in this category.</div>`;
        return;
    }

    filteredProducts.forEach(p => {
        let minPrice = Infinity;
        (p.variants || []).forEach(v => { if(v.price < minPrice) minPrice = v.price; });
        if(minPrice === Infinity) minPrice = 0;

        const el = document.createElement('div');
        el.className = 'product-card';
        el.innerHTML = `
            <div style="background:#f1f5f9; height:120px; display:flex; align-items:center; justify-content:center; font-size:40px; color:#cbd5e1;">
                <i class="fa-solid fa-box"></i>
            </div>
            <div class="p-15">
                <div style="font-size:10px; font-weight:800; color:var(--brand-primary); text-transform:uppercase; margin-bottom:4px;">${Security.escapeHtml(p.category)}</div>
                <div style="font-weight:800; font-size:15px; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${Security.escapeHtml(p.name)}</div>
                <div style="font-size:16px; font-weight:800; color:var(--text-main); margin-top:8px;">Starts ₹${minPrice}</div>
                <button class="btn-main" style="width:100%; margin-top:10px; padding:8px;" onclick="openStoreWizard('${p.id}')">Select</button>
            </div>
        `;
        grid.appendChild(el);
    });
}

// --- GLOBAL ATTACHMENTS FOR INLINE HTML CLICKS ---
window.openStoreWizard = (prodId) => {
    const prod = currentShopProducts.find(p => p.id === prodId);
    if(!prod) return;

    wizState = { prod: prod, variant: null, brand: null, qty: 1 };
    
    document.getElementById('wizardStepVariant').style.display = 'block';
    document.getElementById('wizardStepBrand').style.display = 'none';
    document.getElementById('wizardStepQty').style.display = 'none';

    const vGrid = document.getElementById('wizardVariantGrid');
    vGrid.innerHTML = prod.variants.map((v, idx) => `
        <div class="wizard-option" onclick="selectWizVariant(${idx})">
            <div style="font-weight:800; color:var(--text-main);">${Security.escapeHtml(v.quantity)}</div>
            <div style="font-size:12px; color:var(--brand-primary); font-weight:800; margin-top:4px;">₹${v.price}</div>
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
            <div class="wizard-option" onclick="selectWizBrand(${bIdx})">
                <div style="font-weight:800; color:var(--text-main);">${Security.escapeHtml(b.name)}</div>
            </div>
        `).join('');
    } else {
        goToWizQty();
    }
};

window.selectWizBrand = (idx) => {
    wizState.brand = wizState.variant.brands[idx].name;
    goToWizQty();
};

function goToWizQty() {
    document.getElementById('wizardStepVariant').style.display = 'none';
    document.getElementById('wizardStepBrand').style.display = 'none';
    document.getElementById('wizardStepQty').style.display = 'block';
    
    wizState.qty = 1;
    document.getElementById('wizQtyDisplay').innerText = wizState.qty;
}

// NEW: Handle Custom Service Addition
window.addCustomService = () => {
    const serviceName = prompt("Enter the service you need (e.g., Fan Repair, Plumbing, Custom Grocery List):");
    if(!serviceName || serviceName.trim() === '') return;
    
    const serviceId = 'srv_' + Date.now();
    cart[serviceId] = {
        id: serviceId,
        name: "Service: " + serviceName,
        price: 0, // Merchant decides price later
        qty: 1,
        isService: true
    };
    
    updateCartUI();
    alert(serviceName + " added to your request!");
};

function bindWizardEvents() {
    document.getElementById('wizClose').addEventListener('click', () => {
        document.getElementById('storeWizardModal').style.display = 'none';
    });

    document.getElementById('wizQtyMinus').addEventListener('click', () => {
        if(wizState.qty > 1) { wizState.qty--; document.getElementById('wizQtyDisplay').innerText = wizState.qty; }
    });

    document.getElementById('wizQtyPlus').addEventListener('click', () => {
        wizState.qty++; document.getElementById('wizQtyDisplay').innerText = wizState.qty;
    });

    document.getElementById('wizAddToCart').addEventListener('click', () => {
        const p = wizState.prod;
        const v = wizState.variant;
        const b = wizState.brand;
        const q = wizState.qty;

        const cartId = `${p.id}_${v.id}_${b || 'none'}`;
        const displayName = b ? `${p.name} (${v.quantity}) - ${b}` : `${p.name} (${v.quantity})`;

        if(cart[cartId]) cart[cartId].qty += q;
        else {
            cart[cartId] = { id: cartId, prodId: p.id, name: displayName, price: v.price, qty: q };
        }

        updateCartUI();
        document.getElementById('storeWizardModal').style.display = 'none';
    });

    document.getElementById('fabCart').addEventListener('click', () => {
        const modal = document.getElementById('cartWizModal');
        const list = document.getElementById('cartWizItems');
        
        list.innerHTML = Object.values(cart).map(item => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; background:#f8fafc; border-radius:12px; margin-bottom:10px;">
                <div>
                    <div style="font-weight:800; font-size:14px; color:var(--text-main);">${Security.escapeHtml(item.name)}</div>
                    <div style="font-size:12px; color:var(--brand-primary); font-weight:800; margin-top:4px;">
                        ${item.isService ? 'Price to be decided' : `₹${item.price} x ${item.qty}`}
                    </div>
                </div>
                <button onclick="removeFromCart('${item.id}')" style="background:transparent; border:none; color:var(--danger); font-size:18px; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
            </div>
        `).join('');

        modal.style.display = 'flex';
    });

    document.getElementById('btnCartClose').addEventListener('click', () => {
        document.getElementById('cartWizModal').style.display = 'none';
    });

    // BUG FIX: Securely pass the activeShopId without passing the event object!
    document.getElementById('btnPlaceOrder').addEventListener('click', async () => {
        const shopId = window.KhataData.activeShopId;
        if (!shopId || shopId === 'ALL') {
            return alert("Please select a specific shop from the top dropdown before ordering.");
        }
        await placeOrder(shopId);
    });
}

window.removeFromCart = (cartId) => {
    delete cart[cartId];
    updateCartUI();
    document.getElementById('fabCart').click(); // Re-render modal
};

function updateCartUI() {
    const fab = document.getElementById('fabCart');
    const txt = document.getElementById('fabCartText');
    if(!fab || !txt) return;

    let total = 0, items = 0;
    Object.values(cart).forEach(item => { 
        total += item.price * item.qty; 
        items += item.qty; 
    });

    if(items > 0) {
        // Hide total price if it contains unpriced services
        const hasService = Object.values(cart).some(i => i.isService);
        txt.innerText = hasService ? `${items} Items / Services` : `${items} Items | ₹${total.toFixed(2)}`;
        fab.style.display = 'flex';
    } else {
        fab.style.display = 'none';
        document.getElementById('cartWizModal').style.display = 'none';
    }
}

async function placeOrder(shopId) {
    if(Object.keys(cart).length === 0) return;

    const btn = document.getElementById('btnPlaceOrder');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`; 
    btn.disabled = true;

    // Determine type automatically based on cart contents
    const hasService = Object.values(cart).some(i => i.isService);
    const orderType = hasService ? "Service & Items" : "Home Delivery";

    let location = null;
    try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, {timeout:5000}));
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch(e) {
        console.warn("Location not provided");
    }

    try {
        let total = 0;
        const itemsArr = Object.values(cart).map(i => { total += i.price * i.qty; return i; });

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

        // This path exactly matches your merchant's listener in online_orders.js!
        await addDoc(collection(db, "shops", shopId, "onlineOrders"), order);
        
        alert("Request sent successfully! The merchant has received your order on their dashboard.");
        cart = {}; 
        updateCartUI();
        document.getElementById('cartWizModal').style.display = 'none';
        
    } catch (error) {
        console.error("Order Error:", error);
        alert("Failed to send request. Check your internet connection.");
    } finally {
        btn.innerHTML = `Place Order`; 
        btn.disabled = false;
    }
}