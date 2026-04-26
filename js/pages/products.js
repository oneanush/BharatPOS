// File: /js/pages/products.js

import { db } from '../core/firebase.js';
import { doc, setDoc, deleteDoc, collection, getDocs, writeBatch, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { dbGet, dbSave } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';
import { Security } from '../utils/security.js';
import { Formatters } from '../utils/formatters.js';

// --- ENCAPSULATED STATE ---
let allProducts = [];
let salesHistory = [];
let currentEditingId = null;
let currentDetailId = null;
let currentEditingDate = null;
let masterDbCache = [];

let activeTiers = new Set();
let activeCategory = '';
let activeBatch = '';
let filterState = { brand: '', tax: '', lowStock: false, expiring: false, newest: false, query: '' };

let currentPage = 0;
const pageSize = 50;
let currentFilteredData = [];
let observer = null;
let isInventoryVisible = true; 

let cameraStream = null;
let selectedBulkItems = new Set();
let hintTimeout = null;

// --- INITIALIZATION ---
async function initProducts() {
    Navigation.inject('products');
    
    try {
        bindEvents();
        loadSettings();

        allProducts = await dbGet('bharatpos_products', '[]');
        salesHistory = await dbGet('bharatpos_sales', '[]');

        if (window.innerWidth <= 1024) {
            isInventoryVisible = false;
        } else {
            isInventoryVisible = true;
            document.getElementById('inventoryWrapper')?.classList.add('show');
            const txt = document.getElementById('toggleInvText');
            if(txt) txt.innerText = "Hide Inventory List";
        }

        const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
        const storedShopsStr = localStorage.getItem(`bharatpos_shops_${user.mobile || user.phone}`);
        if (storedShopsStr) {
            try {
                const shops = JSON.parse(storedShopsStr);
                if (shops.length > 1) {
                    const transferBtn = document.getElementById('btnTransferFromModal');
                    if(transferBtn) transferBtn.style.display = 'inline-flex';
                    
                    const switcher = document.getElementById('globalShopSwitcher');
                    if(switcher) {
                        switcher.style.display = 'inline-block';
                        switcher.innerHTML = shops.map(s => `<option value="${s.merchantId}" ${s.merchantId === user.merchantId ? 'selected' : ''}>${Security.escapeHtml(s.shopName)} ${s.isMain ? '⭐' : ''}</option>`).join('');
                        switcher.addEventListener('change', (e) => {
                            if(e.target.value !== user.merchantId) window.location.reload(); 
                        });
                    }
                }
            } catch(e) {}
        }

        if(localStorage.getItem('tutorial_inventory') !== 'true') UI.showModal('welcomeTutorial');

        updateDatalists();
        applyFilters(); 
        setupIntersectionObserver();
        
        // Render 1 Default Type Box
        addTypeBoxUI();

        const isGstGlobal = localStorage.getItem('bharatpos_gst_mode') === 'true';
        if (isGstGlobal) {
            const tierGst = document.getElementById('tierGst');
            if(tierGst) tierGst.classList.add('active');
            const gstBtn = document.getElementById('btnToggleGst');
            if(gstBtn) { gstBtn.style.background = 'var(--blue-50)'; gstBtn.style.borderColor = 'var(--primary)'; gstBtn.style.color = 'var(--primary)'; }
        }

    } catch (err) {
        console.error("Init Error:", err);
        UI.showToast("Initialization error. Check console.", true);
    }
}

// --- EVENT BINDING ---
function bindEvents() {
    document.getElementById('btnExportCsv')?.addEventListener('click', handleExportCSV);

    document.getElementById('btnCloseTutorial')?.addEventListener('click', () => {
        localStorage.setItem('tutorial_inventory', 'true');
        UI.hideModal('welcomeTutorial');
    });
    document.getElementById('btnRestartTutorial')?.addEventListener('click', () => {
        UI.hideModal('settingsModal');
        UI.showModal('welcomeTutorial');
    });

    document.getElementById('btnToggleFilters')?.addEventListener('click', () => {
        const area = document.getElementById('advancedFilterSection');
        if(area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('btnToggleInventoryList')?.addEventListener('click', () => {
        isInventoryVisible = !isInventoryVisible;
        const wrapper = document.getElementById('inventoryWrapper');
        const txt = document.getElementById('toggleInvText');
        
        if (isInventoryVisible) {
            if(wrapper) wrapper.classList.add('show');
            if(txt) txt.innerText = "Hide Inventory List";
            if(currentFilteredData.length === 0) applyFilters(); 
        } else {
            if(wrapper) wrapper.classList.remove('show');
            if(txt) txt.innerText = "View Inventory List";
        }
    });

    document.addEventListener('mouseover', handleHintEvent);
    document.addEventListener('touchstart', handleHintEvent, {passive: true});

    document.getElementById('btnToggleGst')?.addEventListener('click', function () {
        const content = document.getElementById('tierGst');
        if(content) content.classList.toggle('active');
        if (content && content.classList.contains('active')) {
            this.style.background   = 'var(--blue-50)';
            this.style.borderColor  = 'var(--primary)';
            this.style.color        = 'var(--primary)';
        } else {
            this.style.background   = '';
            this.style.borderColor  = '';
            this.style.color        = '';
        }
    });

    document.getElementById('btnAddVariant')?.addEventListener('click', () => addTypeBoxUI());
    
    // UI Interactions inside the new Engine
    document.getElementById('variantEngine')?.addEventListener('click', (e) => {
        const addBrandBtn = e.target.closest('.btn-add-brand');
        if (addBrandBtn) {
            const typeBox = addBrandBtn.closest('.type-box');
            const brandsContainer = typeBox.querySelector('.brands-container');
            
            // Show brand name inputs for all boxes inside this Type
            brandsContainer.querySelectorAll('.brand-name-group').forEach(grp => grp.style.display = 'block');
            
            // Append new brand box
            brandsContainer.insertAdjacentHTML('beforeend', getBrandBoxHTML(null, true));
            const newBox = brandsContainer.lastElementChild;
            updatePriceLabel(newBox);
            
            const isAdv = document.getElementById('cfgAdvFields')?.checked;
            if(isAdv) newBox.classList.add('show-adv');
        }
        
        const removeBrandBtn = e.target.closest('.btn-remove-brand');
        if(removeBrandBtn) removeBrandBtn.closest('.brand-box').remove();
        
        const removeTypeBtn = e.target.closest('.btn-remove-type');
        if(removeTypeBtn) removeTypeBtn.closest('.type-box').remove();

        const scanBtn = e.target.closest('.btn-scan-barcode');
        if (scanBtn) startBarcodeScan(scanBtn);
    });

    // Dynamic Price Label Update
    document.getElementById('variantEngine')?.addEventListener('input', (e) => {
        if (e.target.classList.contains('b-base-qty') || e.target.classList.contains('b-base-unit')) {
            updatePriceLabel(e.target.closest('.brand-box'));
        }
    });

    document.getElementById('pIsLoose')?.addEventListener('change', () => {
        document.querySelectorAll('.brand-box').forEach(box => updatePriceLabel(box));
    });

    document.getElementById('productForm')?.addEventListener('submit', handleSaveProduct);
    document.getElementById('btnOpenSettings')?.addEventListener('click',  () => UI.showModal('settingsModal'));
    document.getElementById('btnCloseSettings')?.addEventListener('click', () => UI.hideModal('settingsModal'));
    
    document.getElementById('cfgAdvFields')?.addEventListener('change', saveConfig);
    document.getElementById('cfgBatch')?.addEventListener('change',     saveConfig);
    document.getElementById('cfgHints')?.addEventListener('change',     saveConfig);
    
    document.getElementById('btnAutoBatch')?.addEventListener('click', () => {
        const catInput = document.getElementById('pCategory');
        const prefix = (catInput ? catInput.value.substring(0,3).toUpperCase() : 'BAT');
        const batchInput = document.getElementById('pBatchId');
        if(batchInput) batchInput.value = `${prefix || 'BAT'}-${Math.floor(1000 + Math.random() * 9000)}`;
    });

    document.getElementById('btnOpenMasterCatalog')?.addEventListener('click',  () => UI.showModal('masterCatalogModal'));
    document.getElementById('btnCloseMasterCatalog')?.addEventListener('click', () => UI.hideModal('masterCatalogModal'));
    document.getElementById('btnFetchMasterCatalog')?.addEventListener('click', fetchMasterCatalog);
    document.getElementById('masterSearchInput')?.addEventListener('input', searchMasterDB);
    document.getElementById('masterDbList')?.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const dataStr = e.target.getAttribute('data-json');
            if (dataStr) importMasterProduct(JSON.parse(dataStr));
        }
    });

    document.getElementById('btnTriggerCsv')?.addEventListener('click',  () => {
        const f = document.getElementById('csvUpload');
        if(f) f.click();
    });
    document.getElementById('csvUpload')?.addEventListener('change', handleBulkImport);
    document.getElementById('btnSyncCloud')?.addEventListener('click', pullFreshData);

    document.getElementById('tierTabs')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-btn') && e.target.tagName !== 'SELECT') {
            toggleTierFilter(e.target.getAttribute('data-tier'), e.target);
        }
    });
    document.getElementById('catTabSelect')?.addEventListener('change', (e) => {
        activeCategory = e.target.value;
        updateAllTabHighlight();
        applyFilters();
    });
    document.getElementById('batchTabSelect')?.addEventListener('change', (e) => {
        activeBatch = e.target.value;
        updateAllTabHighlight();
        applyFilters();
    });

    document.getElementById('filterBrand')?.addEventListener('change', applyFilters);
    document.getElementById('filterTax')?.addEventListener('change',   applyFilters);
    document.getElementById('searchInput')?.addEventListener('input',  applyFilters);
    document.querySelectorAll('.action-chip').forEach(chip => {
        chip.addEventListener('click', (e) => toggleChip(e.currentTarget));
    });

    document.getElementById('inventoryGrid')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('bulk-cb')) {
            toggleBulkItem(e.target.dataset.id, e.target.checked);
            e.stopPropagation();
            return;
        }
        const card = e.target.closest('.sku-card');
        if (card) openProductDetails(card.getAttribute('data-id'));
    });

    document.getElementById('bulkOperation')?.addEventListener('change', (e) => {
        const valInput = document.getElementById('bulkValue');
        if(!valInput) return;
        if (e.target.value === 'category' || e.target.value === 'tax' || e.target.value === 'discount') {
            valInput.style.display = 'block';
            if(e.target.value === 'discount') valInput.placeholder = "Enter %";
            else if(e.target.value === 'tax') valInput.placeholder = "GST %";
            else valInput.placeholder = "Category Name";
        } else {
            valInput.style.display = 'none';
        }
    });
    document.getElementById('btnApplyBulk')?.addEventListener('click', executeBulkAction);
    document.getElementById('btnCancelBulk')?.addEventListener('click', clearBulkSelection);

    document.getElementById('btnCloseDetails')?.addEventListener('click', () => UI.hideModal('productDetailsModal'));
    document.getElementById('btnEditFromModal')?.addEventListener('click', () => {
        UI.hideModal('productDetailsModal');
        if (currentDetailId) loadProductForEdit(currentDetailId);
    });
    document.getElementById('btnDeleteFromModal')?.addEventListener('click', () => {
        UI.hideModal('productDetailsModal');
        if (currentDetailId) deleteProduct(currentDetailId);
    });

    document.getElementById('btnTransferFromModal')?.addEventListener('click', openTransferModal);
    document.getElementById('btnCloseTransfer')?.addEventListener('click', () => UI.hideModal('transferStockModal'));
    document.getElementById('btnSubmitTransfer')?.addEventListener('click', submitStockTransfer);
    document.getElementById('transferQty')?.addEventListener('input', updateTransferLiveCalc);
    document.getElementById('transferVariant')?.addEventListener('change', updateTransferLiveCalc);

    document.getElementById('btnStartScan')?.addEventListener('click', startAIScan);
    document.getElementById('btnStopScan')?.addEventListener('click',  stopAIScan);
    document.getElementById('btnCancelBarcode')?.addEventListener('click', stopBarcodeScan);

    document.querySelectorAll('.modal-overlay, #barcodeScannerModal').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) UI.hideModal(overlay.id);
        });
    });
}

