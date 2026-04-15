// File: /js/pages/billing.js

import { db } from '../core/firebase.js';
import { collection, doc, runTransaction, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { dbGet, dbSave } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';
import { Security } from '../utils/security.js';
import { Formatters } from '../utils/formatters.js';

// --- ENCAPSULATED STATE ---
let allProducts = [];
let customers = [];
let cart = [];
let heldCarts = [];
let onlineOrders = [];

let currentCustomer = { name: '', phone: '' };
let activeCategory = 'ALL';
let configState = { prod: null, step: 'variant', selectedVariant: null, selectedBrand: null };
let currentPaymentMode = 'Cash';
let partialSplitData = null;

// --- INITIALIZATION ---
async function initBilling() {
    Navigation.inject('billing');

    try {
        // Fetch cached offline data
        let rawProducts = await dbGet('bharatpos_products', '[]');
        
        // Legacy Migration Shield
        allProducts = rawProducts.map(p => {
            if (!p.variants || !Array.isArray(p.variants) || p.variants.length === 0) {
                p.variants = [{
                    id: p.id + '_v0', quantity: p.quantity || '1 pcs', price: Number(p.price) || 0,
                    stock: Number(p.stock) || 0, barcode: p.barcode || '', baseQty: 1, baseUnit: 'pcs'
                }];
            }
            return p;
        });

        customers = await dbGet('bharatpos_customers', '[]');
        heldCarts = await dbGet('bharatpos_held_carts', '[]');
        
        // Sort by popularity (derived from sales)
        const sales = await dbGet('bharatpos_sales', '[]');
        const freqs = {};
        sales.forEach(s => (s.items||[]).forEach(i => freqs[i.id] = (freqs[i.id]||0) + (i.qty||1)));
        allProducts.sort((a,b) => (freqs[b.id]||0) - (freqs[a.id]||0));

        bindAllEvents();
        renderCategories();
        renderProductGrid();
        renderCart();
        setupMobileCartSwipe();

        const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
        
        // Online Orders Background Listener
        if(user.merchantId && db) {
            onSnapshot(collection(db, "shops", user.merchantId, "onlineOrders"), (snap) => {
                onlineOrders = snap.docs.map(d => ({...d.data(), orderId: d.id}));
                const badge = document.getElementById('onlineBadge');
                const btn = document.getElementById('btnOnlineOrders');
                if(badge) badge.innerText = onlineOrders.length;
                if(btn) {
                    if(onlineOrders.length > 0) btn.classList.add('active');
                    else btn.classList.remove('active');
                }
            });
        }
    } catch (err) {
        console.error("Init Error:", err);
        UI.showToast("Initialization error. Check console.", true);
    }
}

// --- UTILS ---
function getUnitPrice(prod, variant) {
    if (!prod.isLoose) return Number(variant.price);
    const baseQty = Number(variant.baseQty) || 1;
    return Number(variant.price) / baseQty;
}

function getUnitLabel(prod, variant) {
    if (!prod.isLoose) return 'unit';
    return variant.baseUnit || 'unit';
}

function getVariantStockInfo(p, v) {
    if (p.isLoose) {
        const bq = Number(v.baseQty) || 1;
        const totalBase = (Number(v.stock) || 0) * bq;
        return { available: totalBase, label: v.baseUnit || 'pcs', isLoose: true };
    } else {
        return { available: Number(v.stock) || 0, label: 'units', isLoose: false };
    }
}

function getProductTotalStockInfo(p) {
    const variants = p.variants || [];
    if (variants.length === 0) return `${p.stock || 0} in stock`;

    if (p.isLoose) {
        let totalBase = 0;
        let unit = variants[0]?.baseUnit || 'units';
        variants.forEach(v => {
            const bq = Number(v.baseQty) || 1;
            totalBase += (Number(v.stock) || 0) * bq;
        });
        return `${Formatters.stock(totalBase, unit)} ${unit}`;
    } else {
        let total = 0;
        variants.forEach(v => total += Number(v.stock) || 0);
        return `${total} in stock`;
    }
}

// --- EVENT BINDING ---
function bindAllEvents() {
    // Multi-Branch Shop Switcher Binding
    const switcher = document.getElementById('globalShopSwitcher');
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const storedShopsStr = localStorage.getItem(`bharatpos_shops_${user.mobile || user.phone}`);
    if (switcher && storedShopsStr) {
        try {
            const shops = JSON.parse(storedShopsStr);
            if(shops && shops.length > 1) {
                switcher.style.display = 'inline-block';
                switcher.innerHTML = shops.map(s => 
                    `<option value="${s.merchantId}" ${s.merchantId === user.merchantId ? 'selected' : ''}>
                        ${Security.escapeHtml(s.shopName)} ${s.isMain ? '⭐' : ''}
                    </option>`
                ).join('');
                switcher.addEventListener('change', (e) => {
                    if(e.target.value !== user.merchantId) { window.location.reload(); }
                });
            }
        } catch(e) {}
    }

    document.getElementById('btnOnlineOrders')?.addEventListener('click', showOnlineOrders);

    document.getElementById('mobileCartFab')?.addEventListener('click', () => {
        document.getElementById('rightPane').classList.add('open');
        const closeBtn = document.getElementById('btnCloseMobileCart');
        if(closeBtn) closeBtn.style.display = 'block';
    });
    document.getElementById('btnCloseMobileCart')?.addEventListener('click', () => {
        document.getElementById('rightPane').classList.remove('open');
        document.getElementById('btnCloseMobileCart').style.display = 'none';
    });

    document.getElementById('prodSearchInput')?.addEventListener('input', renderProductGrid);
    document.getElementById('catTabs')?.addEventListener('click', (e) => {
        if(e.target.classList.contains('cat-chip')) {
            document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            activeCategory = e.target.getAttribute('data-cat');
            renderProductGrid();
        }
    });

    document.getElementById('productGrid')?.addEventListener('click', (e) => {
        if(e.target.closest('.pc-info-btn')) {
            const card = e.target.closest('.prod-card');
            if(card) openProductInfo(card.getAttribute('data-id'));
            return; 
        }
        const card = e.target.closest('.prod-card');
        if(card) openAddToCartWizard(card.getAttribute('data-id'));
    });

    // Customer Auto-suggest
    const cName = document.getElementById('custNameInput');
    const cPhone = document.getElementById('custPhoneInput');
    const dName = document.getElementById('custNameDropdown');
    const dPhone = document.getElementById('custPhoneDropdown');

    if(cName && cPhone && dName && dPhone) {
        const handleSearch = (e, drop) => {
            const val = e.target.value.toLowerCase().trim();
            currentCustomer.name = cName.value;
            currentCustomer.phone = cPhone.value;
            
            if(!val) { drop.style.display = 'none'; return; }
            const matches = customers.filter(c => {
                const phoneVal = c.phone || c.mobile || '';
                const nameVal = c.name || '';
                return nameVal.toLowerCase().includes(val) || phoneVal.includes(val);
            }).slice(0, 5);

            if(matches.length > 0) {
                drop.innerHTML = matches.map(c => {
                    const phoneVal = c.phone || c.mobile || '';
                    return `<div class="cust-option" data-name="${Security.escapeHtml(c.name)}" data-phone="${Security.escapeHtml(phoneVal)}"><span>${Security.escapeHtml(c.name)}</span><span style="color:var(--text-muted);">${Security.escapeHtml(phoneVal)}</span></div>`;
                }).join('');
                drop.style.display = 'block';
            } else {
                drop.style.display = 'none';
            }
        };
        cName.addEventListener('input', (e) => handleSearch(e, dName));
        cPhone.addEventListener('input', (e) => handleSearch(e, dPhone));

        const handleSelect = (e, drop) => {
            const opt = e.target.closest('.cust-option');
            if(opt) {
                currentCustomer = { name: opt.getAttribute('data-name'), phone: opt.getAttribute('data-phone') };
                cName.value = currentCustomer.name;
                cPhone.value = currentCustomer.phone;
                drop.style.display = 'none';
            }
        };
        dName.addEventListener('click', (e) => handleSelect(e, dName));
        dPhone.addEventListener('click', (e) => handleSelect(e, dPhone));

        document.addEventListener('click', (e) => { 
            if(e.target !== cName && e.target !== dName) dName.style.display = 'none'; 
            if(e.target !== cPhone && e.target !== dPhone) dPhone.style.display = 'none'; 
        });
    }

    // Wizard Flow Events
    document.getElementById('btnCloseConf')?.addEventListener('click', () => { UI.hideModal('addToCartModal'); });
    document.getElementById('btnConfBack')?.addEventListener('click', wizardBack);
    document.getElementById('confVariantGrid')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-step');
        if(btn) wizardSelectVariant(btn.getAttribute('data-vid'));
    });
    document.getElementById('confBrandGrid')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-step');
        if(btn) wizardSelectBrand(btn.getAttribute('data-bname'));
    });
    
    document.getElementById('confPresetContainer')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-preset');
        if(btn) {
            document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const customQty = document.getElementById('confCustomQty');
            if(customQty) customQty.value = btn.getAttribute('data-val');
            recalcConfigTotal();
        }
    });
    document.getElementById('confCustomQty')?.addEventListener('input', () => {
        document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
        recalcConfigTotal();
    });
    document.getElementById('btnConfirmAddToCart')?.addEventListener('click', confirmAddToCart);

    // Cart Controls
    document.getElementById('cartItemsList')?.addEventListener('click', (e) => {
        const idx = e.target.closest('[data-idx]')?.getAttribute('data-idx');
        if(idx === undefined) return;
        
        if(e.target.closest('.ci-del')) {
            cart.splice(idx, 1);
            renderCart();
        } else if(e.target.closest('.ci-plus')) {
            const cartItem = cart[idx];
            const p = allProducts.find(prod => prod.id === cartItem.prodId);
            const v = p.variants.find(vx => vx.id === cartItem.id);
            const stockInfo = getVariantStockInfo(p, v);
            
            let maxAvail = stockInfo.available;
            if (cartItem.brand && v.brands) {
                const b = v.brands.find(bx => bx.name === cartItem.brand);
                if (b) {
                    maxAvail = Number(b.stock) || 0;
                    if(p.isLoose) maxAvail = maxAvail * (Number(v.baseQty) || 1);
                }
            }

            if (cartItem.qty + 1 > maxAvail) {
                return UI.showToast(`Max stock reached! Only ${Formatters.stock(maxAvail, stockInfo.label)} ${stockInfo.label} available.`, true);
            }
            
            cartItem.qty += 1;
            cartItem.total = cartItem.qty * cartItem.unitPrice;
            renderCart();
        } else if(e.target.closest('.ci-minus')) {
            if(cart[idx].qty > 1) {
                cart[idx].qty -= 1;
                cart[idx].total = cart[idx].qty * cart[idx].unitPrice;
                renderCart();
            }
        }
    });

    document.getElementById('cartDiscountInput')?.addEventListener('input', renderCart);

    // Payment Flow
    document.querySelectorAll('.btn-mode').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mode = e.currentTarget.getAttribute('data-mode');
            currentPaymentMode = mode;
            
            document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');

            if(mode === 'Partial') { openPartialPayment(); }
        });
    });

    document.getElementById('btnGenerateBill')?.addEventListener('click', () => {
        if(cart.length === 0) return UI.showToast("Cart is empty", true);
        if(currentPaymentMode === 'Udhaar' && !currentCustomer.name) {
            return UI.showToast("Customer name required for Udhaar", true);
        }
        if(currentPaymentMode === 'Partial') {
            const grand = parseFloat(document.getElementById('cartGrandTotal').innerText);
            if(!partialSplitData || partialSplitData.total !== grand) {
                openPartialPayment();
                return;
            }
        }
        processCheckout(currentPaymentMode, partialSplitData);
    });
    
    // Partial Math
    document.getElementById('btnClosePartial')?.addEventListener('click', () => UI.hideModal('partialPayModal'));
    const pcCash = document.getElementById('payCash'), pcOnline = document.getElementById('payOnline'), pcUdhaar = document.getElementById('payUdhaar');
    
    const recalcPartial = (source) => {
        const grand = parseFloat(document.getElementById('cartGrandTotal').innerText) || 0;
        let c = parseFloat(pcCash?.value) || 0;
        let o = parseFloat(pcOnline?.value) || 0;
        let u = parseFloat(pcUdhaar?.value) || 0;

        if (source === 'cash') {
            o = Math.max(0, grand - c);
            u = 0;
            if(pcOnline) pcOnline.value = o > 0 ? o : '';
            if(pcUdhaar) pcUdhaar.value = '';
        } 
        else if (source === 'online') {
            u = Math.max(0, grand - c - o);
            if(pcUdhaar) pcUdhaar.value = u > 0 ? u : '';
            if (c + o > grand) { 
                if(pcOnline) pcOnline.value = Math.max(0, grand - c); 
                if(pcUdhaar) pcUdhaar.value = ''; 
            }
        } 
        else if (source === 'udhaar') {
            o = Math.max(0, grand - c - u);
            if(pcOnline) pcOnline.value = o > 0 ? o : '';
            if (c + u > grand) { 
                if(pcUdhaar) pcUdhaar.value = Math.max(0, grand - c); 
                if(pcOnline) pcOnline.value = ''; 
            }
        }
    };
    if(pcCash) pcCash.addEventListener('input', () => recalcPartial('cash'));
    if(pcOnline) pcOnline.addEventListener('input', () => recalcPartial('online'));
    if(pcUdhaar) pcUdhaar.addEventListener('input', () => recalcPartial('udhaar'));

    document.getElementById('btnConfirmPartial')?.addEventListener('click', () => {
        const c = Number(pcCash.value) || 0;
        const o = Number(pcOnline.value) || 0;
        const u = Number(pcUdhaar.value) || 0;
        const grand = parseFloat(document.getElementById('cartGrandTotal').innerText);

        if(Math.abs(c + o + u - grand) > 0.01) return UI.showToast("Amounts must equal Grand Total", true);
        if(u > 0 && !currentCustomer.name) return UI.showToast("Customer required for Partial Udhaar", true);

        partialSplitData = { cash: c, online: o, udhaar: u, total: grand };
        UI.hideModal('partialPayModal');
        UI.showToast("Mix Payment Saved");
    });

    // Held Carts
    document.getElementById('btnHoldCart')?.addEventListener('click', holdCurrentCart);
    document.getElementById('btnViewHeld')?.addEventListener('click', showHeldCarts);
    document.getElementById('btnCloseHeld')?.addEventListener('click', () => UI.hideModal('heldCartsModal'));
    document.getElementById('heldCartsList')?.addEventListener('click', (e) => {
        const idx = e.target.closest('[data-hidx]')?.getAttribute('data-hidx');
        if(idx !== undefined && e.target.tagName === 'BUTTON') restoreHeldCart(idx);
    });

    // Online Orders
    document.getElementById('btnCloseOnline')?.addEventListener('click', () => UI.hideModal('onlineOrdersModal'));
    document.getElementById('onlineOrdersList')?.addEventListener('click', (e) => {
        const id = e.target.closest('[data-oid]')?.getAttribute('data-oid');
        if(id && e.target.tagName === 'BUTTON') loadOnlineOrderToCart(id);
    });

    // Invoice
    document.getElementById('btnCloseInvoice')?.addEventListener('click', () => {
        UI.hideModal('invoiceModal');
        cart = []; currentCustomer = {name:'', phone:''}; 
        const cn = document.getElementById('custNameInput'); if(cn) cn.value = ''; 
        const cp = document.getElementById('custPhoneInput'); if(cp) cp.value = '';
        const dis = document.getElementById('cartDiscountInput'); if(dis) dis.value = '';
        
        currentPaymentMode = 'Cash'; partialSplitData = null;
        document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
        const mCash = document.getElementById('modeCash');
        if(mCash) mCash.classList.add('active');

        renderCart();
    });
    
    document.getElementById('btnPrintInvoice')?.addEventListener('click', () => {
        const invoiceContent = document.getElementById('invoicePaper');
        html2canvas(invoiceContent, { scale: 2 }).then(canvas => {
            const imgData = canvas.toDataURL('image/jpeg', 1.0);
            const pdf = new jspdf.jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: [canvas.width * 0.264583, canvas.height * 0.264583]
            });
            pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width * 0.264583, canvas.height * 0.264583);
            pdf.autoPrint();
            window.open(pdf.output('bloburl'), '_blank');
        });
    });

    document.getElementById('btnCloseInfo')?.addEventListener('click', () => UI.hideModal('productInfoModal'));
    document.getElementById('btnOpenBarcode')?.addEventListener('click', startBarcodeScan);
    document.getElementById('btnCancelBarcode')?.addEventListener('click', stopBarcodeScan);

    document.querySelectorAll('.modal-overlay, #barcodeScannerModal').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) UI.hideModal(overlay.id);
        });
    });
}

