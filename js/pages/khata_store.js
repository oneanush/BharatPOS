// File: /js/pages/khata_store.js

import { db } from '../core/firebase.js';
import { collection, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { Security } from '../utils/security.js';

let currentShopProducts = [];
let filteredProducts = [];
let activeCategory = 'ALL';
let cart = {}; 
let userMobile = '';

export async function initStore(phone) {
    userMobile = phone;
    
    window.onShopChanged = (shopId) => {
        if(document.getElementById('tab-store').classList.contains('active')) {
            loadShopCatalog(shopId);
        }
    };
    
    // Load initially based on Top Selector
    loadShopCatalog(window.KhataData.activeShopId);
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
            container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-sub); font-weight:700;">You don't have any associated shops to order from yet.</div>`;
            return;
        }
    }

    const shopName = window.KhataData.shopsMap[shopId]?.name || 'Local Store';

    container.innerHTML = `<div class="loader-screen"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p style="margin-top:12px; font-weight:700;">Loading Catalog...</p></div>`;
    
    try {
        const prodSnap = await getDocs(collection(db, "shops", shopId, "products"));
        currentShopProducts = [];
        const categories = new Set();

        prodSnap.forEach(d => {
            const p = d.data();
            currentShopProducts.push(p);
            if(p.category) categories.add(p.category);
        });

        filteredProducts = currentShopProducts;
        renderCatalogUI(container, shopId, shopName, Array.from(categories));
    } catch(e) {
        container.innerHTML = `<div style="text-align:center; padding:40px; color:#ef4444; font-weight:700;">Failed to load products.</div>`;
    }
}

function renderCatalogUI(container, shopId, shopName, categories) {
    const style = `
        <style>
            .search-bar { width: 100%; padding: 14px 16px 14px 44px; border-radius: 12px; border: 1px solid #e2e8f0; background: white; font-family: inherit; font-size: 14px; font-weight:600; outline: none; box-sizing: border-box; }
            .search-icon { position: absolute; left: 16px; top: 15px; color: var(--text-sub); }
            .cat-scroll { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 10px; margin: 16px 0; scrollbar-width: none; }
            .cat-scroll::-webkit-scrollbar { display: none; }
            .cat-chip { padding: 8px 16px; background: white; border: 1px solid #e2e8f0; border-radius: 20px; font-size: 12px; font-weight: 700; color: var(--text-sub); white-space: nowrap; cursor: pointer; transition: 0.2s;}
            .cat-chip.active { background: var(--brand-primary); color: white; border-color: var(--brand-primary); box-shadow: 0 4px 10px rgba(99,102,241,0.2);}
            
            .prod-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; padding-bottom: 80px;}
            .prod-item { background: white; padding: 12px; border-radius: 16px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 2px 8px rgba(0,0,0,0.02);}
            .btn-add { background: #e0e7ff; color: var(--brand-primary); border: none; padding: 8px; border-radius: 8px; font-weight: 800; font-size: 12px; cursor: pointer; width: 100%; margin-top: 10px; transition: 0.2s;}
            .btn-add:active { transform: scale(0.95); }
            
            .floating-cart { position: fixed; bottom: 80px; left: 16px; right: 16px; background: var(--text-main); color: white; padding: 16px; border-radius: 16px; display: none; justify-content: space-between; align-items: center; z-index: 1000; box-shadow: 0 10px 25px rgba(0,0,0,0.2);}
        </style>
    `;

    let html = style + `
        <div style="font-size:12px; font-weight:800; color:var(--brand-accent); text-transform:uppercase; margin-bottom:4px;">Currently Shopping At</div>
        <h3 style="margin:0 0 16px 0; font-family:var(--font-head); font-size:20px; color:var(--text-main);">${Security.escapeHtml(shopName)}</h3>

        <div style="position:relative;">
            <i class="fa-solid fa-magnifying-glass search-icon"></i>
            <input type="text" id="fuzzySearch" class="search-bar" placeholder="Search for items...">
        </div>

        <div class="cat-scroll" id="storeCats">
            <div class="cat-chip active" data-cat="ALL">All Items</div>
            ${categories.map(c => `<div class="cat-chip" data-cat="${Security.escapeHtml(c)}">${Security.escapeHtml(c)}</div>`).join('')}
        </div>

        <div class="prod-grid" id="storeProdGrid"></div>

        <div class="floating-cart" id="floatingCart">
            <div>
                <div style="font-size:11px; color:#94a3b8; font-weight:700; text-transform:uppercase;">Your Cart</div>
                <div style="font-size:16px; font-weight:800; font-family:'JetBrains Mono'; margin-top:2px;" id="cartTotalText">₹0</div>
            </div>
            <button id="btnPlaceOrder" style="background:var(--brand-accent); color:white; border:none; padding:10px 20px; border-radius:10px; font-weight:800; font-size:14px; cursor:pointer; box-shadow:0 4px 10px rgba(245, 158, 11, 0.3);">Place Order <i class="fa-solid fa-arrow-right"></i></button>
        </div>
    `;

    container.innerHTML = html;

    document.getElementById('fuzzySearch').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().replace(/\s+/g, '.*');
        const regex = new RegExp(query, 'i');
        filteredProducts = currentShopProducts.filter(p => {
            const matchName = regex.test((p.name || '').toLowerCase());
            const matchCat = activeCategory === 'ALL' || p.category === activeCategory;
            return matchName && matchCat;
        });
        renderProducts();
    });

    document.getElementById('storeCats').addEventListener('click', (e) => {
        if(e.target.classList.contains('cat-chip')) {
            document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            activeCategory = e.target.getAttribute('data-cat');
            
            const q = document.getElementById('fuzzySearch').value.toLowerCase().replace(/\s+/g, '.*');
            const regex = new RegExp(q, 'i');
            
            filteredProducts = currentShopProducts.filter(p => {
                const matchCat = activeCategory === 'ALL' || p.category === activeCategory;
                const matchName = regex.test((p.name || '').toLowerCase());
                return matchCat && matchName;
            });
            renderProducts();
        }
    });

    document.getElementById('btnPlaceOrder').addEventListener('click', () => placeOrder(shopId, shopName));
    renderProducts();
}