// --- NEW ENGINE UI BUILDERS ---
function updatePriceLabel(brandBox) {
    const isLoose = document.getElementById('pIsLoose')?.checked;
    const bq = brandBox.querySelector('.b-base-qty').value || 1;
    const bu = brandBox.querySelector('.b-base-unit').value || 'pcs';
    const lbl = brandBox.querySelector('.b-price-label');
    
    if(!lbl) return;
    if (isLoose) lbl.innerText = `Amount per 1 ${bu}`;
    else lbl.innerText = `Amount per ${bq} ${bu}`;
}

function getBrandBoxHTML(vData = null, showBrandName = false) {
    const bq = vData?.baseQty || 1;
    const bu = vData?.baseUnit || 'pcs';
    const isLoose = document.getElementById('pIsLoose')?.checked;
    
    let formPrice = vData?.price !== undefined ? vData.price : '';
    if (isLoose && formPrice !== '') formPrice = (formPrice / bq).toFixed(2);

    return `
    <div class="brand-box" style="margin-top:16px; padding-top:16px; border-top:1.5px dashed var(--border); position:relative;">
        <div class="form-group brand-name-group" style="${showBrandName ? 'display:block;' : 'display:none;'}">
            <input type="text" class="form-input b-name" placeholder=" " value="${Security.escapeHtml(vData?.brandName || '')}">
            <label class="floating-label">Brand Name</label>
        </div>
        
        <div class="variant-grid">
            <div class="form-group" style="margin-bottom:0;">
                <div style="display:flex; gap:8px;">
                    <input type="number" step="0.001" class="form-input b-base-qty" placeholder="Qty" value="${bq}" style="flex:1;">
                    <input type="text" class="form-input b-base-unit" list="unitOptions" placeholder="Unit" value="${Security.escapeHtml(bu)}" style="width: 80px;">
                </div>
                <label class="floating-label" style="top:-8px; background:#fff; font-size:11px; color:var(--primary);"><i class="fa-solid fa-box"></i> 1 Stock Contains</label>
            </div>
            
            <div class="form-group" style="margin-bottom:0;">
                <input type="number" step="0.01" class="form-input b-price" placeholder=" " value="${formPrice}" required style="font-size:16px; font-weight:800; color:var(--success); font-family:'JetBrains Mono';">
                <label class="floating-label b-price-label">Selling Price</label>
            </div>
        </div>
        
        <div class="form-group" style="margin-top:12px; margin-bottom:0;">
            <input type="number" step="0.001" class="form-input b-stock" placeholder=" " value="${vData?.stock !== undefined ? vData.stock : ''}" required>
            <label class="floating-label" style="color:var(--primary); font-weight:700;">Stock</label>
        </div>
        
        <div class="adv-only-field">
            <div class="variant-grid">
                <div class="form-group" style="margin-bottom:0; position:relative;">
                    <input type="text" class="form-input b-barcode" placeholder=" " value="${Security.escapeHtml(vData?.barcode || '')}">
                    <button type="button" class="btn-scan-barcode" style="position:absolute; right:8px; top:11px; background:none; border:none; color:var(--primary); font-size:16px; cursor:pointer;"><i class="fa-solid fa-barcode"></i></button>
                    <label class="floating-label"><i class="fa-solid fa-barcode"></i> Barcode</label>
                </div>
                <div class="form-group" style="margin-bottom:0;">
                    <input type="number" step="0.01" class="form-input b-cost" placeholder=" " value="${vData?.costPrice || ''}">
                    <label class="floating-label"><i class="fa-solid fa-tags"></i> Cost Price</label>
                </div>
            </div>
            <div class="form-group" style="margin-top:12px; margin-bottom:0;">
                <input type="date" class="form-input b-expiry" placeholder=" " value="${Security.escapeHtml(vData?.expiryDate || '')}">
                <label class="floating-label"><i class="fa-regular fa-calendar-xmark"></i> Expiry Date</label>
            </div>
        </div>
        
        <input type="hidden" class="b-id" value="${Security.escapeHtml(vData?.id || '')}">
        <input type="hidden" class="b-added" value="${Security.escapeHtml(vData?.dateAdded || '')}">
        
        <button type="button" class="btn-remove-brand" style="position:absolute; top:16px; right:0; background:none; border:none; color:var(--danger); cursor:pointer; font-size:16px; padding:5px;"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}

function addTypeBoxUI(typeString = '', variantsArray = []) {
    const container = document.getElementById('variantEngine');
    const div = document.createElement('div');
    div.className = 'type-box';
    
    const showBrands = variantsArray.length > 1 || (variantsArray.length === 1 && variantsArray[0].brandName);
    
    let brandsHtml = '';
    if (variantsArray.length > 0) {
        variantsArray.forEach(v => brandsHtml += getBrandBoxHTML(v, showBrands));
    } else {
        brandsHtml = getBrandBoxHTML(null, false);
    }

    div.innerHTML = `
        ${container.children.length > 0 ? `<button type="button" class="btn-remove-type"><i class="fa-solid fa-xmark"></i></button>` : ''}
        <div style="display:flex; gap:10px; align-items:center;">
            <div class="form-group" style="flex:2; margin-bottom:0;">
                <input type="text" class="form-input v-type-input" placeholder=" " value="${Security.escapeHtml(typeString)}" required>
                <label class="floating-label">Type of Item (e.g. Biscuit)</label>
            </div>
            <button type="button" class="btn btn-dashed btn-add-brand" style="flex:1; margin-bottom:0; height:46px; font-size:13px; font-family:var(--font-body);">+ Add Brand</button>
        </div>
        <div class="brands-container">${brandsHtml}</div>
    `;
    
    container.appendChild(div);
    div.querySelectorAll('.brand-box').forEach(bBox => updatePriceLabel(bBox));
    
    const advEl = document.getElementById('cfgAdvFields');
    if(advEl && advEl.checked) div.classList.add('show-adv');
}

// --- LOGIC METHODS ---
function handleHintEvent(e) {
    const hintBar = document.getElementById('globalHintBar');
    if(!hintBar) return;
    if(localStorage.getItem('cfg_hints') === 'false') return;
    
    const target = e.target.closest('[data-hint]');
    if(target) {
        const hints = target.getAttribute('data-hint').split('|');
        let hintText = hints[0].split(':')[1]; 
        const lang = localStorage.getItem('app_lang') || 'en';
        
        hints.forEach(h => {
            const [l, text] = h.split(':');
            if(l === lang) hintText = text;
        });

        hintBar.innerText = `💡 ${hintText}`;
        hintBar.classList.add('show');
        clearTimeout(hintTimeout);
        hintTimeout = setTimeout(() => hintBar.classList.remove('show'), 3000);
    }
}

function loadSettings() {
    const isAdv   = localStorage.getItem('cfg_adv_fields') === 'true';
    const isBatch = localStorage.getItem('cfg_batch') === 'true';
    const isHints = localStorage.getItem('cfg_hints') !== 'false';

    const elAdv = document.getElementById('cfgAdvFields'); if(elAdv) elAdv.checked = isAdv;
    const elBatch = document.getElementById('cfgBatch'); if(elBatch) elBatch.checked = isBatch;
    const elHints = document.getElementById('cfgHints'); if(elHints) elHints.checked = isHints;

    applySettingsUI(isAdv, isBatch);
}

function saveConfig() {
    const advEl = document.getElementById('cfgAdvFields');
    const batchEl = document.getElementById('cfgBatch');
    const hintsEl = document.getElementById('cfgHints');

    const isAdv   = advEl ? advEl.checked : false;
    const isBatch = batchEl ? batchEl.checked : false;
    const isHints = hintsEl ? hintsEl.checked : true;

    localStorage.setItem('cfg_adv_fields', isAdv);
    localStorage.setItem('cfg_batch',      isBatch);
    localStorage.setItem('cfg_hints',      isHints);

    applySettingsUI(isAdv, isBatch);
    UI.showToast(document.body.classList.contains('lang-hin') ? "Settings badal di gayi" : "Settings Updated");
}

function applySettingsUI(isAdv, isBatch) {
    const advCon = document.getElementById('advancedFieldsContainer');
    if(advCon) advCon.style.display = (isAdv || isBatch) ? 'block' : 'none';
    
    const batCon = document.getElementById('batchInputContainer');
    if(batCon) batCon.style.display = isBatch ? 'block' : 'none';
    
    document.querySelectorAll('.type-box').forEach(box => {
        if(isAdv) box.classList.add('show-adv'); else box.classList.remove('show-adv');
    });
}

function handleExportCSV() {
    if(allProducts.length === 0) return UI.showToast("No products to export", true);
    try {
        const flattened = [];
        allProducts.forEach(p => {
            p.variants.forEach(v => {
                flattened.push({
                    Name: p.name, Category: p.category, 
                    Type: v.type, Brand: v.brandName, 
                    Price: v.price, Stock: v.stock,
                    BaseQty: v.baseQty, BaseUnit: v.baseUnit,
                    Barcode: v.barcode, Expiry: v.expiryDate, CostPrice: v.costPrice,
                    BatchID: p.batchId, HSN: p.hsn, GST: p.gstRate, DateAdded: p.dateAdded
                });
            });
        });
        const ws = XLSX.utils.json_to_sheet(flattened);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Inventory");
        XLSX.writeFile(wb, `BharatPOS_Inventory_${new Date().toISOString().slice(0,10)}.xlsx`);
        UI.showToast("✅ Export Successful!");
    } catch(e) { UI.showToast("Export Failed", true); }
}

async function handleSaveProduct(e) {
    e.preventDefault();
    const btn = document.getElementById('saveBtn');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`; btn.disabled = true;

    try {
        const user      = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
        const name      = document.getElementById('pName').value.trim();
        const cat       = document.getElementById('pCategory').value.trim() || 'General';
        const hsn       = document.getElementById('pHSN').value.trim();
        const gstRate   = document.getElementById('pGSTRate').value.trim();
        const pTypeEl   = document.getElementById('pPriceType');
        const priceType = pTypeEl ? pTypeEl.value : 'inclusive';

        const looseEl = document.getElementById('pIsLoose');
        const isLoose = looseEl ? looseEl.checked : false;
        
        const pBatchEl = document.getElementById('pBatchId');
        const batchId = pBatchEl ? pBatchEl.value.trim() : "";
        
        const pReorderEl = document.getElementById('pReorderPoint');
        const reorder = pReorderEl ? pReorderEl.value : '';
        
        const nowIso  = new Date().toISOString();
        const productId = currentEditingId || `prod_${Date.now()}`;
        
        const productDoc = {
            id: productId, name: name, category: cat, hsn: hsn, gstRate: gstRate, priceType: priceType,
            isLoose: isLoose, batchId: batchId, reorderPoint: reorder, 
            dateAdded: currentEditingDate || nowIso,
            variants: []
        };

        const typeBoxes = document.querySelectorAll('.type-box');
        for (let i = 0; i < typeBoxes.length; i++) {
            const tBox = typeBoxes[i];
            const typeVal = tBox.querySelector('.v-type-input').value.trim();
            const brandBoxes = tBox.querySelectorAll('.brand-box');
            
            brandBoxes.forEach((bBox, j) => {
                const bName = bBox.querySelector('.b-name').value.trim();
                const bq = parseFloat(bBox.querySelector('.b-base-qty').value) || 1;
                const bu = bBox.querySelector('.b-base-unit').value.trim() || 'pcs';
                
                let formPrice = parseFloat(bBox.querySelector('.b-price').value) || 0;
                let dbPrice = isLoose ? formPrice * bq : formPrice;
                
                const stock = parseFloat(bBox.querySelector('.b-stock').value) || 0;
                const barcode = bBox.querySelector('.b-barcode')?.value || '';
                const cost = bBox.querySelector('.b-cost')?.value || '';
                const expiry = bBox.querySelector('.b-expiry')?.value || '';
                
                const vId = bBox.querySelector('.b-id').value || `var_${Date.now()}_${i}_${j}`;
                const vAdded = bBox.querySelector('.b-added').value || nowIso;
                
                // Backwards compatibility label
                const finalQuantity = bName ? `${typeVal} - ${bName}` : typeVal;
                
                productDoc.variants.push({
                    id: vId, type: typeVal, brandName: bName, quantity: finalQuantity,
                    price: dbPrice, stock: stock, baseQty: bq, baseUnit: bu,
                    barcode: barcode, costPrice: cost, expiryDate: expiry, dateAdded: vAdded
                });
            });
        }

        if(currentEditingId) allProducts = allProducts.filter(p => p.id !== currentEditingId);
        allProducts.push(productDoc);

        await dbSave('bharatpos_products', allProducts);
        updateDatalists();
        applyFilters();

        document.getElementById('productForm').reset();
        document.getElementById('variantEngine').innerHTML = '';
        addTypeBoxUI();
        currentEditingId = null;
        currentEditingDate = null;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        UI.showToast("✅ Item Saved Successfully");

        if (user.merchantId && db) {
            try {
                await setDoc(doc(db, "shops", user.merchantId, "products", productDoc.id), productDoc);
            } catch (cloudErr) {
                console.warn("Offline – data saved to device only.");
            }
        }
    } catch (err) {
        console.error(err);
        UI.showToast("Critical error saving data", true);
    } finally {
        btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Save to Database`; btn.disabled = false;
    }
}

function calculateABCTiers() {
    const freqs = {};
    salesHistory.forEach(sale => {
        (sale.items || []).forEach(item => {
            if (item.id) freqs[item.id] = (freqs[item.id] || 0) + (item.qty || 1);
        });
    });
    return function (productId) {
        const f = freqs[productId] || 0;
        if (f > 20) return 'A';
        if (f > 5)  return 'B';
        return 'C';
    };
}

function updateDatalists() {
    const cats = new Set(), brands = new Set(), taxes = new Set(), batches = new Set();
    allProducts.forEach(p => {
        if (p.category) cats.add(p.category);
        if (p.gstRate)  taxes.add(p.gstRate);
        if (p.batchId)  batches.add(p.batchId);
        (p.variants || []).forEach(v => {
            if(v.brandName) brands.add(v.brandName);
        });
    });

    const cList = document.getElementById('catList'); if(cList) cList.innerHTML = Array.from(cats).map(c => `<option value="${Security.escapeHtml(c)}">`).join('');
    const bList = document.getElementById('brandList'); if(bList) bList.innerHTML = Array.from(brands).map(b => `<option value="${Security.escapeHtml(b)}">`).join('');
    const baList = document.getElementById('batchList'); if(baList) baList.innerHTML = Array.from(batches).map(b => `<option value="${Security.escapeHtml(b)}">`).join('');

    const cTab = document.getElementById('catTabSelect'); 
    if(cTab) cTab.innerHTML = '<option value="">Categories ▾</option>' + Array.from(cats).map(c => `<option value="${Security.escapeHtml(c)}">${Security.escapeHtml(c)}</option>`).join('');
        
    const bTab = document.getElementById('batchTabSelect'); 
    if(bTab) bTab.innerHTML = '<option value="">Batches ▾</option>' + Array.from(batches).map(b => `<option value="${Security.escapeHtml(b)}">${Security.escapeHtml(b)}</option>`).join('');

    const fBrand = document.getElementById('filterBrand'); 
    if(fBrand) fBrand.innerHTML = '<option value="">All Brands</option>' + Array.from(brands).map(b => `<option value="${Security.escapeHtml(b)}">${Security.escapeHtml(b)}</option>`).join('');
    const fTax = document.getElementById('filterTax'); 
    if(fTax) fTax.innerHTML = '<option value="">All Taxes (GST)</option>' + Array.from(taxes).map(t => `<option value="${Security.escapeHtml(t)}">GST ${Security.escapeHtml(t)}%</option>`).join('');
}

function updateAllTabHighlight() {
    const allTab = document.querySelector('[data-tier="ALL"]');
    if(!allTab) return;
    if(activeTiers.size === 0 && !activeCategory && !activeBatch) {
        allTab.classList.add('active');
    } else {
        allTab.classList.remove('active');
    }
}

function toggleTierFilter(tier, btnEl) {
    if (tier === 'ALL') {
        activeTiers.clear();
        activeCategory = '';
        activeBatch = '';
        const cTab = document.getElementById('catTabSelect'); if(cTab) cTab.value = '';
        const bTab = document.getElementById('batchTabSelect'); if(bTab) bTab.value = '';
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btnEl.classList.add('active');
    } else {
        if (activeTiers.has(tier)) {
            activeTiers.delete(tier);
            btnEl.classList.remove('active');
        } else {
            activeTiers.add(tier);
            btnEl.classList.add('active');
        }
        updateAllTabHighlight();
    }
    applyFilters();
}

function toggleChip(btnEl) {
    btnEl.classList.toggle('active');
    const action = btnEl.getAttribute('data-action');
    if (action === 'LowStock')  filterState.lowStock  = !filterState.lowStock;
    if (action === 'Expiring')  filterState.expiring  = !filterState.expiring;
    if (action === 'Newest')    filterState.newest    = !filterState.newest;
    applyFilters();
}

function applyFilters() {
    if(!isInventoryVisible) return; 
    
    const getTier = calculateABCTiers();
    const fb = document.getElementById('filterBrand');
    filterState.brand = fb ? fb.value : '';
    const ft = document.getElementById('filterTax');
    filterState.tax   = ft ? ft.value : '';
    const si = document.getElementById('searchInput');
    filterState.query = si ? si.value.toLowerCase().trim() : '';

    let filtered = allProducts;

    if (activeTiers.size > 0) {
        filtered = filtered.filter(p => p.variants.some(v => activeTiers.has(getTier(v.id))));
    }
    if (activeCategory) {
        filtered = filtered.filter(p => (p.category || '').toLowerCase() === activeCategory.toLowerCase());
    }
    if (activeBatch) {
        filtered = filtered.filter(p => (p.batchId || '') === activeBatch);
    }

    if (filterState.brand) {
        filtered = filtered.filter(p => p.variants.some(v => v.brandName === filterState.brand));
    }
    if (filterState.tax) {
        filtered = filtered.filter(p => p.gstRate == filterState.tax);
    }
    
    if (filterState.lowStock) {
        filtered = filtered.filter(p => {
            const threshold = (p.reorderPoint !== undefined && p.reorderPoint !== '') ? Number(p.reorderPoint) : 5;
            let total = 0; p.variants.forEach(v => total += Number(v.stock||0));
            return total <= threshold;
        });
    }
    if (filterState.expiring) {
        const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);
        filtered = filtered.filter(p => p.variants.some(v => v.expiryDate && new Date(v.expiryDate) < nextMonth));
    }

    if (filterState.newest) {
        filtered.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
    } else if (filterState.query === '') {
        filtered.sort((a, b) => (a.name||'').localeCompare(b.name||''));
    }

    if (filterState.query) {
        const fuzzyReg = new RegExp(filterState.query.split('').join('.*'), 'i');
        filtered = filtered.filter(p =>
            (p.name||'').toLowerCase().includes(filterState.query) || fuzzyReg.test(p.name||'') ||
            p.variants.some(v => (v.barcode || '').includes(filterState.query))
        );
    }

    currentFilteredData = filtered;
    currentPage = 0;
    const grid = document.getElementById('inventoryGrid');
    if(grid) grid.innerHTML = '';
    renderChunk();
}

window.toggleBulkItem = function(id, isChecked) {
    if (isChecked) selectedBulkItems.add(id);
    else selectedBulkItems.delete(id);

    const bb = document.getElementById('bulkActionBar');
    const bc = document.getElementById('bulkCount');
    if (selectedBulkItems.size > 0) {
        if(bb) bb.classList.add('show');
        if(bc) bc.innerText = selectedBulkItems.size;
    } else {
        if(bb) bb.classList.remove('show');
    }
}

function clearBulkSelection() {
    selectedBulkItems.clear();
    const bb = document.getElementById('bulkActionBar');
    if(bb) bb.classList.remove('show');
    const ig = document.getElementById('inventoryGrid');
    if(ig) ig.innerHTML = '';
    currentPage = 0;
    renderChunk();
}

async function executeBulkAction() {
    const opEl = document.getElementById('bulkOperation');
    const valEl = document.getElementById('bulkValue');
    if(!opEl || !valEl) return;

    const op = opEl.value;
    const val = valEl.value.trim();
    
    if(!op) return UI.showToast("Select an action first", true);
    if(op !== 'delete' && !val) return UI.showToast("Please enter a value", true);
    if(!confirm(`Are you sure you want to modify ${selectedBulkItems.size} products?`)) return;

    let modifiedIds = [];
    let deletedIds = [];

    allProducts = allProducts.filter(p => {
        if (selectedBulkItems.has(p.id)) {
            if (op === 'delete') {
                deletedIds.push(p.id);
                return false; 
            } else if (op === 'category') {
                p.category = val; modifiedIds.push(p);
            } else if (op === 'tax') {
                p.gstRate = val; modifiedIds.push(p);
            } else if (op === 'discount') {
                const discountPct = parseFloat(val) || 0;
                p.variants.forEach(v => { v.price = (v.price - (v.price * (discountPct / 100))).toFixed(2); });
                modifiedIds.push(p);
            }
        }
        return true;
    });

    await dbSave('bharatpos_products', allProducts);
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');

    if (user.merchantId && db) {
        try {
            let currentBatch = writeBatch(db);
            let opCount = 0;

            const commitBatch = async () => {
                if(opCount > 0) { await currentBatch.commit(); currentBatch = writeBatch(db); opCount = 0; }
            };

            for (const id of deletedIds) { currentBatch.delete(doc(db, "shops", user.merchantId, "products", id)); opCount++; if (opCount >= 490) await commitBatch(); }
            for (const p of modifiedIds) { currentBatch.set(doc(db, "shops", user.merchantId, "products", p.id), p); opCount++; if (opCount >= 490) await commitBatch(); }
            await commitBatch(); 
        } catch(e) { console.warn("Offline - bulk action saved locally only."); }
    }

    clearBulkSelection();
    updateDatalists();
    applyFilters();
    UI.showToast("✨ Bulk Action Applied Successfully");
}

function renderChunk() {
    if(!isInventoryVisible) return;

    const grid  = document.getElementById('inventoryGrid');
    if(!grid) return;

    const start = currentPage * pageSize;
    const end   = start + pageSize;
    const chunk = currentFilteredData.slice(start, end);
    const getTier = calculateABCTiers();

    if (currentFilteredData.length === 0 && currentPage === 0) {
        grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:52px 20px;">
          <div style="width:56px;height:56px;border-radius:16px;background:var(--blue-50);display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;">
            <i class="fa-solid fa-box-open" style="color:var(--primary);font-size:22px;"></i>
          </div>
          <div style="font-weight:800;font-size:14px;color:var(--text-main); font-family:var(--font-head);">No SKUs found</div>
          <div style="font-size:12px;color:var(--text-muted);font-weight:600;margin-top:5px;">Adjust filters or search.</div>
        </div>`;
        const loadTrig = document.getElementById('loadMoreTrigger');
        if(loadTrig) loadTrig.style.display = 'none';
        return;
    }

    const fragment = document.createDocumentFragment();

    chunk.forEach(p => {
        let totalStock = 0; p.variants.forEach(v => totalStock += Number(v.stock||0));
        const threshold = (p.reorderPoint !== undefined && p.reorderPoint !== '') ? Number(p.reorderPoint) : 5;
        const isLow    = totalStock <= threshold;
        
        const vCount   = p.variants.length;
        
        // Accurate Price Rendering for Grid
        const vFirst = p.variants[0];
        let basePrice = vFirst.price;
        if(p.isLoose) basePrice = (basePrice / (vFirst.baseQty||1)).toFixed(2);

        const tier     = getTier(vFirst.id);
        const formatTotalStock = Formatters.stock(totalStock, vFirst.quantity);
        const isChecked = selectedBulkItems.has(p.id) ? 'checked' : '';

        const card = document.createElement('div');
        card.className = 'sku-card';
        card.setAttribute('data-id', p.id);

        card.innerHTML = `
            <div class="sku-tier tier-${tier.toLowerCase()}">${tier}</div>
            <div>
                <div class="sku-header">
                    <input type="checkbox" class="bulk-cb" ${isChecked} data-id="${p.id}">
                    <h3 class="sku-name">${Security.escapeHtml(p.name)}</h3>
                </div>
                <div class="sku-cat">${Security.escapeHtml(p.category) || 'General'}</div>
                <div class="sku-variant-label">
                    <i class="fa-solid fa-tag" style="margin-right:4px;"></i>
                    ${vCount > 1 ? `${vCount} Variations` : Security.escapeHtml(vFirst.quantity)}
                </div>
            </div>
            <div>
                <div class="sku-stats">
                    <div class="sku-price">₹${basePrice}${vCount > 1 ? '<span style="font-size:10px;opacity:0.6;"> +</span>' : ''}</div>
                    <div class="sku-stock-badge ${isLow ? 'low' : ''}">
                        <i class="fa-solid fa-${isLow ? 'triangle-exclamation' : 'circle-check'}"></i>
                        ${formatTotalStock} in stock
                    </div>
                </div>
            </div>
        `;
        fragment.appendChild(card);
    });

    grid.appendChild(fragment);

    const loadTrig = document.getElementById('loadMoreTrigger');
    if(loadTrig) {
        if (end < currentFilteredData.length) {
            loadTrig.style.display = 'block';
        } else {
            loadTrig.style.display = 'none';
        }
    }
}