function setupMobileCartSwipe() {
    const rightPane = document.getElementById('rightPane');
    const cartHeader = document.querySelector('.cart-header');
    const dragHandle = document.getElementById('mobileDragHandle');
    
    if (dragHandle && window.innerWidth <= 900) {
        dragHandle.style.display = 'block';
    }

    if (!rightPane || !cartHeader) return;

    let startY = 0;
    let currentY = 0;
    
    cartHeader.addEventListener('touchstart', (e) => {
        if(window.innerWidth > 900) return;
        startY = e.touches[0].clientY;
        rightPane.style.transition = 'none'; 
    }, {passive: true});

    cartHeader.addEventListener('touchmove', (e) => {
        if (!startY || window.innerWidth > 900) return;
        currentY = e.touches[0].clientY;
        const diff = currentY - startY;
        if (diff > 0) { rightPane.style.transform = `translateY(${diff}px)`; }
    }, {passive: true});

    cartHeader.addEventListener('touchend', (e) => {
        if (!startY || window.innerWidth > 900) return;
        rightPane.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        
        const diff = currentY - startY;
        if (diff > 100) {
            rightPane.classList.remove('open');
            rightPane.style.transform = ''; 
            const closeBtn = document.getElementById('btnCloseMobileCart');
            if(closeBtn) closeBtn.style.display = 'none';
        } else {
            rightPane.style.transform = 'translateY(0)';
        }
        startY = 0;
    }, {passive: true});
}

