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

        // Await IndexedDB Loading
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
        // Handle Global Branch Switcher populating
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
                            if(e.target.value !== user.merchantId) {
                                // Simple reload redirect handling via storage would go here in full app
                                window.location.reload(); 
                            }
                        });
                    }
                }
            } catch(e) {}
        }

        if(localStorage.getItem('tutorial_inventory') !== 'true') {
            UI.showModal('welcomeTutorial');
        }

        updateDatalists();
        applyFilters(); 
        setupIntersectionObserver();
        addVariantUI();

        const isGstGlobal = localStorage.getItem('bharatpos_gst_mode') === 'true';
        if (isGstGlobal) {
            const tierGst = document.getElementById('tierGst');
            if(tierGst) tierGst.classList.add('active');
            const gstBtn = document.getElementById('btnToggleGst');
            if(gstBtn) {
                gstBtn.style.background = 'var(--blue-50)';
                gstBtn.style.borderColor = 'var(--primary)';
                gstBtn.style.color = 'var(--primary)';
            }
        }

        checkDemandMitraRouting();

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

    document.getElementById('btnAddVariant')?.addEventListener('click', () => addVariantUI());
    
    document.getElementById('variantEngine')?.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.btn-remove-var');
        if (removeBtn) removeBtn.closest('.variant-box').remove();
        
        const addBrandBtn = e.target.closest('.btn-add-brand');
        if (addBrandBtn) {
            const container = e.target.closest('.variant-brands-container').querySelector('.brand-list');
            if(container) container.insertAdjacentHTML('beforeend', getBrandRowHTML());
        }
        
        const removeBrandBtn = e.target.closest('.btn-remove-brand');
        if (removeBrandBtn) {
            const row = e.target.closest('.brand-row');
            const variantBox = row.closest('.variant-box');
            if(row) row.remove();
            if(variantBox) syncVariantMath(variantBox, 'brand'); 
        }

        const scanBtn = e.target.closest('.btn-scan-barcode');
        if (scanBtn) {
            startBarcodeScan(scanBtn);
        }
    });

    document.getElementById('variantEngine')?.addEventListener('input', (e) => {
        if (e.target.classList.contains('vb-stock')) {
            syncVariantMath(e.target.closest('.variant-box'), 'brand');
        }
        if (e.target.classList.contains('v-add-stock')) {
            syncVariantMath(e.target.closest('.variant-box'), 'total');
        }
        if (e.target.classList.contains('v-add-stock') || e.target.classList.contains('v-base-qty') || e.target.classList.contains('v-base-unit') || e.target.classList.contains('v-unit')) {
            updateLiveStockCalc(e.target.closest('.variant-box'));
        }
    });

    document.getElementById('productForm')?.addEventListener('submit', handleSaveProduct);
    document.getElementById('btnOpenSettings')?.addEventListener('click',  () => UI.showModal('settingsModal'));
    document.getElementById('btnCloseSettings')?.addEventListener('click', () => UI.hideModal('settingsModal'));
    
    document.getElementById('cfgAdvFields')?.addEventListener('change', saveConfig);
    document.getElementById('cfgBatch')?.addEventListener('change',     saveConfig);
    document.getElementById('cfgLoose')?.addEventListener('change',     saveConfig);
    document.getElementById('cfgHints')?.addEventListener('change',     saveConfig);
    
    document.getElementById('pIsLoose')?.addEventListener('change', (e) => {
        const engine = document.getElementById('variantEngineWrapper');
        if(engine) {
            if(e.target.checked) engine.classList.add('show-loose'); else engine.classList.remove('show-loose');
        }
        document.querySelectorAll('.variant-box').forEach(box => updateLiveStockCalc(box));
    });

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

    // EVENT DELEGATION FOR INVENTORY GRID
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