function setupIntersectionObserver() {
    const trigger = document.getElementById('loadMoreTrigger');
    if(!trigger) return;
    observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && (currentPage * pageSize) < currentFilteredData.length) {
            currentPage++;
            renderChunk();
        }
    }, { root: null, threshold: 0.1 });
    observer.observe(trigger);
}

function openProductDetails(id) {
    const base = allProducts.find(p => p.id === id);
    if (!base) return;

    currentDetailId = id;
    const getTier = calculateABCTiers();
    const tier  = getTier(base.variants[0].id);

    const dName = document.getElementById('dName'); if(dName) dName.innerText = base.name;
    const dTier = document.getElementById('dTier'); if(dTier) { dTier.innerText = `Tier ${tier}`; dTier.className = `sku-tier tier-${tier.toLowerCase()}`; }
    const dCat = document.getElementById('dCat'); if(dCat) dCat.innerText = base.category || 'General';

    const dHsn = document.getElementById('dHSN'); if(dHsn) dHsn.innerText = base.hsn || '-';
    const dGst = document.getElementById('dGST'); if(dGst) dGst.innerText = base.gstRate ? `${base.gstRate}%` : '-';
    const dTaxType = document.getElementById('dTaxType'); if(dTaxType) dTaxType.innerText = base.priceType || 'inclusive';
    const dBatch = document.getElementById('dBatch'); if(dBatch) dBatch.innerText = base.batchId || '-';
    
    const threshold = (base.reorderPoint !== undefined && base.reorderPoint !== '') ? base.reorderPoint : 5;
    const dAlert = document.getElementById('dAlert'); if(dAlert) dAlert.innerText = `${threshold} Units`;

    let dateAddedDisplay = '-';
    if(base.dateAdded) {
        const d = new Date(base.dateAdded);
        if(!isNaN(d.getTime())) dateAddedDisplay = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    const dAdded = document.getElementById('dAdded'); if(dAdded) dAdded.innerText = dateAddedDisplay;

    const vList = document.getElementById('dVariantsList');
    if(vList) {
        vList.innerHTML = base.variants.map(v => {
            let details = [];
            
            if(v.barcode) details.push(`<span style="color:var(--slate-500);"><i class="fa-solid fa-barcode"></i> ${Security.escapeHtml(v.barcode)}</span>`);
            if(v.expiryDate) details.push(`<span style="color:var(--slate-500);"><i class="fa-solid fa-calendar-xmark"></i> Exp: ${Security.escapeHtml(v.expiryDate)}</span>`);
            if(v.costPrice) details.push(`<span style="color:var(--slate-500);"><i class="fa-solid fa-tags"></i> Cost: ₹${Security.escapeHtml(v.costPrice)}</span>`);
            
            // Highlight "1 Stock Contains" clearly
            details.push(`<span style="color:var(--primary);"><i class="fa-solid fa-box"></i> 1 Stock = ${v.baseQty || 1} ${Security.escapeHtml(v.baseUnit)||'pcs'}</span>`);
            
            let detailsHtml = details.length > 0 ? `<div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:8px; padding-top:8px; border-top:1.5px dashed var(--border); font-size:11px; font-weight:700;">${details.join('')}</div>` : '';

            let pLabel = base.isLoose ? `₹${(v.price / (v.baseQty||1)).toFixed(2)} / ${v.baseUnit||'pcs'}` : `₹${v.price}`;

            return `
            <div style="background:var(--white);padding:16px;border-radius:12px;border:1.5px solid var(--border);box-shadow:var(--shadow-sm);">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-weight:800;font-size:14px;color:var(--text-main); font-family:var(--font-head);">${Security.escapeHtml(v.quantity)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="color:var(--success);font-weight:800;font-family:'JetBrains Mono';font-size:16px;">${pLabel}</div>
                        <div style="font-size:11px;color:${v.stock <= threshold ? 'var(--danger)' : 'var(--slate-500)'};font-weight:700;margin-top:4px;">Stock: ${v.stock}</div>
                    </div>
                </div>
                ${detailsHtml}
            </div>
            `;
        }).join('');
    }

    UI.showModal('productDetailsModal');
}

function loadProductForEdit(id) {
    const base = allProducts.find(p => p.id === id);
    if (!base) return;

    currentEditingId = base.id;
    currentEditingDate = base.dateAdded;

    const pName = document.getElementById('pName'); if(pName) pName.value = base.name;
    const pCat = document.getElementById('pCategory'); if(pCat) pCat.value = base.category || '';
    const pHsn = document.getElementById('pHSN'); if(pHsn) pHsn.value = base.hsn || '';
    const pGst = document.getElementById('pGSTRate'); if(pGst) pGst.value = base.gstRate || '';
    
    if (base.priceType) { const pPt = document.getElementById('pPriceType'); if(pPt) pPt.value = base.priceType; }

    const pReo = document.getElementById('pReorderPoint'); if(pReo) pReo.value = base.reorderPoint || '';
    const pBat = document.getElementById('pBatchId'); if(pBat) pBat.value = base.batchId || '';
    const pLoo = document.getElementById('pIsLoose'); if(pLoo) pLoo.checked = base.isLoose || false;

    const eng = document.getElementById('variantEngine');
    if(eng) eng.innerHTML = '';
    
    // Group flattened DB variants back into hierarchical UI Type Boxes
    const groups = {};
    base.variants.forEach(v => {
        let t = v.type;
        let b = v.brandName;
        if (t === undefined) {
            // Fallback parsing for extremely old legacy variants without type/brandName fields
            if (v.quantity && v.quantity.includes(' - ')) {
                const parts = v.quantity.split(' - ');
                t = parts[0]; b = parts.slice(1).join(' - ');
            } else {
                t = v.quantity || ''; b = '';
            }
        }
        if (!groups[t]) groups[t] = [];
        v.type = t; v.brandName = b;
        groups[t].push(v);
    });
    
    Object.keys(groups).forEach(typeKey => addTypeBoxUI(typeKey, groups[typeKey]));

    window.scrollTo({ top: 0, behavior: 'smooth' });
    if(pName) pName.focus();
    
    UI.showToast(`✏️ Loaded "${base.name}" for editing`);
}

async function deleteProduct(id) {
    const base = allProducts.find(p => p.id === id);
    if(!base) return;

    if (!confirm(`Delete product "${base.name}"?`)) return;

    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    allProducts = allProducts.filter(p => p.id !== id);
    await dbSave('bharatpos_products', allProducts);
    applyFilters();
    UI.showToast("🗑️ Deleted successfully");

    if (user.merchantId && db) {
        try {
            await deleteDoc(doc(db, "shops", user.merchantId, "products", id));
        } catch (e) {
            console.warn("Delete offline mode — removed locally only.", e);
        }
    }
}

async function fetchMasterCatalog() {
    const btn = document.getElementById('btnFetchMasterCatalog');
    if(!btn) return;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Fetching…`; btn.disabled = true;
    try {
        if (!db) throw new Error("Firebase disconnected");
        const masterRef = collection(db, "masterCatalog");
        const snap      = await getDocs(masterRef);
        masterDbCache   = snap.docs.map(d => d.data());
        searchMasterDB();
        UI.showToast("MasterDB Synced");
    } catch (e) {
        console.error(e);
        UI.showToast("Failed to fetch MasterDB", true);
    } finally {
        btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Fetch Global Database`; btn.disabled = false;
    }
}