// --- RENDERERS ---
function renderCategories() {
    const cats = new Set();
    allProducts.forEach(p => { if(p.category) cats.add(p.category); });
    let html = `<button class="cat-chip active" data-cat="ALL">All Items</button>`;
    Array.from(cats).forEach(c => { html += `<button class="cat-chip" data-cat="${Security.escapeHtml(c)}">${Security.escapeHtml(c)}</button>`; });
    const catTabs = document.getElementById('catTabs');
    if(catTabs) catTabs.innerHTML = html;
}

function renderProductGrid() {
    const searchInput = document.getElementById('prodSearchInput');
    const q = searchInput ? searchInput.value.toLowerCase().trim() : '';
    let filtered = allProducts;

    if(activeCategory !== 'ALL') {
        filtered = filtered.filter(p => (p.category||'').toLowerCase() === activeCategory.toLowerCase());
    }
    if(q) {
        filtered = filtered.filter(p => 
            (p.name||'').toLowerCase().includes(q) || 
            (p.variants||[]).some(v => (v.barcode||'').includes(q))
        );
    }

    const grid = document.getElementById('productGrid');
    if(!grid) return;

    if(filtered.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);">No products found.</div>`;
        return;
    }

    grid.innerHTML = filtered.map(p => {
        const vCount = (p.variants||[]).length;
        const displayStock = getProductTotalStockInfo(p);
        
        let badges = '';
        if(vCount > 1) badges += `<div class="pc-badge">${vCount} Types</div>`;
        if(p.isLoose) badges += `<div class="pc-badge-loose" style="right:${vCount>1?'55px':'0'};">Loose / Wt</div>`;
        
        const varPrices = (p.variants||[]).map(v => {
            const uPrice = getUnitPrice(p, v);
            const uLabel = getUnitLabel(p, v);
            return `<span class="pc-variant-item">${Security.escapeHtml(v.quantity)}: ₹${uPrice.toFixed(2)}/${Security.escapeHtml(uLabel)}</span>`;
        }).join('');
        
        return `
        <div class="prod-card" data-id="${Security.escapeHtml(p.id)}">
            <button class="pc-info-btn">
                <i class="fa-solid fa-circle-info"></i>
            </button>
            ${badges}
            <div class="pc-cat">${Security.escapeHtml(p.category || 'Gen')}</div>
            <div class="pc-name">${Security.escapeHtml(p.name)}</div>
            <div class="pc-variant-prices">${varPrices}</div>
            <div class="pc-bottom">
                <span class="pc-stock">${Security.escapeHtml(displayStock)}</span>
            </div>
        </div>
        `;
    }).join('');
}