function updateLiveStockCalc(box) {
    const stockInput = box.querySelector('.v-add-stock');
    const calcDisplay = box.querySelector('.v-calc-stock');
    if(!stockInput || !calcDisplay) return;

    const stockVal = parseFloat(stockInput.value);
    if (isNaN(stockVal)) {
        calcDisplay.innerText = '';
        return;
    }

    const isLooseToggle = document.getElementById('pIsLoose');
    const isLoose = isLooseToggle ? isLooseToggle.checked : false;

    if (isLoose) {
        const baseQty = parseFloat(box.querySelector('.v-base-qty').value) || 1;
        const baseUnit = box.querySelector('.v-base-unit').value || 'units';
        const total = stockVal * baseQty;
        calcDisplay.innerText = `≈ ${total.toFixed(3).replace(/\.?0+$/, '')} ${baseUnit}`;
    } else {
        const unitType = box.querySelector('.v-unit').value || 'units';
        calcDisplay.innerText = `≈ ${stockVal} ${unitType}`;
    }
}

function syncVariantMath(variantBox, source) {
    const brandStocks = Array.from(variantBox.querySelectorAll('.vb-stock'));
    const totalStockInput = variantBox.querySelector('.v-add-stock');
    if(brandStocks.length === 0) return;

    if (source === 'brand') {
        let sum = 0;
        brandStocks.forEach(input => sum += (parseFloat(input.value) || 0));
        totalStockInput.value = sum;
    } else if (source === 'total') {
        const targetTotal = parseFloat(totalStockInput.value) || 0;
        let filledSum = 0;
        let emptyInputs = [];
        brandStocks.forEach(input => {
            if (input.value === '') emptyInputs.push(input);
            else filledSum += parseFloat(input.value);
        });
        
        if (emptyInputs.length === 1) {
            emptyInputs[0].value = Math.max(0, targetTotal - filledSum);
        } else if (brandStocks.length === 1) {
            brandStocks[0].value = targetTotal;
        }
    }
}

function loadSettings() {
    const isAdv   = localStorage.getItem('cfg_adv_fields') === 'true';
    const isBatch = localStorage.getItem('cfg_batch') === 'true';
    const isLoose = localStorage.getItem('cfg_loose') === 'true';
    const isHints = localStorage.getItem('cfg_hints') !== 'false';

    const elAdv = document.getElementById('cfgAdvFields'); if(elAdv) elAdv.checked = isAdv;
    const elBatch = document.getElementById('cfgBatch'); if(elBatch) elBatch.checked = isBatch;
    const elLoose = document.getElementById('cfgLoose'); if(elLoose) elLoose.checked = isLoose;
    const elHints = document.getElementById('cfgHints'); if(elHints) elHints.checked = isHints;

    applySettingsUI(isAdv, isBatch, isLoose);
}

function saveConfig() {
    const isAdv   = document.getElementById('cfgAdvFields').checked;
    const isBatch = document.getElementById('cfgBatch').checked;
    const isLoose = document.getElementById('cfgLoose').checked;
    const hintsToggle = document.getElementById('cfgHints');
    const isHints = hintsToggle ? hintsToggle.checked : true;

    localStorage.setItem('cfg_adv_fields', isAdv);
    localStorage.setItem('cfg_batch',      isBatch);
    localStorage.setItem('cfg_loose',      isLoose);
    localStorage.setItem('cfg_hints',      isHints);

    applySettingsUI(isAdv, isBatch, isLoose);
    UI.showToast(document.body.classList.contains('lang-hin') ? "Settings badal di gayi" : "Settings Updated");
}

function applySettingsUI(isAdv, isBatch, isLoose) {
    const advCon = document.getElementById('advancedFieldsContainer');
    if(advCon) advCon.style.display = (isAdv || isBatch || isLoose) ? 'block' : 'none';
    
    const batCon = document.getElementById('batchInputContainer');
    if(batCon) batCon.style.display = isBatch ? 'block' : 'none';
    
    const looseCon = document.getElementById('looseInputContainer');
    if(looseCon) looseCon.style.display = isLoose ? 'flex' : 'none';
    
    const engine = document.getElementById('variantEngineWrapper');
    if(engine) {
        if (isAdv) engine.classList.add('show-adv'); else engine.classList.remove('show-adv');
        if (isLoose) engine.classList.add('show-loose'); else engine.classList.remove('show-loose');
    }
}