function searchMasterDB() {
    const si = document.getElementById('masterSearchInput');
    const q  = si ? si.value.toLowerCase().trim() : '';
    const list = document.getElementById('masterDbList');
    if(!list) return;

    if (masterDbCache.length === 0) return;
    const filtered = masterDbCache.filter(p => (p.name || '').toLowerCase().includes(q)).slice(0, 50);

    list.innerHTML = filtered.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;background:var(--white);padding:14px;border:1.5px solid var(--border);border-radius:12px; margin-bottom:8px;">
            <div>
                <div style="font-weight:800;font-size:14px;color:var(--text-main); font-family:var(--font-head);">${Security.escapeHtml(p.name)}</div>
                <div style="font-size:11px;color:var(--text-muted); font-weight:700; margin-top:4px;">${Security.escapeHtml(p.category) || 'Gen'} • ₹${p.price}</div>
            </div>
            <button class="btn btn-outline" style="padding:8px 14px;font-size:12px;width:auto;" data-json='${JSON.stringify(p).replace(/'/g, "&#39;")}'>Import</button>
        </div>
    `).join('');
}

function importMasterProduct(p) {
    UI.hideModal('masterCatalogModal');
    
    const pN = document.getElementById('pName'); if(pN) pN.value = p.name || '';
    const pC = document.getElementById('pCategory'); if(pC) pC.value = p.category || '';
    const pH = document.getElementById('pHSN'); if(pH) pH.value = p.hsn || '';
    const pG = document.getElementById('pGSTRate'); if(pG) pG.value = p.gstRate || '';
    
    const pil = document.getElementById('pIsLoose');
    if (pil) pil.checked = p.isLoose || false;

    const eng = document.getElementById('variantEngine');
    if (eng) eng.innerHTML = '';
    
    addTypeBoxUI(p.quantity || 'General', [{
        price: p.price || 0,
        baseQty: 1,
        baseUnit: 'pcs'
    }]);

    window.scrollTo({ top: 0, behavior: 'smooth' });
    if(pN) pN.focus();
    UI.showToast(`Imported "${p.name}"`);
}

async function handleBulkImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const grid = document.getElementById('inventoryGrid');
            if(grid) {
                grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:50px;color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin fa-2x" style="color:var(--primary);"></i><br><br><span style="font-weight:800; font-family:var(--font-head); color:var(--text-main);">Parsing file…</span></div>';
            }

            const data     = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            if (jsonData.length === 0) throw new Error("File is empty");

            const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
            let batch = (user.merchantId && db) ? writeBatch(db) : null;
            let opCount = 0, addedCount = 0;

            for (const row of jsonData) {
                const name = row['Name'] || row['Product Name'] || row['Item'];
                if (!name) continue;

                const skuId = `imp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                const typeName = String(row['Type'] || row['Unit'] || 'General');
                const brandName = String(row['Brand'] || '');
                const finalQuantity = brandName ? `${typeName} - ${brandName}` : typeName;

                const productDoc = {
                    id: skuId, name: String(name), category: String(row['Category'] || 'General'),
                    hsn: String(row['HSN'] || ''), gstRate: String(row['GST'] || ''), batchId: '',
                    reorderPoint: String(row['Reorder Point'] || row['Min Stock'] || ''),
                    isLoose: String(row['Loose'] || '').toLowerCase() === 'true', dateAdded: new Date().toISOString(),
                    variants: [{
                        id: `${skuId}_v0`,
                        type: typeName,
                        brandName: brandName,
                        quantity: finalQuantity,
                        price: parseFloat(row['Price'] || row['Sell Price'] || row['Rate'] || 0),
                        stock: parseFloat(row['Stock'] || row['Qty'] || 0),
                        barcode: String(row['Barcode'] || ''),
                        costPrice: String(row['CostPrice'] || row['Cost'] || ''), 
                        expiryDate: String(row['Expiry'] || ''), 
                        baseQty: String(row['BaseQty'] || '1'), 
                        baseUnit: String(row['BaseUnit'] || 'pcs')
                    }]
                };

                allProducts.push(productDoc);
                if (batch && user.merchantId) { batch.set(doc(db, "shops", user.merchantId, "products", skuId), productDoc); }
                opCount++; addedCount++;

                if (batch && opCount === 490) { await batch.commit(); batch = writeBatch(db); opCount = 0; }
            }

            if (batch && opCount > 0 && user.merchantId) await batch.commit();

            await dbSave('bharatpos_products', allProducts);
            updateDatalists();
            applyFilters();
            UI.showToast(`✅ Imported ${addedCount} products successfully!`);

        } catch (error) {
            console.error(error);
            UI.showToast("Import failed. Ensure valid CSV/Excel format.", true);
            applyFilters();
        }
    };
    reader.readAsArrayBuffer(file);
}