function renderCart() {
    const list = document.getElementById('cartItemsList');
    const badge = document.getElementById('mobileCartBadge');
    if(badge) badge.innerText = cart.length;

    if(!list) return;

    if(cart.length === 0) {
        list.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:var(--text-muted);">
                <i class="fa-solid fa-cart-arrow-down" style="font-size:30px; opacity:0.3; margin-bottom:10px;"></i>
                <div style="font-weight:600; font-size:14px;"><span data-i18n="cart_empty">Cart is empty</span></div>
                <div style="font-size:11px; margin-top:4px;">Tap products to add them here.</div>
            </div>`;
        const cTotal = document.getElementById('cartTotalItems'); if(cTotal) cTotal.innerText = '0';
        const cSub = document.getElementById('cartSubtotal'); if(cSub) cSub.innerText = '0.00';
        const cGrand = document.getElementById('cartGrandTotal'); if(cGrand) cGrand.innerText = '0.00';
        const cGst = document.getElementById('cartGstRow'); if(cGst) cGst.style.display = 'none';
        
        if(partialSplitData) { 
            partialSplitData.total = 0; 
            const pCash = document.getElementById('payCash'); if(pCash) pCash.value = ''; 
        }
        return;
    }

    let subtotal = 0;
    let totalGst = 0;
    let hasGst = false;

    list.innerHTML = cart.map((item, idx) => {
        const amt = item.total; 
        let gstAmt = 0;
        if(item.gstRate > 0) {
            hasGst = true;
            if(item.priceType === 'exclusive') {
                gstAmt = amt * (item.gstRate / 100);
                subtotal += amt;
            } else {
                const base = amt / (1 + (item.gstRate / 100));
                gstAmt = amt - base;
                subtotal += base;
            }
            totalGst += gstAmt;
        } else {
            subtotal += amt;
        }
        
        return `
        <div class="cart-item">
            <div class="ci-details">
                <div class="ci-name">${Security.escapeHtml(item.name)}</div>
                <div class="ci-meta">${Security.escapeHtml(item.variant)} ${item.brand ? `• ${Security.escapeHtml(item.brand)}` : ''} @ ₹${item.unitPrice.toFixed(2)}/${Security.escapeHtml(item.unitLabel)}</div>
                <div class="ci-controls">
                    <button class="ci-btn ci-minus" data-idx="${idx}">-</button>
                    <span class="ci-qty">${item.qty} ${item.unitLabel==='unit'?'':Security.escapeHtml(item.unitLabel)}</span>
                    <button class="ci-btn ci-plus" data-idx="${idx}">+</button>
                </div>
            </div>
            <div class="ci-pricing">
                <button class="ci-del" data-idx="${idx}"><i class="fa-solid fa-trash"></i></button>
                <div class="ci-total">₹${item.total.toFixed(2)}</div>
            </div>
        </div>`;
    }).join('');

    const discInput = document.getElementById('cartDiscountInput');
    const discount = parseFloat(discInput ? discInput.value : 0) || 0;
    const grand = Math.max(0, subtotal + totalGst - discount);

    const cTotal = document.getElementById('cartTotalItems'); if(cTotal) cTotal.innerText = cart.length;
    const cSub = document.getElementById('cartSubtotal'); if(cSub) cSub.innerText = subtotal.toFixed(2);
    const cGrand = document.getElementById('cartGrandTotal'); if(cGrand) cGrand.innerText = grand.toFixed(2);

    const cGst = document.getElementById('cartGstRow');
    if(hasGst) {
        if(cGst) {
            cGst.style.display = 'flex';
            document.getElementById('cartTotalGst').innerText = totalGst.toFixed(2);
        }
    } else {
        if(cGst) cGst.style.display = 'none';
    }
}

// --- WIZARD & MODAL LOGIC ---
function openProductInfo(prodId) {
    const prod = allProducts.find(p => p.id === prodId);
    if(!prod) return;
    
    const infoName = document.getElementById('infoName'); if(infoName) infoName.innerText = prod.name;
    const infoCat = document.getElementById('infoCat'); if(infoCat) infoCat.innerText = prod.category || 'General';
    const infoLoose = document.getElementById('infoLoose'); if(infoLoose) infoLoose.style.display = prod.isLoose ? 'inline-block' : 'none';
    
    const infoHsn = document.getElementById('infoHSN'); if(infoHsn) infoHsn.innerText = prod.hsn || '-';
    const infoGst = document.getElementById('infoGST'); if(infoGst) infoGst.innerText = prod.gstRate ? `${prod.gstRate}%` : '-';
    
    const infoBatch = document.getElementById('infoBatch'); if(infoBatch) infoBatch.innerText = prod.batchId || '-';
    const infoTaxType = document.getElementById('infoTaxType'); if(infoTaxType) infoTaxType.innerText = prod.priceType || '-';

    const infoVarList = document.getElementById('infoVariantsList');
    if(infoVarList) {
        infoVarList.innerHTML = (prod.variants||[]).map(v => {
            const uPrice = getUnitPrice(prod, v);
            const uLabel = getUnitLabel(prod, v);
            const sInfo = getVariantStockInfo(prod, v);
            
            let brandsStr = '';
            if(v.brands && v.brands.length > 0) {
                brandsStr = `<div style="font-size:10px; color:var(--text-muted); margin-top:2px;"><i class="fa-solid fa-copyright"></i> ` + v.brands.map(b => `${Security.escapeHtml(b.name)}(${b.stock})`).join(', ') + `</div>`;
            }
            
            return `
            <div style="background:#fff; border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:8px; box-shadow:var(--shadow-sm);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-weight:700; color:var(--text-main); font-size:13px;">${Security.escapeHtml(v.quantity)}</span>
                        <div style="font-size:11px; color:var(--primary); font-weight:700; margin-top:2px;">₹${uPrice.toFixed(2)} per ${Security.escapeHtml(uLabel)}</div>
                        ${brandsStr}
                    </div>
                    <div style="text-align:right;">
                        <div style="color:var(--success); font-weight:800; font-size:14px;">Total ₹${v.price}</div>
                        <div style="font-size:10px; color:var(--text-muted); font-weight:600;">Avail: ${Formatters.stock(sInfo.available, sInfo.label)} ${Security.escapeHtml(sInfo.label)}</div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    UI.showModal('productInfoModal');
}

function openAddToCartWizard(prodId) {
    const prod = allProducts.find(p => p.id === prodId);
    if(!prod || !prod.variants || prod.variants.length === 0) return;

    configState = { prod: prod, step: 'variant', selectedVariant: null, selectedBrand: null };
    const pName = document.getElementById('confProdName'); if(pName) pName.innerText = prod.name;
    
    if(prod.variants.length > 1) {
        wizardRenderVariants();
    } else {
        configState.selectedVariant = prod.variants[0];
        checkBrandStep();
    }
    UI.showModal('addToCartModal');
}

function wizardRenderVariants() {
    configState.step = 'variant';
    document.getElementById('stepVariant').style.display = 'block';
    document.getElementById('stepBrand').style.display = 'none';
    document.getElementById('stepQty').style.display = 'none';
    const b = document.getElementById('btnConfBack'); if(b) b.style.display = 'none';
    const s = document.getElementById('confStepTitle'); if(s) s.innerText = "Select Type/Size";

    const grid = document.getElementById('confVariantGrid');
    if(!grid) return;

    grid.innerHTML = configState.prod.variants.map(v => {
        const sInfo = getVariantStockInfo(configState.prod, v);
        return `
        <button class="btn-step" data-vid="${v.id}">
            <div>
                <span>${Security.escapeHtml(v.quantity)}</span>
                <span class="btn-step-sub">Avail: ${Formatters.stock(sInfo.available, sInfo.label)} ${Security.escapeHtml(sInfo.label)}</span>
            </div>
            <span style="color:var(--success); font-weight:800; font-family:'JetBrains Mono';">₹${getUnitPrice(configState.prod, v).toFixed(2)}/${Security.escapeHtml(getUnitLabel(configState.prod, v))}</span>
        </button>`;
    }).join('');
}

function wizardSelectVariant(vid) {
    configState.selectedVariant = configState.prod.variants.find(v => v.id === vid);
    checkBrandStep();
}

function checkBrandStep() {
    const v = configState.selectedVariant;
    if(v.brands && v.brands.length > 0) {
        wizardRenderBrands();
    } else {
        configState.selectedBrand = '';
        wizardRenderQty();
    }
}

function wizardRenderBrands() {
    configState.step = 'brand';
    document.getElementById('stepVariant').style.display = 'none';
    document.getElementById('stepBrand').style.display = 'block';
    document.getElementById('stepQty').style.display = 'none';
    const b = document.getElementById('btnConfBack'); if(b) b.style.display = configState.prod.variants.length > 1 ? 'block' : 'none';
    const s = document.getElementById('confStepTitle'); if(s) s.innerText = "Select Brand";

    const p = configState.prod;
    const v = configState.selectedVariant;
    const grid = document.getElementById('confBrandGrid');
    if(!grid) return;
    
    grid.innerHTML = v.brands.map(b => {
        let avail = Number(b.stock) || 0;
        let label = 'units';
        if (p.isLoose) {
            avail = avail * (Number(v.baseQty) || 1);
            label = v.baseUnit || 'pcs';
        }
        return `
        <button class="btn-step" data-bname="${Security.escapeHtml(b.name)}">
            <span>${Security.escapeHtml(b.name)}</span>
            <span style="color:var(--text-muted); font-size:12px;">Avail: ${Formatters.stock(avail, label)} ${Security.escapeHtml(label)}</span>
        </button>`;
    }).join('');
}

function wizardSelectBrand(bName) {
    configState.selectedBrand = bName;
    wizardRenderQty();
}

function wizardRenderQty() {
    configState.step = 'qty';
    document.getElementById('stepVariant').style.display = 'none';
    document.getElementById('stepBrand').style.display = 'none';
    document.getElementById('stepQty').style.display = 'block';
    
    const p = configState.prod;
    const v = configState.selectedVariant;
    
    let backShows = false;
    if(v.brands && v.brands.length > 0) backShows = true;
    else if(p.variants.length > 1) backShows = true;
    const b = document.getElementById('btnConfBack'); if(b) b.style.display = backShows ? 'block' : 'none';
    
    const s = document.getElementById('confStepTitle'); if(s) s.innerText = "Select Quantity";

    const uPrice = getUnitPrice(p, v);
    const uLabel = getUnitLabel(p, v);
    const uDisp = document.getElementById('confUnitPriceDisplay'); if(uDisp) uDisp.innerText = `₹${uPrice.toFixed(2)} / ${Security.escapeHtml(uLabel)}`;
    
    const container = document.getElementById('confPresetContainer');
    if(!container) return;
    
    const lblLower = uLabel.toLowerCase();
    const isWeight = ['kg', 'g', 'l', 'ml'].includes(lblLower);
    
    if (p.isLoose && isWeight) {
        container.innerHTML = `
        <div class="preset-grid">
            <button type="button" class="btn-preset" data-val="0.05">50g</button>
            <button type="button" class="btn-preset" data-val="0.1">100g</button>
            <button type="button" class="btn-preset" data-val="0.25">250g</button>
            <button type="button" class="btn-preset" data-val="0.5">500g</button>
            <button type="button" class="btn-preset" data-val="1">1 ${Security.escapeHtml(uLabel)}</button>
            <button type="button" class="btn-preset" data-val="2">2 ${Security.escapeHtml(uLabel)}</button>
            <button type="button" class="btn-preset" data-val="5">5 ${Security.escapeHtml(uLabel)}</button>
            <button type="button" class="btn-preset" data-val="10">10 ${Security.escapeHtml(uLabel)}</button>
        </div>`;
    } else {
        container.innerHTML = `
        <div class="preset-grid">
            <button type="button" class="btn-preset" data-val="1">1</button>
            <button type="button" class="btn-preset" data-val="2">2</button>
            <button type="button" class="btn-preset" data-val="3">3</button>
            <button type="button" class="btn-preset" data-val="4">4</button>
            <button type="button" class="btn-preset" data-val="5">5</button>
            <button type="button" class="btn-preset" data-val="6">6</button>
            <button type="button" class="btn-preset" data-val="10">10</button>
            <button type="button" class="btn-preset" data-val="12">12</button>
        </div>`;
    }

    const cQty = document.getElementById('confCustomQty'); if(cQty) cQty.value = '1';
    recalcConfigTotal();
}

function wizardBack() {
    const step = configState.step;
    const p = configState.prod;
    const v = configState.selectedVariant;

    if(step === 'qty') {
        if(v.brands && v.brands.length > 0) wizardRenderBrands();
        else if(p.variants.length > 1) wizardRenderVariants();
    } else if(step === 'brand') {
        wizardRenderVariants();
    }
}

function recalcConfigTotal() {
    const p = configState.prod;
    const v = configState.selectedVariant;
    const uPrice = getUnitPrice(p, v);
    const qtyEl = document.getElementById('confCustomQty');
    const qty = parseFloat(qtyEl ? qtyEl.value : 0) || 0;
    const tot = uPrice * qty;
    const totEl = document.getElementById('confItemTotal');
    if(totEl) totEl.innerText = `₹${tot.toFixed(2)}`;
}

function confirmAddToCart() {
    const p = configState.prod;
    const v = configState.selectedVariant;
    const qtyEl = document.getElementById('confCustomQty');
    const qty = parseFloat(qtyEl ? qtyEl.value : 0) || 0;
    
    if(qty <= 0) return UI.showToast("Enter valid quantity", true);

    const uPrice = getUnitPrice(p, v);
    const uLabel = getUnitLabel(p, v);
    const brandStr = configState.selectedBrand || '';

    const stockInfo = getVariantStockInfo(p, v);
    let maxAvail = stockInfo.available;
    
    if (brandStr && v.brands) {
        const b = v.brands.find(bx => bx.name === brandStr);
        if (b) {
            maxAvail = Number(b.stock) || 0;
            if(p.isLoose) maxAvail = maxAvail * (Number(v.baseQty) || 1);
        }
    }

    const existingIdx = cart.findIndex(i => i.prodId === p.id && i.variant === v.quantity && i.brand === brandStr);
    const existingQty = existingIdx >= 0 ? cart[existingIdx].qty : 0;
    
    if (existingQty + qty > maxAvail) {
        return UI.showToast(`Max stock reached! Only ${Formatters.stock(maxAvail - existingQty, stockInfo.label)} available.`, true);
    }

    if(existingIdx >= 0) {
        cart[existingIdx].qty += qty;
        cart[existingIdx].total = cart[existingIdx].qty * uPrice;
    } else {
        cart.push({
            id: v.id,
            prodId: p.id,
            name: p.name,
            variant: v.quantity,
            brand: brandStr,
            qty: qty,
            unitPrice: uPrice,
            unitLabel: uLabel,
            total: uPrice * qty,
            hsn: p.hsn || '',
            gstRate: parseFloat(p.gstRate || 0),
            priceType: p.priceType || 'inclusive'
        });
    }

    UI.hideModal('addToCartModal');
    renderCart();
    
    if(window.innerWidth <= 900) {
        const rightPane = document.getElementById('rightPane');
        const btnCloseMobile = document.getElementById('btnCloseMobileCart');
        if(rightPane) rightPane.classList.add('open');
        if(btnCloseMobile) btnCloseMobile.style.display = 'block';
    }
}

// --- CHECKOUT ---
function openPartialPayment() {
    if(cart.length === 0) return UI.showToast("Cart is empty", true);
    const grand = parseFloat(document.getElementById('cartGrandTotal').innerText);
    const pGrand = document.getElementById('partialGrandTotal'); if(pGrand) pGrand.innerText = `₹${grand.toFixed(2)}`;
    const pCash = document.getElementById('payCash'); if(pCash) pCash.value = grand.toFixed(2);
    const pOnl = document.getElementById('payOnline'); if(pOnl) pOnl.value = '';
    const pUdh = document.getElementById('payUdhaar'); if(pUdh) pUdh.value = '';
    UI.showModal('partialPayModal');
}

async function processCheckout(method, split = null) {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if(!user.merchantId) return UI.showToast("Merchant ID missing", true);

    const btn = document.getElementById('btnGenerateBill');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`; btn.disabled = true;

    try {
        const grand = parseFloat(document.getElementById('cartGrandTotal').innerText);
        const discInput = document.getElementById('cartDiscountInput');
        const discount = parseFloat(discInput ? discInput.value : 0) || 0;
        let cashAmt = 0, onlineAmt = 0, udhaarAmt = 0;

        if(method === 'Cash') cashAmt = grand;
        else if(method === 'Online') onlineAmt = grand;
        else if(method === 'Udhaar') udhaarAmt = grand;
        else if(method === 'Partial' && split) {
            cashAmt = split.cash; onlineAmt = split.online; udhaarAmt = split.udhaar;
        }

        const saleDoc = {
            id: `inv_${Date.now()}`,
            date: new Date().toISOString(),
            customer: currentCustomer.name || 'Walk-in',
            customerPhone: currentCustomer.phone || '',
            items: cart,
            total: grand,
            discount: discount,
            paymentMethod: method,
            split: { cash: cashAmt, online: onlineAmt, udhaar: udhaarAmt }
        };

        const uniqueProdIds = [...new Set(cart.map(item => item.prodId))];

        // Atomic Transaction
        if (db && navigator.onLine) {
            await runTransaction(db, async (transaction) => {
                let pSnaps = {};
                for(const pid of uniqueProdIds) {
                    const pRef = doc(db, "shops", user.merchantId, "products", pid);
                    pSnaps[pid] = await transaction.get(pRef);
                }

                let customerRef = null, customerSnap = null;
                if(currentCustomer.name || currentCustomer.phone) {
                    const custId = currentCustomer.phone || currentCustomer.name.toLowerCase().replace(/\s/g,'_');
                    customerRef = doc(db, "shops", user.merchantId, "customers", custId);
                    customerSnap = await transaction.get(customerRef);
                }

                for(const pid of uniqueProdIds) {
                    const snap = pSnaps[pid];
                    if(snap.exists()) {
                        let pData = snap.data();
                        cart.filter(c => c.prodId === pid).forEach(cItem => {
                            const vIdx = pData.variants.findIndex(v => v.id === cItem.id);
                            if(vIdx > -1) {
                                let deduction = cItem.qty;
                                if(pData.isLoose) {
                                    const bq = Number(pData.variants[vIdx].baseQty) || 1;
                                    deduction = cItem.qty / bq; 
                                }
                                pData.variants[vIdx].stock -= deduction;
                                if(cItem.brand && pData.variants[vIdx].brands) {
                                    const bIdx = pData.variants[vIdx].brands.findIndex(b => b.name === cItem.brand);
                                    if(bIdx > -1) pData.variants[vIdx].brands[bIdx].stock -= deduction;
                                }
                            }
                        });
                        transaction.update(snap.ref, { variants: pData.variants });
                        const localIdx = allProducts.findIndex(p => p.id === pid);
                        if(localIdx > -1) allProducts[localIdx].variants = pData.variants;
                    }
                }

                if(customerRef) {
                    if(customerSnap.exists()) {
                        let cData = customerSnap.data();
                        if(currentCustomer.name) cData.name = currentCustomer.name;
                        if(currentCustomer.phone) cData.phone = currentCustomer.phone;
                        cData.balance = (Number(cData.balance)||0) + udhaarAmt;
                        transaction.update(customerRef, cData);
                        const cIdx = customers.findIndex(c => c.id === customerRef.id);
                        if(cIdx > -1) customers[cIdx] = cData;
                    } else {
                        const newCust = { id: customerRef.id, name: currentCustomer.name, phone: currentCustomer.phone, balance: udhaarAmt };
                        transaction.set(customerRef, newCust);
                        customers.push(newCust);
                    }
                }

                transaction.set(doc(db, "shops", user.merchantId, "sales", saleDoc.id), saleDoc);
            });
        }

        // Cache Locally
        await dbSave('bharatpos_products', allProducts);
        await dbSave('bharatpos_customers', customers);
        
        const sales = await dbGet('bharatpos_sales', '[]');
        sales.push(saleDoc);
        await dbSave('bharatpos_sales', sales);

        // Update Enterprise Caches for Dashboard Sync
        const eSales = await dbGet('bharatpos_enterprise_sales', 'null');
        if(eSales !== null) {
            saleDoc._branchId = user.merchantId; 
            eSales.unshift(saleDoc);
            await dbSave('bharatpos_enterprise_sales', eSales);
        }
        
        const eProds = await dbGet('bharatpos_enterprise_products', 'null');
        if(eProds !== null) {
            uniqueProdIds.forEach(pid => {
                const localP = allProducts.find(p => p.id === pid);
                const eIdx = eProds.findIndex(p => p.id === pid && (p._branchId === user.merchantId || p.merchantId === user.merchantId));
                if(localP && eIdx > -1) eProds[eIdx].variants = localP.variants;
            });
            await dbSave('bharatpos_enterprise_products', eProds);
        }

        UI.hideModal('partialPayModal');
        generateInvoice(saleDoc); 
        renderProductGrid();

    } catch(e) {
        console.error(e);
        UI.showToast("Transaction failed.", true);
    } finally {
        btn.innerHTML = origHtml; btn.disabled = false;
    }
}

function generateInvoice(sale) {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const hasGst = sale.items.some(i => i.gstRate > 0);
    let rows = ''; let totalTax = 0; let subtotal = 0;

    sale.items.forEach(i => {
        let taxHtml = '';
        const amt = i.total;
        if(hasGst) {
            let base = amt; let tax = 0;
            if(i.gstRate > 0) {
                if(i.priceType === 'inclusive') { base = amt / (1 + (i.gstRate/100)); tax = amt - base; }
                else { tax = amt * (i.gstRate/100); base = amt; }
            }
            totalTax += tax; subtotal += base;
            taxHtml = `<td class="inv-center">${i.gstRate}%</td>`;
        } else { subtotal += amt; }

        rows += `
        <tr>
            <td>${Security.escapeHtml(i.name)} <div style="font-size:10px; color:#555;">${Security.escapeHtml(i.variant)} ${i.brand?`(${Security.escapeHtml(i.brand)})`:''}</div></td>
            <td class="inv-center">${i.qty}${i.unitLabel==='unit'?'':Security.escapeHtml(i.unitLabel)}</td>
            <td class="inv-center">${i.unitPrice.toFixed(2)}</td>
            ${taxHtml}
            <td class="inv-right">${amt.toFixed(2)}</td>
        </tr>`;
    });

    let taxSummary = hasGst ? `<div class="inv-row"><span>Total GST:</span><span>₹${totalTax.toFixed(2)}</span></div>` : '';
    let discountRow = sale.discount > 0 ? `<div class="inv-row" style="color:red;"><span>Discount:</span><span>-₹${sale.discount.toFixed(2)}</span></div>` : '';

    const html = `
        <div class="inv-header">
            <h2 style="margin:0; font-size:18px;">${Security.escapeHtml(user.shopName || 'Retail Store')}</h2>
            <div>${Security.escapeHtml(user.address || '')}</div>
            <div>GSTIN: ${Security.escapeHtml(user.gstin || 'N/A')}</div>
            <div style="margin-top:10px; font-weight:bold;">TAX INVOICE</div>
        </div>
        <div style="margin-bottom:10px;">
            <div class="inv-row"><span>Inv No: ${sale.id.slice(-6)}</span><span>Date: ${new Date(sale.date).toLocaleDateString()}</span></div>
            <div class="inv-row"><span>Customer: ${Security.escapeHtml(sale.customer)}</span><span>Pay: ${sale.paymentMethod}</span></div>
        </div>
        <table class="inv-table">
            <thead>
                <tr>
                    <th>Item</th>
                    <th class="inv-center">Qty</th>
                    <th class="inv-center">Rate</th>
                    ${hasGst ? '<th class="inv-center">GST</th>' : ''}
                    <th class="inv-right">Total</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="inv-totals">
            <div class="inv-row"><span>SubTotal:</span><span>₹${subtotal.toFixed(2)}</span></div>
            ${taxSummary}
            ${discountRow}
            <div class="inv-row" style="font-weight:bold; font-size:16px; margin-top:5px;">
                <span>Grand Total:</span><span>₹${sale.total.toFixed(2)}</span>
            </div>
            ${sale.paymentMethod === 'Partial' ? `
            <div style="font-size:10px; margin-top:10px; border-top:1px dotted #ccc; padding-top:5px;">
                Split: Cash: ₹${sale.split.cash} | Online: ₹${sale.split.online} | Udhaar: ₹${sale.split.udhaar}
            </div>` : ''}
        </div>
        <div style="text-align:center; margin-top:20px; font-size:10px;">Thank you for visiting!</div>
    `;

    const invPaper = document.getElementById('invoicePaper');
    if(invPaper) invPaper.innerHTML = html;
    UI.showModal('invoiceModal');
}

// --- HELD CARTS & ONLINE ORDERS ---
async function holdCurrentCart() {
    if(cart.length === 0) return UI.showToast("Cart empty");
    heldCarts.push({
        id: `hold_${Date.now()}`,
        time: new Date().toLocaleTimeString(),
        cust: currentCustomer,
        items: [...cart],
        discount: parseFloat(document.getElementById('cartDiscountInput').value) || 0
    });
    
    await dbSave('bharatpos_held_carts', heldCarts);
    
    cart = []; currentCustomer = {name:'', phone:''}; 
    const cn = document.getElementById('custNameInput'); if(cn) cn.value = ''; 
    const cp = document.getElementById('custPhoneInput'); if(cp) cp.value = '';
    const cd = document.getElementById('cartDiscountInput'); if(cd) cd.value = '';
    renderCart();
    UI.showToast("Cart held securely.");
}

function showHeldCarts() {
    const list = document.getElementById('heldCartsList');
    if(!list) return;
    if(heldCarts.length === 0) {
        list.innerHTML = "<div style='text-align:center; padding:20px; color:#888;'>No held carts.</div>";
    } else {
        list.innerHTML = heldCarts.map((h, i) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border:1px solid var(--border); border-radius:10px;">
                <div>
                    <div style="font-weight:700; font-size:13px;">${Security.escapeHtml(h.cust.name || 'Walk-in')}</div>
                    <div style="font-size:11px; color:var(--text-muted);">${h.items.length} items • ${h.time}</div>
                </div>
                <button class="btn btn-outline" style="padding:6px 12px; font-size:11px;" data-hidx="${i}">Restore</button>
            </div>
        `).join('');
    }
    UI.showModal('heldCartsModal');
}