function renderProducts() {
    const grid = document.getElementById('storeProdGrid');
    if(!grid) return;

    if(filteredProducts.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#94a3b8; font-weight:600;">No items found.</div>`;
        return;
    }

    grid.innerHTML = filteredProducts.map(p => {
        const v = p.variants[0] || {};
        return `
        <div class="prod-item">
            <div>
                <div style="font-size:10px; color:var(--brand-primary); font-weight:800; text-transform:uppercase; margin-bottom:4px;">${Security.escapeHtml(p.category || 'General')}</div>
                <div style="font-size:13px; font-weight:800; color:var(--text-main); line-height:1.3;">${Security.escapeHtml(p.name)}</div>
                <div style="font-size:11px; color:var(--text-sub); font-weight:600; margin-top:4px;">${Security.escapeHtml(v.quantity)}</div>
            </div>
            <div>
                <div style="font-size:15px; font-weight:800; color:#10b981; font-family:'JetBrains Mono'; margin-top:8px;">₹${v.price}</div>
                <button class="btn-add" data-pid="${Security.escapeHtml(p.id)}" data-vid="${Security.escapeHtml(v.id)}" data-name="${Security.escapeHtml(p.name)}" data-price="${v.price}">+ Add to Cart</button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.btn-add').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const b = e.currentTarget;
            const key = `${b.dataset.pid}_${b.dataset.vid}`;
            if(cart[key]) {
                cart[key].qty += 1;
            } else {
                cart[key] = { prodId: b.dataset.pid, variantId: b.dataset.vid, name: b.dataset.name, price: parseFloat(b.dataset.price), qty: 1 };
            }
            if (navigator.vibrate) navigator.vibrate(50);
            updateCartUI();
        });
    });
}

function updateCartUI() {
    const fab = document.getElementById('floatingCart');
    const txt = document.getElementById('cartTotalText');
    if(!fab || !txt) return;

    let total = 0, items = 0;
    Object.values(cart).forEach(item => { total += item.price * item.qty; items += item.qty; });

    if(items > 0) {
        txt.innerText = `${items} Items | ₹${total.toFixed(2)}`;
        fab.style.display = 'flex';
    } else {
        fab.style.display = 'none';
    }
}

async function placeOrder(shopId, shopName) {
    if(Object.keys(cart).length === 0) return;

    const btn = document.getElementById('btnPlaceOrder');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`; btn.disabled = true;

    try {
        let total = 0;
        const itemsArr = Object.values(cart).map(i => { total += i.price * i.qty; return i; });

        const order = {
            date: new Date().toISOString(),
            customerMobile: userMobile,
            customerName: "Khata App User",
            status: "PENDING",
            totalAmount: total,
            items: itemsArr
        };

        await addDoc(collection(db, "shops", shopId, "onlineOrders"), order);
        alert("Order sent to shop successfully! They will contact you shortly.");
        cart = {}; updateCartUI();
    } catch(e) {
        alert("Failed to send order. Check your internet connection.");
    } finally {
        btn.innerHTML = `Place Order <i class="fa-solid fa-arrow-right"></i>`; btn.disabled = false;
    }
}