async function pullFreshData() {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if (!user.merchantId || !db) { UI.showToast("No active cloud connection", true); return; }

    const grid = document.getElementById('inventoryGrid');
    if(grid) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:50px;color:var(--text-muted);"><i class="fa-solid fa-cloud-arrow-down fa-bounce fa-2x" style="color:var(--primary);"></i><br><br><span style="font-weight:800; font-family:var(--font-head); color:var(--text-main);">Syncing from Cloud…</span></div>';
    }

    try {
        const snap  = await getDocs(collection(db, "shops", user.merchantId, "products"));
        let fresh = snap.docs.map(d => d.data());
        
        fresh = fresh.map(p => {
            if(!p.variants) {
                const finalQuantity = p.brand ? `${p.quantity || 'General'} - ${p.brand}` : (p.quantity || 'General');
                return {
                    id: p.id, name: p.name, category: p.category, hsn: p.hsn, gstRate: p.gstRate, priceType: p.priceType,
                    isLoose: p.isLoose, batchId: p.batchId, reorderPoint: p.reorderPoint, dateAdded: p.dateAdded || new Date().toISOString(),
                    variants: [{
                        id: `${p.id}_v0`, type: p.quantity || 'General', brandName: p.brand || '', quantity: finalQuantity, 
                        price: p.price || 0, stock: p.stock || 0,
                        barcode: p.barcode || '', expiryDate: p.expiryDate || '', costPrice: p.costPrice || '',
                        baseQty: p.baseQty || 1, baseUnit: p.baseUnit || 'pcs'
                    }]
                };
            }
            return p;
        });

        allProducts = fresh;
        await dbSave('bharatpos_products', fresh);
        updateDatalists();
        applyFilters();
        UI.showToast("☁️ Sync complete!");
    } catch (e) {
        UI.showToast("Sync failed", true);
        applyFilters();
    }
}