async function restoreHeldCart(idx) {
    const h = heldCarts[idx];
    cart = [...h.items];
    currentCustomer = {...h.cust};
    const cn = document.getElementById('custNameInput'); if(cn) cn.value = currentCustomer.name;
    const cp = document.getElementById('custPhoneInput'); if(cp) cp.value = currentCustomer.phone;
    const cd = document.getElementById('cartDiscountInput'); if(cd) cd.value = h.discount || '';
    
    heldCarts.splice(idx, 1);
    await dbSave('bharatpos_held_carts', heldCarts);
    UI.hideModal('heldCartsModal');
    renderCart();
}

function showOnlineOrders() {
    const list = document.getElementById('onlineOrdersList');
    if(!list) return;
    if(onlineOrders.length === 0) {
        list.innerHTML = "<div style='text-align:center; padding:20px; color:#888;'>No active online orders.</div>";
    } else {
        list.innerHTML = onlineOrders.map(o => `
            <div style="border:1px solid var(--border); border-radius:10px; padding:15px; background:#F8FAFC;">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <span style="font-weight:700; font-size:14px;"><i class="fa-solid fa-mobile-screen"></i> ${Security.escapeHtml(o.customerName)}</span>
                    <span style="font-weight:800; color:var(--success);">₹${o.totalAmount}</span>
                </div>
                <div style="font-size:11px; color:var(--text-muted); margin-bottom:12px;">
                    ${(o.items||[]).map(i => `${i.qty}x ${Security.escapeHtml(i.name)}`).join(', ')}
                </div>
                <button class="btn btn-primary" style="width:100%; font-size:12px; padding:10px;" data-oid="${o.orderId}">Load into Cart</button>
            </div>
        `).join('');
    }
    UI.showModal('onlineOrdersModal');
}