function checkDemandMitraRouting() {
    const urlParams = new URLSearchParams(window.location.search);
    const restockName = urlParams.get('restock');
    if (restockName) {
        const targetProd = allProducts.find(p => p.name === restockName);
        if(targetProd) {
            loadProductForEdit(targetProd.id);
            const tempStock = localStorage.getItem("temp_add_stock");
            if (tempStock) {
                setTimeout(() => {
                    const stockInputs = document.querySelectorAll('.v-add-stock');
                    if (stockInputs.length > 0) {
                        stockInputs[0].value = tempStock;
                        updateLiveStockCalc(stockInputs[0].closest('.variant-box'));
                    }
                    localStorage.removeItem("temp_add_stock");
                    UI.showToast(`DemandMitra suggests adding ${tempStock} units.`);
                }, 500);
            }
        }
    }
}

function handleExportCSV() {
    if(allProducts.length === 0) return UI.showToast("No products to export", true);
    try {
        const flattened = [];
        allProducts.forEach(p => {
            p.variants.forEach(v => {
                let brandsStr = '';
                if(v.brands && v.brands.length > 0) {
                    brandsStr = v.brands.map(b => `${b.name}(${b.stock})`).join(', ');
                }
                flattened.push({
                    Name: p.name, Category: p.category, Type: v.quantity, Price: v.price, Stock: v.stock,
                    Brands: brandsStr, Barcode: v.barcode, Expiry: v.expiryDate, CostPrice: v.costPrice,
                    BaseQty: v.baseQty, BaseUnit: v.baseUnit, BatchID: p.batchId, HSN: p.hsn, GST: p.gstRate, DateAdded: p.dateAdded
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

function getBrandRowHTML(name = '', stock = '') {
    return `
    <div class="brand-row" style="display:flex; gap:8px; margin-bottom:8px; align-items:center;">
        <div style="flex:2; position:relative;">
            <input type="text" class="form-input vb-name" list="brandList" placeholder="Brand Name" style="padding:10px 12px; font-size:12px;" value="${Security.escapeHtml(name)}">
        </div>
        <div style="flex:1; position:relative;">
            <input type="number" step="0.001" class="form-input vb-stock" placeholder="Stock" style="padding:10px 12px; font-size:12px;" value="${stock}">
        </div>
        <button type="button" class="btn-remove-brand" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:5px;"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

function addVariantUI(data = null) {
    const container = document.getElementById('variantEngine');
    if(!container) return;
    const div = document.createElement('div');
    div.className = 'variant-box';
    const uid = Math.floor(Math.random() * 10000);

    let brandsHtml = '';
    const brandsArray = data?.brands || (data?.brand ? [{name: data.brand, stock: data.stock || 0}] : []);
    if (brandsArray.length > 0) {
        brandsArray.forEach(b => { brandsHtml += getBrandRowHTML(b.name, b.stock); });
    } else {
        brandsHtml = getBrandRowHTML('', ''); 
    }

    div.innerHTML = `
        ${container.children.length > 0 ? `<button type="button" class="btn-remove-var"><i class="fa-solid fa-xmark"></i></button>` : ''}
        <div class="variant-grid">
            <div class="form-group" style="margin-bottom:0;">
                <input type="text" class="form-input v-unit" list="unitOptions" id="u_${uid}" placeholder=" " value="${Security.escapeHtml(data?.quantity || '')}" required>
                <label for="u_${uid}" class="floating-label">Type (Color, Size, ₹, Wt)</label>
            </div>
            <div class="form-group" style="margin-bottom:0;">
                <input type="number" step="0.001" class="form-input v-add-stock" id="s_${uid}" placeholder=" " value="${data?.stock || ''}">
                <label for="s_${uid}" class="floating-label" style="color:var(--success);">Total Stock</label>
                <div class="v-calc-stock" style="font-size:11px; font-weight:800; color:var(--primary); margin-top:6px; text-align:right; min-height:14px;"></div>
            </div>
        </div>
        <div class="form-group" style="margin-top:10px;margin-bottom:0;">
            <input type="number" step="0.01" class="form-input v-price" id="p_${uid}" placeholder=" " value="${data?.price || ''}" required style="font-size:17px;font-weight:800;color:var(--success);font-family:'JetBrains Mono',monospace;">
            <label for="p_${uid}" class="floating-label">Selling Price (₹)</label>
        </div>
        
        <div class="variant-brands-container adv-only-field" style="margin-top:10px; border-top:1px dashed var(--border); padding-top:10px;">
           <label class="floating-label" style="position:static; display:block; margin-bottom:8px; color:var(--primary); font-weight:700;"><i class="fa-solid fa-copyright"></i> Brands & Stock List</label>
           <div class="brand-list">${brandsHtml}</div>
           <button type="button" class="btn btn-dashed btn-add-brand" style="padding: 6px; font-size: 11px; width:auto; display:inline-block;"><i class="fa-solid fa-plus"></i> Add Brand</button>
        </div>

        <div class="variant-grid adv-only-field">
            <div class="form-group" style="margin-bottom:0; position:relative;">
                <input type="text" class="form-input v-barcode" placeholder=" " value="${Security.escapeHtml(data?.barcode || '')}" style="font-family:'JetBrains Mono'; padding-right:40px;">
                <button type="button" class="btn-scan-barcode" style="position:absolute; right:8px; top:11px; background:none; border:none; color:var(--primary); font-size:16px; cursor:pointer;"><i class="fa-solid fa-barcode"></i></button>
                <label class="floating-label"><i class="fa-solid fa-barcode"></i> Barcode</label>
            </div>
            <div class="form-group" style="margin-bottom:0;">
                <input type="number" step="0.01" class="form-input v-cost" placeholder=" " value="${data?.costPrice || ''}">
                <label class="floating-label"><i class="fa-solid fa-tags"></i> Cost Price</label>
            </div>
        </div>
        <div class="form-group adv-only-field" style="margin-bottom:0;">
            <input type="date" class="form-input v-expiry" placeholder=" " value="${Security.escapeHtml(data?.expiryDate || '')}">
            <label class="floating-label"><i class="fa-regular fa-calendar-xmark"></i> Expiry Date</label>
        </div>

        <div class="form-group loose-only-field" style="margin-bottom:0;">
            <div style="display:flex; gap:8px;">
                <input type="number" step="0.001" class="form-input v-base-qty" placeholder=" " value="${data?.baseQty || ''}" style="flex:1;">
                <input type="text" class="form-input v-base-unit" list="unitOptions" placeholder="Unit" value="${Security.escapeHtml(data?.baseUnit || 'pcs')}" style="width: 90px;">
            </div>
            <label class="floating-label"><i class="fa-solid fa-scale-balanced"></i> 1 Stock Contains</label>
        </div>

        <input type="hidden" class="v-id" value="${Security.escapeHtml(data?.id || '')}">
        <input type="hidden" class="v-added" value="${Security.escapeHtml(data?.dateAdded || '')}">
    `;
    container.appendChild(div);
    updateLiveStockCalc(div);
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

        const advEl = document.getElementById('cfgAdvFields');
        const looseEl = document.getElementById('cfgLoose');
        const batchEl = document.getElementById('cfgBatch');
        
        const isAdv      = advEl ? advEl.checked : false;
        const isLooseCfg = looseEl ? looseEl.checked : false;
        const isBatchCfg = batchEl ? batchEl.checked : false;

        const pLooseEl = document.getElementById('pIsLoose');
        const isLoose = isLooseCfg ? (pLooseEl ? pLooseEl.checked : false) : false;
        
        const pBatchEl = document.getElementById('pBatchId');
        const batchId = isBatchCfg ? (pBatchEl ? pBatchEl.value.trim() : "") : "";
        
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

        const variantBoxes = document.querySelectorAll('.variant-box');
        for (let i = 0; i < variantBoxes.length; i++) {
            const box      = variantBoxes[i];
            const unit     = box.querySelector('.v-unit').value.trim();
            const price    = box.querySelector('.v-price').value;
            const stock    = parseFloat(box.querySelector('.v-add-stock').value) || 0;

            let vId        = box.querySelector('.v-id').value || `var_${Date.now()}_${i}`;
            let vAdded     = box.querySelector('.v-added').value || nowIso;
            
            let vBarcode   = isAdv ? box.querySelector('.v-barcode').value : "";
            let vExpiry    = isAdv ? box.querySelector('.v-expiry').value : "";
            let vCost      = isAdv ? box.querySelector('.v-cost').value : "";
            let vBaseQty   = isLoose ? box.querySelector('.v-base-qty').value : "";
            let vBaseUnit  = isLoose ? box.querySelector('.v-base-unit').value : "pcs";

            let vBrands = [];
            if(isAdv) {
                const brandRows = box.querySelectorAll('.brand-row');
                brandRows.forEach(row => {
                    const bName = row.querySelector('.vb-name').value.trim();
                    const bStock = parseFloat(row.querySelector('.vb-stock').value) || 0;
                    if(bName || bStock > 0) vBrands.push({ name: bName, stock: bStock });
                });
            }

            productDoc.variants.push({
                id: vId, quantity: unit, price: parseFloat(price), stock: stock,
                brands: vBrands, barcode: vBarcode, expiryDate: vExpiry, costPrice: vCost, 
                baseQty: vBaseQty, baseUnit: vBaseUnit
            });
        }

        if(currentEditingId) {
            allProducts = allProducts.filter(p => p.id !== currentEditingId);
        }
        allProducts.push(productDoc);

        await dbSave('bharatpos_products', allProducts);
        updateDatalists();
        applyFilters();

        document.getElementById('productForm').reset();
        document.getElementById('variantEngine').innerHTML = '';
        addVariantUI();
        currentEditingId = null;
        currentEditingDate = null;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        UI.showToast("✅ SKU Saved Successfully");

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
            if(v.brands) v.brands.forEach(b => { if(b.name) brands.add(b.name); });
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
        filtered = filtered.filter(p => p.variants.some(v => v.brands && v.brands.some(b => b.name === filterState.brand)));
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
        const basePrice = p.variants[0].price;
        const tier     = getTier(p.variants[0].id);
        const formatTotalStock = Formatters.stock(totalStock, p.variants[0].quantity);
        const isChecked = selectedBulkItems.has(p.id) ? 'checked' : '';

        let displayBrand = '';
        if(p.variants[0].brands && p.variants[0].brands.length > 0) {
            displayBrand = ` • ${Security.escapeHtml(p.variants[0].brands[0].name)}${p.variants[0].brands.length > 1 ? ' (+More)' : ''}`;
        }

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
                    ${vCount > 1 ? `${vCount} Variants` : Security.escapeHtml(p.variants[0].quantity)}${displayBrand}
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
            
            let brandsSummary = '';
            if(v.brands && v.brands.length > 0) {
                brandsSummary = `<div style="font-size:10px; color:var(--slate-500); margin-top:4px; font-weight:700;"><i class="fa-solid fa-copyright"></i> ` + v.brands.map(b => `${Security.escapeHtml(b.name)} (${b.stock})`).join(', ') + `</div>`;
            }

            if(v.barcode) details.push(`<span style="color:var(--slate-500);"><i class="fa-solid fa-barcode"></i> ${Security.escapeHtml(v.barcode)}</span>`);
            if(v.expiryDate) details.push(`<span style="color:var(--slate-500);"><i class="fa-solid fa-calendar-xmark"></i> Exp: ${Security.escapeHtml(v.expiryDate)}</span>`);
            if(v.costPrice) details.push(`<span style="color:var(--slate-500);"><i class="fa-solid fa-tags"></i> Cost: ₹${Security.escapeHtml(v.costPrice)}</span>`);
            if(base.isLoose && v.baseQty) details.push(`<span style="color:var(--slate-500);"><i class="fa-solid fa-scale-balanced"></i> Base: ${v.baseQty} ${Security.escapeHtml(v.baseUnit)||'pcs'}</span>`);
            
            let detailsHtml = details.length > 0 ? `<div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:8px; padding-top:8px; border-top:1.5px dashed var(--border); font-size:11px; font-weight:700;">${details.join('')}</div>` : '';

            return `
            <div style="background:var(--white);padding:16px;border-radius:12px;border:1.5px solid var(--border);box-shadow:var(--shadow-sm);">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-weight:800;font-size:14px;color:var(--text-main); font-family:var(--font-head);">${Security.escapeHtml(v.quantity)}</div>
                        ${brandsSummary}
                    </div>
                    <div style="text-align:right;">
                        <div style="color:var(--success);font-weight:800;font-family:'JetBrains Mono';font-size:16px;">₹${v.price}</div>
                        <div style="font-size:11px;color:${v.stock <= threshold ? 'var(--danger)' : 'var(--slate-500)'};font-weight:700;margin-top:4px;">Stock: ${Formatters.stock(v.stock, v.quantity)}</div>
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

    if (base.batchId) { const cb = document.getElementById('cfgBatch'); if(cb) cb.checked = true; }
    if (base.isLoose) { const cl = document.getElementById('cfgLoose'); if(cl) cl.checked = true; }
    if (base.variants.some(v => (v.brands && v.brands.length>0) || v.barcode || v.expiryDate || v.costPrice) || base.reorderPoint) {
        const ca = document.getElementById('cfgAdvFields'); if(ca) ca.checked = true;
    }

    const ca = document.getElementById('cfgAdvFields');
    const cb = document.getElementById('cfgBatch');
    const cl = document.getElementById('cfgLoose');
    applySettingsUI(ca?ca.checked:false, cb?cb.checked:false, cl?cl.checked:false);

    if (base.hsn || base.gstRate) {
        const gstContent = document.getElementById('tierGst');
        if (gstContent && !gstContent.classList.contains('active')) {
            gstContent.classList.add('active');
            const gstBtn = document.getElementById('btnToggleGst');
            if(gstBtn) {
                gstBtn.style.background  = 'var(--blue-50)';
                gstBtn.style.borderColor = 'var(--primary)';
                gstBtn.style.color       = 'var(--primary)';
            }
        }
    }

    const eng = document.getElementById('variantEngine');
    if(eng) eng.innerHTML = '';
    base.variants.forEach(v => addVariantUI(v));

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
    
    const cl = document.getElementById('cfgLoose');
    const pil = document.getElementById('pIsLoose');
    if (cl && cl.checked && pil) {
        pil.checked = p.isLoose || false;
    }

    const firstRow = document.querySelector('.variant-box');
    if (firstRow) {
        const vu = firstRow.querySelector('.v-unit'); if(vu && p.quantity) vu.value = p.quantity;
        const vp = firstRow.querySelector('.v-price'); if(vp && p.price) vp.value = p.price;
    }

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
                const brandStr = String(row['Brand'] || '');
                const brandsArray = brandStr ? [{ name: brandStr, stock: parseFloat(row['Stock'] || row['Qty'] || 0) }] : [];

                const productDoc = {
                    id: skuId, name: String(name), category: String(row['Category'] || 'General'),
                    hsn: String(row['HSN'] || ''), gstRate: String(row['GST'] || ''), batchId: '',
                    reorderPoint: String(row['Reorder Point'] || row['Min Stock'] || ''),
                    isLoose: String(row['Loose'] || '').toLowerCase() === 'true', dateAdded: new Date().toISOString(),
                    variants: [{
                        id: `${skuId}_v0`,
                        quantity: String(row['Type'] || row['Unit'] || '1 pcs'),
                        price: parseFloat(row['Price'] || row['Sell Price'] || row['Rate'] || 0),
                        stock: parseFloat(row['Stock'] || row['Qty'] || 0),
                        brands: brandsArray, barcode: String(row['Barcode'] || ''),
                        costPrice: String(row['CostPrice'] || row['Cost'] || ''), expiryDate: String(row['Expiry'] || ''), 
                        baseQty: String(row['BaseQty'] || ''), baseUnit: String(row['BaseUnit'] || 'pcs')
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
                const brandsArray = p.brand ? [{ name: p.brand, stock: p.stock || 0 }] : [];
                return {
                    id: p.id, name: p.name, category: p.category, hsn: p.hsn, gstRate: p.gstRate, priceType: p.priceType,
                    isLoose: p.isLoose, batchId: p.batchId, reorderPoint: p.reorderPoint, dateAdded: p.dateAdded || new Date().toISOString(),
                    variants: [{
                        id: `${p.id}_v0`, quantity: p.quantity || '1 pcs', price: p.price || 0, stock: p.stock || 0,
                        brands: brandsArray, barcode: p.barcode || '', expiryDate: p.expiryDate || '', costPrice: p.costPrice || '',
                        baseQty: p.baseQty || '', baseUnit: p.baseUnit || 'pcs'
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
        const url  = 'https://server-xy7s.onrender.com/ai-product-scan';
        const res  = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: base64 }) });
        const data = await res.json();

        if (data && data.success && data.product) {
            const pN = document.getElementById("pName"); if(pN && !pN.value) pN.value = data.product.name || "";
            const pC = document.getElementById("pCategory"); if(pC && !pC.value) pC.value = data.product.category || "";

            const firstVariant = document.querySelector('.variant-box');
            if (firstVariant && data.product.price) {
                const vP = firstVariant.querySelector('.v-price');
                if(vP && !vP.value) vP.value = data.product.price;
            }

            const advEl = document.getElementById('cfgAdvFields');
            if (advEl && advEl.checked && firstVariant) {
                const bCode = firstVariant.querySelector('.v-barcode');
                const eDate = firstVariant.querySelector('.v-expiry');
                if (data.product.expiry_date && eDate && !eDate.value) eDate.value = data.product.expiry_date;
                if (data.product.barcode && bCode && !bCode.value) bCode.value = data.product.barcode;
            }
            UI.showToast("✨ AI Auto-fill complete");
        }
    } catch (e) {
        UI.showToast("AI Lens failed", true);
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
        
        if(variant.brands && variant.brands.length > 0) {
            let remaining = qty;
            for(let b of variant.brands) {
                if(remaining <= 0) break;
                let deduct = Math.min(b.stock, remaining);
                b.stock -= deduct;
                remaining -= deduct;
            }
        }

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
                    if(targetVar.brands && targetVar.brands.length > 0) {
                        targetVar.brands[0].stock = (Number(targetVar.brands[0].stock) || 0) + qty;
                    }
                } else {
                    let newVar = JSON.parse(JSON.stringify(variant));
                    newVar.stock = qty;
                    if(newVar.brands && newVar.brands.length > 0) {
                       newVar.brands.forEach((b, i) => b.stock = i === 0 ? qty : 0);
                    }
                    targetProd.variants.push(newVar);
                }
                await setDoc(targetRef, targetProd);
            } else {
                let clonedProd = JSON.parse(JSON.stringify(prod));
                clonedProd.variants.forEach(v => {
                    if(v.id === variantId) {
                        v.stock = qty;
                        if(v.brands && v.brands.length > 0) {
                           v.brands.forEach((b, i) => b.stock = i === 0 ? qty : 0);
                        }
                    } else {
                        v.stock = 0;
                        if(v.brands) v.brands.forEach(b => b.stock = 0);
                    }
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
    targetBarcodeInput = btn.parentElement.querySelector('.v-barcode');
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