async function startAIScan() {
    const box   = document.getElementById('scannerBox');
    const video = document.getElementById('cameraPreview');
    if(!box || !video) return;
    
    box.style.display = 'block';
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = cameraStream;
        setTimeout(captureAndSendToAI, 3000);
    } catch (err) {
        UI.showToast("Camera access denied", true);
        box.style.display = 'none';
    }
}

function stopAIScan() {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    const box = document.getElementById('scannerBox');
    if(box) box.style.display = 'none';
}
async function captureAndSendToAI() {
    if (!cameraStream) return;
    const video  = document.getElementById("cameraPreview");
    const canvas = document.getElementById("captureCanvas");
    if(!video || !canvas) return;
    
    const ctx    = canvas.getContext("2d");
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];

    stopAIScan();
    UI.showToast("✨ AI Lens analyzing...");

    try {
        const url  = typeof window.buildUrl === 'function' ? window.buildUrl('/ai-product-scan') : 'https://server-xy7s.onrender.com/ai-product-scan';
        const res  = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: base64 }) });
        const data = await res.json();

        if (data && data.success && data.product) {
            const p = data.product;
            
            const pN = document.getElementById("pName"); if(pN && !pN.value) pN.value = p.name || "";
            const pC = document.getElementById("pCategory"); if(pC && !pC.value) pC.value = p.category || "";
            
            const pHsn = document.getElementById("pHSN"); if(pHsn && !pHsn.value) pHsn.value = p.hsn_code || "";
            const pGst = document.getElementById("pGSTRate"); if(pGst && !pGst.value && p.gst_rate !== null) pGst.value = p.gst_rate;

            const firstTypeBox = document.querySelector('.type-box');
            if (firstTypeBox) {
                if (p.quantity_unit) { const vT = firstTypeBox.querySelector('.v-type-input'); if(vT && !vT.value) vT.value = p.quantity_unit; }
                
                const firstBrandBox = firstTypeBox.querySelector('.brand-box');
                if(firstBrandBox) {
                    if (p.price !== null) { const vP = firstBrandBox.querySelector('.b-price'); if(vP && !vP.value) vP.value = p.price; }
                    
                    if (p.barcode || p.expiry_date || p.hsn_code || p.gst_rate || p.brand) {
                        const advEl = document.getElementById('cfgAdvFields');
                        if (advEl && !advEl.checked) { advEl.checked = true; saveConfig(); }
                    }

                    if (p.brand) { 
                        firstBrandBox.querySelector('.brand-name-group').style.display = 'block';
                        const bN = firstBrandBox.querySelector('.b-name'); if(bN && !bN.value) bN.value = p.brand; 
                    }
                    const bCode = firstBrandBox.querySelector('.b-barcode');
                    const eDate = firstBrandBox.querySelector('.b-expiry');
                    if (p.expiry_date && eDate && !eDate.value) eDate.value = p.expiry_date;
                    if (p.barcode && bCode && !bCode.value) bCode.value = p.barcode;
                }
            }
            
            if (p.hsn_code || p.gst_rate !== null) {
                const gstContent = document.getElementById('tierGst');
                if (gstContent && !gstContent.classList.contains('active')) {
                    document.getElementById('btnToggleGst')?.click();
                }
            }

            UI.showToast("✨ AI Auto-fill complete");
        } else {
            throw new Error("Invalid AI response");
        }
    } catch (e) {
        console.error(e);
        UI.showToast("AI Lens failed to recognize product", true);
    }
}