async function loadOnlineOrderToCart(orderId) {
    const order = onlineOrders.find(o => o.orderId === orderId);
    if(!order) return;

    if(cart.length > 0) await holdCurrentCart();
    
    cart = order.items.map(i => {
        const p = allProducts.find(prod => prod.id === i.prodId);
        const uPrice = p ? (p.priceType === 'inclusive' ? i.price : i.price) : i.price; 
        return {
            id: i.variantId || 'unknown', prodId: i.prodId, name: i.name, variant: i.variant || '1 pcs', brand: '',
            qty: i.qty, unitPrice: uPrice, unitLabel: 'unit', total: i.qty * uPrice, 
            hsn: p?.hsn||'', gstRate: p?.gstRate||0, priceType: p?.priceType||'inclusive'
        };
    });
    
    currentCustomer = { name: order.customerName, phone: order.customerMobile || '' };
    const cn = document.getElementById('custNameInput'); if(cn) cn.value = order.customerName;
    const cp = document.getElementById('custPhoneInput'); if(cp) cp.value = order.customerMobile || '';
    
    UI.hideModal('onlineOrdersModal');
    renderCart();
    
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if(user.merchantId && db) {
        await deleteDoc(doc(db, "shops", user.merchantId, "onlineOrders", orderId));
    }
}

