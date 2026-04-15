// File: /js/pages/dashboard.js

import { db } from '../core/firebase.js';
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { dbGet, dbSave } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';
import { Security } from '../utils/security.js';
import { Formatters } from '../utils/formatters.js';
import { Modals } from '../components/modals.js'; // Ensure receipt modal is injected

// --- ENCAPSULATED STATE ---
let enterpriseSales = [];
let enterpriseProducts = [];
let currentBranch = 'all'; 
let mapInstance = null;
let mapMarker = null;

// --- INITIALIZATION ---
async function initDashboard() {
    Navigation.inject('dashboard');
    Modals.injectReceiptModal();

    // 2. RESTORE CUSTOM DASHBOARD NAVBAR BUTTONS
    const navActions = document.getElementById('mainNavActions');
    if(navActions) {
        const defaultPos = navActions.querySelector('.btn-primary');
        if(defaultPos) defaultPos.remove(); 

        navActions.insertAdjacentHTML('beforeend', `
            <button id="btnAddBranchNav" class="btn-nav" style="background:var(--primary-gradient); color:white; border:none;" title="Add New Branch"><i class="fa-solid fa-plus"></i></button>
            <button id="btnViewMap" class="btn-nav" title="View Map" style="display:none;"><i class="fa-solid fa-map-location-dot"></i></button>
            <button onclick="window.location.href='billing.html'" class="btn btn-primary" style="padding:8px 14px; font-size:13px; width:auto; border-radius:10px;"><i class="fa-solid fa-file-invoice"></i> <span data-i18n="nav_billing">Bill</span></button>
        `);
    }

    setGreeting();
    initDragAndDrop();
    logAudit("System Boot", "Main Dashboard initialized.");
    
    bindAllEvents();
    await loadEnterpriseData();
}

// --- EVENT BINDING ---
function bindAllEvents() {
    document.getElementById('kpiTimeFilter')?.addEventListener('change', () => {
        renderKPIs(currentBranch === 'all' ? enterpriseSales : enterpriseSales.filter(s => s._branchId === currentBranch || s.merchantId === currentBranch));
    });

    document.body.addEventListener('click', (e) => {
        // Nav Buttons
        if(e.target.closest('#btnViewMap')) openMap();
        if(e.target.closest('#btnAddBranchNav') || e.target.closest('#btnQuickBranch')) UI.showModal('addBranchModal');
        
        // Modals Close
        if(e.target.closest('#btnCloseBranchModal')) UI.hideModal('addBranchModal');
        if(e.target.closest('#btnCloseMapModal')) closeMap();
        if(e.target.closest('#btnCloseCustomerModal')) UI.hideModal('customerModal');
        if(e.target.closest('#btnCloseReceipt')) UI.hideModal('receiptModal');
        if(e.target.classList.contains('modal-overlay')) UI.hideModal(e.target.id);

        // Udhaar View
        if(e.target.closest('#btnOpenUdhaar')) openUdhaarSection();
        if(e.target.closest('#btnCloseUdhaar')) closeUdhaarSection();

        // Branch Creation
        if(e.target.closest('#btnSubmitBranch')) submitNewBranch();

        // Dynamic Actions via Delegation
        const restockBtn = e.target.closest('[data-action="restock"]');
        if(restockBtn) {
            localStorage.setItem("temp_add_stock", restockBtn.getAttribute('data-qty'));
            window.location.href = `products.html?restock=${encodeURIComponent(restockBtn.getAttribute('data-name'))}`;
        }

        const custBtn = e.target.closest('[data-action="open-customer"]');
        if(custBtn) openCustomerModal(custBtn.getAttribute('data-phone'));

        const receiptBtn = e.target.closest('[data-action="open-receipt"]');
        if(receiptBtn) openReceipt(receiptBtn.getAttribute('data-json'));
    });
}