function openTransferModal() {
    const base = allProducts.find(p => p.id === currentDetailId);
    if(!base) return;

    const vSel = document.getElementById('transferVariant');
    if(vSel) vSel.innerHTML = base.variants.map(v => `<option value="${v.id}">${v.quantity} (Avail: ${v.stock})</option>`).join('');

    const bSel = document.getElementById('transferTargetBranch');
    if(bSel) {
        const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
        const mobile = user.mobile || user.phone;
        
        const storedShopsStr = localStorage.getItem(`bharatpos_shops_${mobile}`);
        let shops = [];
        if (storedShopsStr) {
            try { shops = JSON.parse(storedShopsStr); } catch(e) {}
        }
        
        if(shops.length > 1) {
            bSel.innerHTML = shops.filter(s => s.merchantId !== user.merchantId)
                                  .map(s => `<option value="${s.merchantId}">${Security.escapeHtml(s.shopName)}</option>`).join('');
        } else {
            bSel.innerHTML = '<option value="">No other branches found</option>';
        }
    }

    const tQty = document.getElementById('transferQty'); if(tQty) tQty.value = '';
    const tCalc = document.getElementById('transferCalcDisplay'); if(tCalc) tCalc.innerText = '';
    
    UI.hideModal('productDetailsModal');
    UI.showModal('transferStockModal');
}