// --- SCANNER ---
function startBarcodeScan() {
    UI.showModal('barcodeScannerModal');
    Quagga.init({
        inputStream: { name: "Live", type: "LiveStream", target: document.querySelector('#quaggaPreview'), constraints: { facingMode: "environment", advanced: [{ focusMode: "continuous" }] } },
        decoder: { readers: ["ean_reader", "upc_reader", "code_128_reader"] }
    }, function(err) {
        if (err) { console.log(err); UI.showToast("Scanner failed to start", true); return; }
        Quagga.start();
    });

    Quagga.onDetected(function(result) {
        if(result.codeResult.code) {
            const code = result.codeResult.code;
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.play().catch(e=>{});
            stopBarcodeScan();
            
            let foundProd = null, foundVar = null;
            allProducts.forEach(p => {
                const v = p.variants.find(vx => vx.barcode === code);
                if(v) { foundProd = p; foundVar = v; }
            });

            if(foundProd && foundVar) {
                openAddToCartWizard(foundProd.id);
                const varIdx = foundProd.variants.findIndex(v => v.id === foundVar.id);
                if(varIdx > -1) {
                    configState.selectedVarIdx = varIdx;
                    wizardSelectVariant(foundVar.id);
                }
            } else {
                UI.showToast("Product not found in inventory", true);
            }
        }
    });
}

function stopBarcodeScan() {
    Quagga.stop();
    UI.hideModal('barcodeScannerModal');
}

// KICKSTART
initBilling();