// --- UTILS ---
function setGreeting() {
    const d = new Date();
    const el = document.getElementById('dateDisplay');
    if(el) el.textContent = d.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function logAudit(action, details) {
    let logs = JSON.parse(localStorage.getItem('bharatpos_audit') || '[]');
    logs.unshift({ time: new Date().toISOString(), action: action, details: details, user: "Admin" });
    if(logs.length > 20) logs = logs.slice(0, 20); 
    localStorage.setItem('bharatpos_audit', JSON.stringify(logs));
    if(document.getElementById('auditListBox')) renderAuditTrail();
}

// --- DATA LOADING ---
async function loadEnterpriseData() {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const mobile = user.mobile || user.phone;

    let shops = [{ merchantId: user.merchantId, shopName: user.shopName || 'Main Shop', lat: user.lat, lng: user.lng }];

    const storedShopsStr = localStorage.getItem(`bharatpos_shops_${mobile}`);
    if (storedShopsStr) {
        try {
            const fetchedShops = JSON.parse(storedShopsStr);
            if (fetchedShops && fetchedShops.length > 0) {
                shops = fetchedShops;
                const switcher = document.getElementById('globalShopSwitcher');
                if (switcher && shops.length > 1) {
                    switcher.style.display = 'inline-block';
                    switcher.innerHTML = '<option value="all">🌍 All Branches</option>' + 
                        shops.map(s => `<option value="${s.merchantId}" ${s.merchantId === user.merchantId ? 'selected' : ''}>${Security.escapeHtml(s.shopName)}</option>`).join('');
                    
                    switcher.value = user.merchantId;
                    currentBranch = user.merchantId; 

                    // Attach switcher event manually since it was injected dynamically
                    switcher.addEventListener('change', (e) => {
                        const val = e.target.value;
                        if (val === 'all') {
                            currentBranch = 'all';
                            UI.showToast("Showing All Branches");
                            renderAllWidgets();
                        } else {
                            currentBranch = val;
                            renderAllWidgets();
                        }
                    });
                }
            }
        } catch(e) {}
    }

    let localSales = await dbGet('bharatpos_sales', '[]');
    let eSales = await dbGet('bharatpos_enterprise_sales', '[]');
    
    let mergedSalesMap = {};
    [...eSales, ...localSales].forEach(s => mergedSalesMap[s.id] = s);
    enterpriseSales = Object.values(mergedSalesMap).sort((a, b) => new Date(b.date) - new Date(a.date));

    let eProds = await dbGet('bharatpos_enterprise_products', 'null');
    if (eProds === null) eProds = await dbGet('bharatpos_products', '[]');
    
    enterpriseProducts = eProds.map(p => {
        if (!p.variants || !Array.isArray(p.variants) || p.variants.length === 0) {
            p.variants = [{
                id: p.id + '_v0', quantity: p.quantity || '1 pcs', price: Number(p.price) || 0,
                stock: Number(p.stock) || 0, barcode: p.barcode || '', baseQty: 1, baseUnit: 'pcs'
            }];
        }
        return p;
    });
    
    if(enterpriseSales.length > 0 || enterpriseProducts.length > 0) renderAllWidgets();

    if (db && navigator.onLine) {
        try {
            if (user.merchantId && localSales.length > 0) {
                const batch = writeBatch(db);
                let ops = 0;
                localSales.forEach(sale => {
                    const ref = doc(db, "shops", user.merchantId, "sales", sale.id);
                    batch.set(ref, sale, { merge: true });
                    ops++;
                });
                if (ops > 0) await batch.commit();
            }

            let tempSalesMap = {};
            let tempProds = [];

            const fetchPromises = shops.map(async (shop) => {
                if(!shop.merchantId) return;
                try {
                    const salesRef = collection(db, "shops", shop.merchantId, "sales");
                    const sSnap = await getDocs(salesRef);
                    sSnap.forEach(d => { 
                        let data = d.data(); 
                        data._branchId = shop.merchantId; 
                        tempSalesMap[data.id] = data; 
                    });

                    const prodRef = collection(db, "shops", shop.merchantId, "products");
                    const pSnap = await getDocs(prodRef);
                    pSnap.forEach(d => { 
                        let data = d.data(); 
                        data._branchId = shop.merchantId; 
                        data._branchName = shop.shopName; 
                        tempProds.push(data); 
                    });
                } catch(e) {}
            });
            
            await Promise.all(fetchPromises);
            
            localSales.forEach(s => { if(!tempSalesMap[s.id]) tempSalesMap[s.id] = s; });
            enterpriseSales = Object.values(tempSalesMap).sort((a, b) => new Date(b.date) - new Date(a.date));
            
            enterpriseProducts = tempProds.map(p => {
                if (!p.variants || !Array.isArray(p.variants) || p.variants.length === 0) {
                    p.variants = [{
                        id: p.id + '_v0', quantity: p.quantity || '1 pcs', price: Number(p.price) || 0,
                        stock: Number(p.stock) || 0, barcode: p.barcode || '', baseQty: 1, baseUnit: 'pcs'
                    }];
                }
                return p;
            });
            
            await dbSave('bharatpos_enterprise_sales', enterpriseSales);
            await dbSave('bharatpos_enterprise_products', enterpriseProducts);
            
            renderAllWidgets();
        } catch (e) {
            console.warn("Enterprise Fetch Error", e);
        }
    }
}

// --- RENDERERS ---
function renderAllWidgets() {
    const fSales = currentBranch === 'all' ? enterpriseSales : enterpriseSales.filter(s => s._branchId === currentBranch || s.merchantId === currentBranch);
    const fProds = currentBranch === 'all' ? enterpriseProducts : enterpriseProducts.filter(p => p._branchId === currentBranch || p.merchantId === currentBranch);

    const mapBtn = document.getElementById('btnViewMap');
    if(mapBtn) {
        if(currentBranch === 'all') mapBtn.style.display = 'none';
        else mapBtn.style.display = 'flex';
    }

    renderKPIs(fSales);
    renderSalesChart(fSales);
    renderPeakHours(fSales);
    renderPOs(fProds);
    renderExpiry(fProds);
    renderAuditTrail();
}

function renderKPIs(sales) {
    const tf = document.getElementById('kpiTimeFilter');
    const timeFilter = tf ? tf.value : 'all';
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = new Date().toISOString().split('T')[0];
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    let tRev = 0, tBills = 0, tItems = 0, udhaar = 0;

    sales.forEach(s => {
        const dStr = new Date(s.date).toISOString().split('T')[0];
        const dDate = new Date(s.date);
        const total = Number(s.total || s.amount || 0);
        const pMode = s.paymentMethod || s.paymentMode || 'Cash';

        let inTimeframe = false;
        if(timeFilter === 'today' && dStr === todayStr) inTimeframe = true;
        else if(timeFilter === 'month' && dDate >= startOfMonth) inTimeframe = true;
        else if(timeFilter === 'all') inTimeframe = true;

        if(inTimeframe) {
            tBills++;
            (s.items||[]).forEach(i => tItems += Number(i.qty || 1));
            
            if (pMode === 'Partial' && s.split) {
                tRev += Number(s.split.cash || 0) + Number(s.split.online || 0);
            } else if (pMode !== 'Udhaar') {
                tRev += total;
            }
        }

        if(s.isPaid && s.settledDate) {
            const setStr = new Date(s.settledDate).toISOString().split('T')[0];
            const setDate = new Date(s.settledDate);
            
            let settledInTimeframe = false;
            if(timeFilter === 'today' && setStr === todayStr) settledInTimeframe = true;
            else if(timeFilter === 'month' && setDate >= startOfMonth) settledInTimeframe = true;
            else if(timeFilter === 'all') settledInTimeframe = true;

            if(settledInTimeframe && setStr !== dStr) {
                tRev += (pMode === 'Partial (Settled)' && s.split) ? Number(s.split.udhaar || 0) : total;
            }
        }

        if(s.split && Number(s.split.udhaar) > 0 && !s.isPaid) udhaar += Number(s.split.udhaar);
        else if((pMode === 'Udhaar' || s.paymentMode === 'Udhaar') && !s.isPaid) udhaar += total;
    });

    let formattedItems = tItems % 1 !== 0 ? tItems.toFixed(2).replace(/\.?0+$/, '') : tItems;

    const elRev = document.getElementById('kpiRev'); if(elRev) elRev.innerText = `₹${Formatters.currency(tRev)}`;
    const elBills = document.getElementById('kpiBills'); if(elBills) elBills.innerText = Formatters.currency(tBills);
    const elItems = document.getElementById('kpiItems'); if(elItems) elItems.innerText = Formatters.currency(formattedItems);
    const elUdh = document.getElementById('kpiUdhaar'); if(elUdh) elUdh.innerText = `₹${Formatters.currency(udhaar)}`;
}

function renderSalesChart(sales) {
    const box = document.getElementById('salesChartBox');
    if(!box) return;
    const today = new Date();
    let maxVal = 0;
    const daysData = [];
    
    for(let i=6; i>=0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const dStr = d.toISOString().split('T')[0];
        
        let dayTotal = 0;
        sales.forEach(s => {
            const sDateStr = new Date(s.date).toISOString().split('T')[0];
            if(sDateStr === dStr) dayTotal += Number(s.total || 0);
        });
        if(dayTotal > maxVal) maxVal = dayTotal;
        daysData.push({ date: d, val: dayTotal });
    }

    box.innerHTML = daysData.map(item => {
        const h = maxVal > 0 ? (item.val / maxVal * 100) : 5; 
        const dateStr = item.date.toLocaleDateString('en-US',{weekday:'short'});
        return `
        <div class="bar-group">
            <div class="bar" style="height:${h}%" data-val="₹${item.val.toFixed(0)}"></div>
            <div class="bar-label">${dateStr}</div>
        </div>`;
    }).join('');
}

function renderPeakHours(sales) {
    const box = document.getElementById('peakHoursBox');
    if(!box) return;
    const today = new Date(); today.setHours(0,0,0,0);
    
    const hourCounts = new Array(13).fill(0);
    let maxCount = 0;

    sales.forEach(s => {
        const d = new Date(s.date);
        if(d >= today) {
            const h = d.getHours();
            if(h >= 9 && h <= 21) {
                hourCounts[h - 9]++;
                if(hourCounts[h - 9] > maxCount) maxCount = hourCounts[h - 9];
            }
        }
    });

    const labels = ['9a','','11a','','1p','','3p','','5p','','7p','','9p'];

    if(maxCount === 0) {
        box.innerHTML = `<div class="empty-state"><i class="fa-solid fa-mug-hot"></i><p>No sales today yet.</p></div>`;
        return;
    }

    box.innerHTML = hourCounts.map((count, idx) => {
        const h = maxCount > 0 ? (count / maxCount * 100) : 5;
        const isPeak = (count >= maxCount * 0.8) && maxCount > 2;
        const colorClass = isPeak ? 'bar-heat' : '';
        
        return `
        <div class="bar-group">
            <div class="bar ${colorClass}" style="height:${Math.max(5, h)}%" data-val="${count} Bills"></div>
            <div class="bar-label">${labels[idx]}</div>
        </div>`;
    }).join('');
}

function renderPOs(products) {
    const box = document.getElementById('poListBox');
    if(!box) return;
    let poList = [];

    products.forEach(p => {
        const threshold = (p.reorderPoint !== undefined && p.reorderPoint !== '') ? Number(p.reorderPoint) : 5;
        (p.variants || []).forEach(v => {
            let stock = Number(v.stock || 0);
            if(p.isLoose) stock = stock * (Number(v.baseQty) || 1);
            
            if(stock <= threshold) {
                const vendor = v.brands && v.brands.length > 0 ? v.brands[0].name : 'General Supplier';
                const orderQty = Math.max(10, Math.round(threshold * 2)); 
                poList.push({ rawName: p.name, displayName: `${p.name} (${v.quantity})`, vendor, qty: orderQty, branch: p._branchName });
            }
        });
    });

    if(poList.length === 0) {
        box.innerHTML = `<div class="empty-state"><i class="fa-solid fa-check-double" style="color:var(--success);"></i><p>Stock levels healthy. No POs needed.</p></div>`;
        return;
    }

    box.innerHTML = poList.slice(0, 5).map(po => `
        <div class="list-item">
            <div>
                <div class="li-title">${Security.escapeHtml(po.displayName)}</div>
                <div class="li-sub">Vendor: ${Security.escapeHtml(po.vendor)} ${currentBranch === 'all' && po.branch ? `• Loc: ${Security.escapeHtml(po.branch)}` : ''}</div>
            </div>
            <button data-action="restock" data-name="${Security.escapeHtml(po.rawName)}" data-qty="${po.qty}" class="li-badge badge-danger btn-order-action">
                <i class="fa-solid fa-cart-plus"></i> Order: ${po.qty}
            </button>
        </div>
    `).join('');
}

function renderExpiry(products) {
    const box = document.getElementById('expiryListBox');
    if(!box) return;
    let expList = [];
    const today = new Date();
    const limitDate = new Date(); limitDate.setDate(today.getDate() + 30); 

    products.forEach(p => {
        (p.variants || []).forEach(v => {
            if(v.expiryDate) {
                const exp = new Date(v.expiryDate);
                if(exp <= limitDate) {
                    const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
                    expList.push({ name: `${p.name} (${v.quantity})`, days: diffDays, branch: p._branchName });
                }
            }
        });
    });

    expList.sort((a,b) => a.days - b.days);

    if(expList.length === 0) {
        box.innerHTML = `<div class="empty-state"><i class="fa-solid fa-shield-check" style="color:var(--success);"></i><p>No items expiring within 30 days.</p></div>`;
        return;
    }

    box.innerHTML = expList.slice(0, 5).map(ex => {
        let badgeClass = ex.days <= 7 ? 'badge-danger' : 'badge-warning';
        let dayText = ex.days < 0 ? 'Expired' : (ex.days === 0 ? 'Today' : `${ex.days} Days`);
        return `
        <div class="list-item">
            <div>
                <div class="li-title">${Security.escapeHtml(ex.name)}</div>
                <div class="li-sub">${currentBranch === 'all' && ex.branch ? `Loc: ${Security.escapeHtml(ex.branch)}` : 'Needs Attention'}</div>
            </div>
            <div class="li-badge ${badgeClass}">${dayText}</div>
        </div>`;
    }).join('');
}

function renderAuditTrail() {
    const box = document.getElementById('auditListBox');
    if(!box) return;
    let logs = JSON.parse(localStorage.getItem('bharatpos_audit') || '[]');
    
    if(logs.length === 0) {
        box.innerHTML = `<div class="empty-state"><p>No recent activity.</p></div>`;
        return;
    }

    box.innerHTML = logs.slice(0, 10).map(log => {
        const logDate = new Date(log.time);
        const timeStr = logDate.toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'});
        const dateStr = logDate.toLocaleDateString('en-IN', {day:'2-digit', month:'short'});
        return `
        <div class="audit-item">
            <div class="audit-time">${dateStr}, ${timeStr}</div>
            <div class="audit-text">${Security.escapeHtml(log.action)}: ${Security.escapeHtml(log.details)}</div>
            <div class="audit-user"><i class="fa-regular fa-user"></i> ${Security.escapeHtml(log.user)}</div>
        </div>`;
    }).join('');
}

// --- BRANCH CREATION ---
async function submitNewBranch() {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const shopName = document.getElementById('newBranchName').value.trim();
    const category = document.getElementById('newBranchCat').value;
    
    if(!shopName) return UI.showToast("Enter Branch Name", true);
    
    let mobileNum = user.mobile || user.phone;
    if(!mobileNum) {
        mobileNum = prompt("Link branch to your 10-digit Mobile Number:");
        if(!mobileNum || mobileNum.trim().length !== 10) return UI.showToast("Valid mobile number required.", true);
        user.mobile = mobileNum.trim();
        localStorage.setItem('bharatpos_user', JSON.stringify(user));
    }

    if(!user.merchantId || !db) return UI.showToast("Network Error: Cannot connect to cloud.", true);

    try {
        const btn = document.getElementById('btnSubmitBranch');
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Creating...`; 
        btn.disabled = true;
        
        const branchId = `${user.merchantId}-B${Math.floor(1000 + Math.random() * 9000)}`;
        const shopRef = doc(db, "shops", branchId);
        
        await setDoc(shopRef, {
            merchantId: branchId,
            profile: { mobile: mobileNum, shopName, category, isBranch: true, parentId: user.merchantId }
        });
        
        // FIX: Update local cache so switcher sees it immediately
        const cacheKey = `bharatpos_shops_${mobileNum}`;
        let cachedShops = JSON.parse(localStorage.getItem(cacheKey) || '[]');
        cachedShops.push({
            merchantId: branchId,
            shopName: shopName,
            category: category,
            isMain: false
        });
        localStorage.setItem(cacheKey, JSON.stringify(cachedShops));

        UI.showToast(`Branch '${Security.escapeHtml(shopName)}' created successfully!`);
        UI.hideModal('addBranchModal');
        document.getElementById('newBranchName').value = '';
        
        logAudit("Branch Created", `New branch '${shopName}' added to network.`);
        
        setTimeout(()=> window.location.reload(), 1000);
    } catch(e) { 
        UI.showToast("Firebase Error: Could not create branch.", true);
        console.error(e);
    } finally {
        const btn = document.getElementById('btnSubmitBranch');
        btn.innerText = "Create Branch Shop"; 
        btn.disabled = false;
    }
}

// --- MAP & GPS LOGIC ---
function openMap() {
    if(currentBranch === 'all') return;
    
    UI.showModal('mapModal');
    
    setTimeout(async () => {
        if(mapInstance) { mapInstance.remove(); mapInstance = null; }

        let lat = 20.5937, lng = 78.9629, zoom = 5;
        if(db) {
            try {
                const docSnap = await getDoc(doc(db, "shops", currentBranch));
                if(docSnap.exists() && docSnap.data().profile?.lat) {
                    lat = docSnap.data().profile.lat;
                    lng = docSnap.data().profile.lng;
                    zoom = 15;
                }
            } catch(e) {}
        }

        mapInstance = L.map('shopMap', { zoomControl: false }).setView([lat, lng], zoom);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap' }).addTo(mapInstance);
        
        if(zoom === 15) {
            mapMarker = L.marker([lat, lng]).addTo(mapInstance).bindPopup('<b>Branch Location</b>').openPopup();
        }

        const locateBtn = L.control({position: 'topright'});
        locateBtn.onAdd = function() {
            const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
            div.innerHTML = '<button style="width:30px;height:30px;background:white;border:none;cursor:pointer;border-radius:4px;color:var(--primary);font-size:14px;box-shadow:0 2px 5px rgba(0,0,0,0.2);" title="Find My Location"><i class="fa-solid fa-crosshairs"></i></button>';
            div.onclick = function(e){
                e.stopPropagation();
                mapInstance.locate({setView: true, maxZoom: 16});
                UI.showToast("Acquiring GPS Signal...");
            };
            return div;
        };
        locateBtn.addTo(mapInstance);

        mapInstance.on('locationfound', function(e) {
            updatePin(e.latlng.lat, e.latlng.lng, "GPS Location found. Update shop location here?");
        });

        mapInstance.on('click', function(e) {
            updatePin(e.latlng.lat, e.latlng.lng, "Move shop pin to this location?");
        });
    }, 100);
}

function closeMap() { UI.hideModal('mapModal'); }

async function updatePin(lat, lng, msg) {
    if(mapMarker) mapInstance.removeLayer(mapMarker);
    mapMarker = L.marker([lat, lng]).addTo(mapInstance);
    
    if(confirm(msg)) {
        if(currentBranch && db) {
            try {
                const shopRef = doc(db, "shops", currentBranch);
                await updateDoc(shopRef, { "profile.lat": lat, "profile.lng": lng });
                
                const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
                if(user.merchantId === currentBranch) {
                    user.lat = lat; user.lng = lng;
                    localStorage.setItem('bharatpos_user', JSON.stringify(user));
                }

                UI.showToast("Location updated successfully!");
                mapMarker.bindPopup('<b>Shop Location Saved</b>').openPopup();
                logAudit("Location Updated", `GPS Coordinates updated for branch.`);
            } catch(e) {
                console.error("Location update failed", e);
                UI.showToast("Failed to update location", true);
            }
        }
    }
}

// --- UDHAAR KHATA ENGINE ---
function getPendingUdhaarAmount(sale) {
    if(sale.isPaid) return 0;
    const pMode = sale.paymentMethod || sale.paymentMode;
    if(pMode === 'Udhaar') return Number(sale.total || sale.amount || 0);
    if(pMode === 'Partial' && sale.split) return Number(sale.split.udhaar || 0);
    return 0;
}

function openUdhaarSection() {
    document.getElementById('mainDashboard').style.display = 'none';
    document.getElementById('udhaarView').style.display = 'block';
    renderUdhaarGroups();
}

function closeUdhaarSection() {
    document.getElementById('udhaarView').style.display = 'none';
    document.getElementById('mainDashboard').style.display = 'flex'; 
    renderAllWidgets(); 
}

function renderUdhaarGroups() {
    const fSales = currentBranch === 'all' ? enterpriseSales : enterpriseSales.filter(s => s._branchId === currentBranch || s.merchantId === currentBranch);
    const container = document.getElementById('udhaarGroupList');
    if(!container) return;
    
    const pending = fSales.filter(s => getPendingUdhaarAmount(s) > 0);

    const totalPending = pending.reduce((acc, s) => acc + getPendingUdhaarAmount(s), 0);
    document.getElementById('udhaarPendingTotal').innerText = `₹${Formatters.currency(totalPending)}`;

    if (pending.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding-top:40px;"><i class="fa-solid fa-check-circle" style="color:var(--success); font-size:40px;"></i><p>Sab clear hai! No pending dues.</p></div>`;
        return;
    }

    const groups = {};
    pending.forEach(inv => {
        const ph = inv.customerPhone || inv.phone || "Unknown";
        const name = inv.customerName || inv.customer || "Walk-in";
        const amt = getPendingUdhaarAmount(inv);
        
        if(!groups[ph]) groups[ph] = { phone: ph, name: name, total: 0, count: 0 };
        if(groups[ph].name === "Walk-in" && name !== "Walk-in") groups[ph].name = name;
        
        groups[ph].total += amt;
        groups[ph].count++;
    });

    const sortedGroups = Object.values(groups).sort((a,b) => b.total - a.total);

    container.innerHTML = sortedGroups.map(g => `
        <div class="group-card" data-action="open-customer" data-phone="${Security.escapeHtml(g.phone)}">
            <div>
                <div class="cust-name">${Security.escapeHtml(g.name)}</div>
                <div class="cust-phone"><i class="fa-solid fa-phone"></i> ${Security.escapeHtml(g.phone)}</div>
            </div>
            <div style="text-align:right;">
                <div class="debt-amt">₹${Formatters.currency(g.total)}</div>
                <div class="debt-count">${g.count} Bills</div>
            </div>
        </div>
    `).join('');
}

function openCustomerModal(phone) {
    const fSales = currentBranch === 'all' ? enterpriseSales : enterpriseSales.filter(s => s._branchId === currentBranch || s.merchantId === currentBranch);
    const invoices = fSales.filter(s => 
        (s.customerPhone === phone || s.phone === phone || (phone === "Unknown" && !s.customerPhone && !s.phone)) && 
        getPendingUdhaarAmount(s) > 0
    );
    
    invoices.sort((a,b) => new Date(b.date) - new Date(a.date));
    if(!invoices.length) return;

    const first = invoices[0];
    document.getElementById('custModalName').textContent = Security.escapeHtml(first.customerName || first.customer || "Customer");
    document.getElementById('custModalPhone').textContent = Security.escapeHtml(phone);

    const listBody = document.getElementById('invoiceListBody');
    
    listBody.innerHTML = invoices.map(inv => {
        const dataStr = encodeURIComponent(JSON.stringify(inv));
        const amt = getPendingUdhaarAmount(inv);
        const invId = inv.id || inv.invoiceNo || '???';
        const pMode = inv.paymentMethod || inv.paymentMode;

        return `
        <div class="inv-item">
            <div class="inv-info">
                <h4>#${Security.escapeHtml(invId.slice(-8))}</h4>
                <p>${new Date(inv.date).toLocaleDateString()} • <span style="color:var(--warning);">${Security.escapeHtml(pMode)}</span></p>
                ${currentBranch === 'all' && inv._branchName ? `<p style="margin-top:2px; color:var(--primary); font-weight:700;">Branch: ${Security.escapeHtml(inv._branchName)}</p>` : ''}
            </div>
            <div class="inv-action">
                <div class="inv-price">₹${Formatters.currency(amt)}</div>
                <button class="btn-view" data-action="open-receipt" data-json="${dataStr}">Settle Bill</button>
            </div>
        </div>`;
    }).join('');

    UI.showModal('customerModal');
}

function openReceipt(dataStr) {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const inv = JSON.parse(decodeURIComponent(dataStr));
    const pendingAmt = getPendingUdhaarAmount(inv);
    const invId = inv.id || inv.invoiceNo;

    document.getElementById('rec-shop').innerText = Security.escapeHtml(inv._branchName || user.shopName || "BHARAT POS");
    document.getElementById('rec-id').innerText = "INV: " + Security.escapeHtml(invId.slice(-8));
    document.getElementById('rec-date').innerText = new Date(inv.date).toLocaleString();
    document.getElementById('rec-name').innerText = Security.escapeHtml(inv.customerName || inv.customer || 'Walk-in');
    document.getElementById('rec-phone').innerText = Security.escapeHtml(inv.customerPhone || inv.phone || '');
    
    const tbody = document.getElementById('rec-items');
    tbody.innerHTML = (inv.items || []).map(i => {
        const qtyPrint = i.isLoose ? `${parseFloat(i.qty).toFixed(3)} ${Security.escapeHtml(i.unitLabel||'kg')}` : `${i.qty}`;
        const amt = i.total || (i.price * i.qty);
        return `<tr><td>${Security.escapeHtml(i.name)} <div style="font-size:9px; color:#555;">${Security.escapeHtml(i.variant||'')}</div></td><td style="text-align:center">${qtyPrint}</td><td style="text-align:right">${amt.toFixed(2)}</td></tr>`;
    }).join('');

    document.getElementById('rec-full-total').innerText = `₹${Number(inv.total || inv.amount || 0).toFixed(2)}`;
    
    if(inv.split) {
        document.getElementById('rec-split-info').innerHTML = `<span>Paid:</span> <span>Cash: ₹${inv.split.cash} | Online: ₹${inv.split.online}</span>`;
    } else {
        document.getElementById('rec-split-info').innerHTML = `<span>Paid:</span> <span>₹0.00</span>`;
    }

    document.getElementById('rec-due').innerText = `₹${Formatters.currency(pendingAmt)}`;

    const payBtn = document.getElementById('btnSettle');
    // Using delegation or direct bind since this is a dynamic modal context. We'll attach a one-time listener:
    payBtn.onclick = () => settleDebt(invId, inv._branchId || inv.merchantId);

    UI.showModal('receiptModal');
}

async function settleDebt(id, saleBranchId) {
    if(!confirm("Mark this pending amount as PAID (Cash Received)?")) return;

    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const targetBranch = saleBranchId || user.merchantId;
    
    const index = enterpriseSales.findIndex(s => (s.id === id || s.invoiceNo === id));

    if(index > -1) {
        const s = enterpriseSales[index];
        const pendingAmt = getPendingUdhaarAmount(s);
        
        s.isPaid = true;
        s.settledDate = new Date().toISOString();
        
        if(s.paymentMethod === 'Partial' && s.split) {
            s.split.cash = Number(s.split.cash || 0) + pendingAmt;
            s.paymentMethod = "Partial (Settled)";
        } else {
            s.paymentMode = "Cash (Settled)"; 
            s.paymentMethod = "Cash (Settled)";
        }
        
        await dbSave('bharatpos_enterprise_sales', enterpriseSales);

        if (targetBranch === user.merchantId) {
            const localSales = await dbGet('bharatpos_sales', '[]');
            const lIndex = localSales.findIndex(ls => (ls.id === id || ls.invoiceNo === id));
            if (lIndex > -1) {
                localSales[lIndex].isPaid = true;
                localSales[lIndex].settledDate = s.settledDate;
                if(localSales[lIndex].paymentMethod === 'Partial' && localSales[lIndex].split) {
                    localSales[lIndex].split.cash += pendingAmt;
                    localSales[lIndex].paymentMethod = "Partial (Settled)";
                } else {
                    localSales[lIndex].paymentMode = "Cash (Settled)";
                    localSales[lIndex].paymentMethod = "Cash (Settled)";
                }
                await dbSave('bharatpos_sales', localSales);
            }
        }

        UI.showToast("✅ Payment Recorded Successfully!");
        UI.hideModal('receiptModal');
        UI.hideModal('customerModal');
        
        logAudit("Udhaar Settled", `Invoice ${id.slice(-8)} settled for ₹${pendingAmt}.`);
        
        renderAllWidgets();
        if(document.getElementById('udhaarView').style.display === 'block') renderUdhaarGroups();
        
        if(targetBranch && db) {
            try {
                // Using imported runTransaction
                await runTransaction(db, async (transaction) => {
                    const saleRef = doc(db, "shops", targetBranch, "sales", id);
                    transaction.update(saleRef, {
                        isPaid: true,
                        settledDate: s.settledDate,
                        paymentMethod: s.paymentMethod,
                        paymentMode: s.paymentMode,
                        split: s.split || null
                    });
                });
            } catch(e) { console.error("Firebase Udhaar Update Failed:", e); }
        }
    } else {
        alert("Error: Invoice not found.");
    }
}

// --- DRAG & DROP WIDGETS ---
function initDragAndDrop() {
    const container = document.getElementById('widgetContainer');
    if(!container) return;
    let draggedItem = null;

    const savedOrder = JSON.parse(localStorage.getItem('dashboard_layout') || 'null');
    if(savedOrder) {
        savedOrder.forEach(id => {
            const el = document.getElementById(id);
            if(el) container.appendChild(el);
        });
    }

    container.addEventListener('dragstart', (e) => {
        const widget = e.target.closest('.widget');
        if(!widget) return;
        draggedItem = widget;
        setTimeout(() => widget.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
    });

    container.addEventListener('dragend', (e) => {
        const widget = e.target.closest('.widget');
        if(!widget) return;
        widget.classList.remove('dragging');
        document.querySelectorAll('.widget').forEach(w => w.classList.remove('widget-over'));
        draggedItem = null;
        
        const currentOrder = [...container.querySelectorAll('.widget')].map(w => w.id);
        localStorage.setItem('dashboard_layout', JSON.stringify(currentOrder));
        logAudit("Layout Changed", "User rearranged dashboard widgets.");
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault(); 
        const targetWidget = e.target.closest('.widget');
        if(targetWidget && targetWidget !== draggedItem) {
            targetWidget.classList.add('widget-over');
        }
    });

    container.addEventListener('dragleave', (e) => {
        const targetWidget = e.target.closest('.widget');
        if(targetWidget) targetWidget.classList.remove('widget-over');
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetWidget = e.target.closest('.widget');
        if(targetWidget && targetWidget !== draggedItem) {
            targetWidget.classList.remove('widget-over');
            const allWidgets = [...container.querySelectorAll('.widget')];
            const draggedIdx = allWidgets.indexOf(draggedItem);
            const targetIdx = allWidgets.indexOf(targetWidget);
            
            if(draggedIdx < targetIdx) targetWidget.after(draggedItem);
            else targetWidget.before(draggedItem);
        }
    });
}

// KICKSTART
initDashboard();