function updateTransferLiveCalc() {
    const qtyInput = document.getElementById('transferQty').value;
    const display = document.getElementById('transferCalcDisplay');
    const varId = document.getElementById('transferVariant').value;

    if(!qtyInput || isNaN(qtyInput) || qtyInput <= 0) {
        display.innerText = '';
        return;
    }

    const prod = allProducts.find(p => p.id === currentDetailId);
    if(!prod) return;
    const variant = prod.variants.find(v => v.id === varId);
    if(!variant) return;

    const stockVal = parseFloat(qtyInput);
    if(prod.isLoose) {
        const bq = Number(variant.baseQty) || 1;
        const bu = variant.baseUnit || 'units';
        const total = stockVal * bq;
        display.innerText = `≈ ${total.toFixed(3).replace(/\.?0+$/, '')} ${bu}`;
    } else {
        display.innerText = `≈ ${stockVal} ${variant.quantity || 'pcs'}`;
    }
}

async function submitStockTransfer() {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    
    const tTarget = document.getElementById('transferTargetBranch');
    const tVar = document.getElementById('transferVariant');
    const tQtyInput = document.getElementById('transferQty');
    
    if(!tTarget || !tVar || !tQtyInput) return;
    
    const targetBranch = tTarget.value;
    const variantId = tVar.value;
    const qty = parseFloat(tQtyInput.value);

    if(!targetBranch || !variantId || isNaN(qty) || qty <= 0) return UI.showToast("Invalid transfer details", true);

    const btn = document.getElementById('btnSubmitTransfer');
    if(btn) { btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Transferring...`; btn.disabled = true; }

    try {
        const pIdx = allProducts.findIndex(p => p.id === currentDetailId);
        const prod = allProducts[pIdx];
        const vIdx = prod.variants.findIndex(v => v.id === variantId);
        const variant = prod.variants[vIdx];

        if(variant.stock < qty) throw new Error("Not enough stock available.");

        variant.stock -= qty;
        
        await dbSave('bharatpos_products', allProducts);
        if(db) await setDoc(doc(db, "shops", user.merchantId, "products", prod.id), prod);

        if(db) {
            const targetRef = doc(db, "shops", targetBranch, "products", prod.id);
            const targetSnap = await getDoc(targetRef);

            if(targetSnap.exists()) {
                let targetProd = targetSnap.data();
                let targetVar = targetProd.variants.find(v => v.id === variantId);
                
                if(targetVar) {
                    targetVar.stock = (Number(targetVar.stock) || 0) + qty;
                } else {
                    let newVar = JSON.parse(JSON.stringify(variant));
                    newVar.stock = qty;
                    targetProd.variants.push(newVar);
                }
                await setDoc(targetRef, targetProd);
            } else {
                let clonedProd = JSON.parse(JSON.stringify(prod));
                clonedProd.variants.forEach(v => {
                    if(v.id === variantId) v.stock = qty;
                    else v.stock = 0;
                });
                await setDoc(targetRef, clonedProd);
            }
        }

        UI.showToast("📦 Stock Transferred Successfully!");
        UI.hideModal('transferStockModal');
        applyFilters(); 

    } catch (e) {
        console.error(e);
        UI.showToast("Transfer failed: " + e.message, true);
    } finally {
        if(btn) { btn.innerHTML = `<i class="fa-solid fa-truck-fast"></i> Confirm Transfer`; btn.disabled = false; }
    }
}

// ─── QUAGGA BARCODE ENGINE ───
let targetBarcodeInput = null;

function startBarcodeScan(btn) {
    targetBarcodeInput = btn.parentElement.querySelector('.b-barcode');
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
            
            if(targetBarcodeInput) {
                targetBarcodeInput.value = code;
                targetBarcodeInput = null;
            }
        }
    });
}

function stopBarcodeScan() {
    Quagga.stop();
    UI.hideModal('barcodeScannerModal');
    targetBarcodeInput = null;
}

// KICKSTART
initProducts();