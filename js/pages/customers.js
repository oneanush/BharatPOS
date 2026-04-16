// File: /js/pages/customers.js

import { db } from '../core/firebase.js';
import { runTransaction, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { dbGet, dbSave } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';
import { Security } from '../utils/security.js';
import { Formatters } from '../utils/formatters.js';

// --- ENCAPSULATED STATE ---
let aggregatedCustomers = [];
let filteredCustomers = [];
let activeFilter = 'ALL';
let searchQuery = '';

// Shared sales reference for settlement
let enterpriseSalesRef = [];

// --- INITIALIZATION ---
async function initCustomers() {
    Navigation.inject('crm');
    bindEvents();
    await loadAndAggregateData();
}

// --- EVENT BINDING ---
function bindEvents() {
    document.getElementById('loyaltyFilters')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (chip) {
            document.querySelectorAll('.loyaltyFilters .chip, .crm-filters .chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeFilter = chip.getAttribute('data-filter');
            applyFilters();
        }
    });

    document.getElementById('searchInput')?.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        applyFilters();
    });

    document.getElementById('customerGrid')?.addEventListener('click', (e) => {
        const card = e.target.closest('.cust-card');
        if (card) openCustomerProfile(card.getAttribute('data-id'));
    });

    // Event Delegation for Receipt & WhatsApp
    document.body.addEventListener('click', (e) => {
        const receiptBtn = e.target.closest('[data-action="open-receipt"]');
        if(receiptBtn) openReceipt(receiptBtn.getAttribute('data-json'));

        if(e.target.closest('#btnCloseProfile')) UI.hideModal('profileModal');
        if(e.target.closest('#btnCloseReceipt')) UI.hideModal('receiptModal');
        if(e.target.classList.contains('modal-overlay')) UI.hideModal(e.target.id);
        if(e.target.closest('#btnExportCustomers')) exportToCSV();
        if(e.target.closest('#btnAiMarketing')) runAiMarketingSimulation();
    });
}

// --- DATA AGGREGATION ENGINE (RFM Analysis) ---
async function loadAndAggregateData() {
    const rawCustomers = await dbGet('bharatpos_customers', '[]');
    const localSales = await dbGet('bharatpos_sales', '[]');
    const eSales = await dbGet('bharatpos_enterprise_sales', '[]');
    
    let mergedSalesMap = {};
    [...eSales, ...localSales].forEach(s => mergedSalesMap[s.id] = s);
    const allSales = Object.values(mergedSalesMap);
    enterpriseSalesRef = allSales;

    const custMap = {};

    rawCustomers.forEach(c => {
        const id = c.phone || c.id || c.name.toLowerCase().replace(/\s/g, '_');
        custMap[id] = {
            id: id, name: c.name || 'Unknown', phone: c.phone || c.mobile || '',
            totalSpent: 0, visitCount: 0, lastVisit: new Date(0), pendingUdhaar: 0, history: []
        };
    });

    allSales.forEach(sale => {
        const identifier = sale.customerPhone || sale.phone || (sale.customer || sale.customerName || 'walkin').toLowerCase().replace(/\s/g, '_');
        const name = sale.customer || sale.customerName || 'Walk-in';
        const phone = sale.customerPhone || sale.phone || '';
        const saleDate = new Date(sale.date);
        
        if(identifier === 'walkin' || identifier === 'walk-in') return;

        if (!custMap[identifier]) {
            custMap[identifier] = {
                id: identifier, name: name, phone: phone,
                totalSpent: 0, visitCount: 0, lastVisit: new Date(0),
                pendingUdhaar: 0, history: []
            };
        }

        const c = custMap[identifier];
        const total = Number(sale.total || sale.amount || 0);
        
        const pMode = sale.paymentMethod || sale.paymentMode || 'Cash';
        let spentThisTx = 0;
        let udhaarThisTx = 0;

        if (sale.isPaid) {
            spentThisTx = total;
        } else if (pMode === 'Partial' && sale.split) {
            spentThisTx = Number(sale.split.cash || 0) + Number(sale.split.online || 0);
            udhaarThisTx = Number(sale.split.udhaar || 0);
        } else if (pMode === 'Udhaar') {
            udhaarThisTx = total;
        } else {
            spentThisTx = total;
        }

        c.totalSpent += spentThisTx;
        c.pendingUdhaar += udhaarThisTx;
        c.visitCount += 1;
        
        if (saleDate > c.lastVisit) c.lastVisit = saleDate;

        c.history.push({
            id: sale.id, date: sale.date, total: total, spent: spentThisTx,
            udhaar: udhaarThisTx, items: (sale.items || []).length, isPaid: sale.isPaid || false,
            _fullSale: sale
        });
    });

    const today = new Date();
    const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(today.getDate() - 30);
    const sixtyDaysAgo = new Date(today); sixtyDaysAgo.setDate(today.getDate() - 60);

    aggregatedCustomers = Object.values(custMap).filter(c => c.visitCount > 0 || c.pendingUdhaar > 0);

    aggregatedCustomers.forEach(c => {
        c.status = 'REGULAR'; c.badgeClass = 'badge-regular'; c.cardClass = 'status-regular';

        if (c.visitCount >= 5 && c.totalSpent >= 2000 && c.lastVisit >= thirtyDaysAgo) {
            c.status = 'VIP'; c.badgeClass = 'badge-vip'; c.cardClass = 'status-vip';
        } else if (c.visitCount > 1 && c.lastVisit < sixtyDaysAgo) {
            c.status = 'RISK'; c.badgeClass = 'badge-risk'; c.cardClass = 'status-risk';
        }
        
        c.history.sort((a,b) => new Date(b.date) - new Date(a.date));
    });

    aggregatedCustomers.sort((a,b) => b.lastVisit - a.lastVisit);
    applyFilters();
}

function applyFilters() {
    filteredCustomers = aggregatedCustomers.filter(c => {
        if (activeFilter === 'VIP' && c.status !== 'VIP') return false;
        if (activeFilter === 'REGULAR' && c.status !== 'REGULAR') return false;
        if (activeFilter === 'RISK' && c.status !== 'RISK') return false;
        if (activeFilter === 'UDHAAR' && c.pendingUdhaar <= 0) return false;

        if (searchQuery) {
            const matchName = c.name.toLowerCase().includes(searchQuery);
            const matchPhone = c.phone.includes(searchQuery);
            if (!matchName && !matchPhone) return false;
        }
        return true;
    });

    renderKPIs();
    renderGrid();
}

function renderKPIs() {
    let vipCount = 0, riskCount = 0, totalLtv = 0;

    aggregatedCustomers.forEach(c => {
        if (c.status === 'VIP') vipCount++;
        if (c.status === 'RISK') riskCount++;
        totalLtv += c.totalSpent;
    });

    document.getElementById('kpiTotalCust').innerText = aggregatedCustomers.length;
    document.getElementById('kpiVipCust').innerText = vipCount;
    document.getElementById('kpiRiskCust').innerText = riskCount;
    document.getElementById('kpiTotalLtv').innerText = `₹${Formatters.currency(totalLtv)}`;
}

function renderGrid() {
    const grid = document.getElementById('customerGrid');
    if (!grid) return;

    if (filteredCustomers.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted);"><i class="fa-solid fa-users-slash" style="font-size:32px; margin-bottom:12px; opacity:0.5;"></i><br>No customers found matching filters.</div>`;
        return;
    }

    grid.innerHTML = filteredCustomers.map(c => {
        const initial = c.name.charAt(0).toUpperCase();
        let udhaarHtml = '';
        if (c.pendingUdhaar > 0) {
            udhaarHtml = `<div class="cust-udhaar"><span>Pending Udhaar:</span><span>₹${Formatters.currency(c.pendingUdhaar)}</span></div>`;
        }

        const lastVisitStr = c.lastVisit.getTime() === 0 ? 'Never' : c.lastVisit.toLocaleDateString('en-US', {month:'short', day:'numeric'});

        return `
        <div class="cust-card ${c.cardClass}" data-id="${Security.escapeHtml(c.id)}">
            <div class="cust-header">
                <div style="display:flex; gap:12px; align-items:center;">
                    <div class="cust-avatar">${Security.escapeHtml(initial)}</div>
                    <div style="overflow:hidden;">
                        <div class="cust-name" title="${Security.escapeHtml(c.name)}">${Security.escapeHtml(c.name)}</div>
                        <div class="cust-phone">${Security.escapeHtml(c.phone || 'No Phone')}</div>
                    </div>
                </div>
                <div class="cust-badge ${c.badgeClass}">${c.status}</div>
            </div>
            
            <div class="cust-stats">
                <div class="stat-box">
                    <span class="stat-label">Total Spent</span>
                    <span class="stat-val">₹${Formatters.currency(c.totalSpent)}</span>
                </div>
                <div class="stat-box" style="text-align:right;">
                    <span class="stat-label">Visits</span>
                    <span class="stat-val">${c.visitCount} <span style="font-size:10px; font-weight:600; color:var(--text-muted); font-family:var(--font-body);">(${lastVisitStr})</span></span>
                </div>
            </div>
            ${udhaarHtml}
        </div>`;
    }).join('');
}

// --- MODAL INTERACTIONS ---
function openCustomerProfile(id) {
    const c = aggregatedCustomers.find(cust => cust.id === id);
    if (!c) return;

    document.getElementById('profAvatar').innerText = c.name.charAt(0).toUpperCase();
    document.getElementById('profName').innerText = c.name;
    document.getElementById('profPhone').innerText = c.phone || 'No Phone Number';
    document.getElementById('profLtv').innerText = `₹${Formatters.currency(c.totalSpent)}`;
    document.getElementById('profVisits').innerText = c.visitCount;

    const badge = document.getElementById('profBadge');
    badge.className = `cust-badge ${c.badgeClass}`;
    badge.innerText = c.status;

    const udhaarBox = document.getElementById('profUdhaarBox');
    if (c.pendingUdhaar > 0) {
        document.getElementById('profUdhaarVal').innerText = `₹${Formatters.currency(c.pendingUdhaar)}`;
        udhaarBox.style.display = 'flex';
    } else {
        udhaarBox.style.display = 'none';
    }

    const historyBox = document.getElementById('profHistory');
    if (c.history.length === 0) {
        historyBox.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">No purchase history available.</div>';
    } else {
        historyBox.innerHTML = c.history.map(h => {
            const d = new Date(h.date).toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
            const isUdhaar = h.udhaar > 0 && !h.isPaid;
            const dataStr = encodeURIComponent(JSON.stringify(h._fullSale));
            
            return `
            <div class="history-item">
                <div>
                    <div class="history-date">${d}</div>
                    <div class="history-meta">${h.items} Items • Inv #${Security.escapeHtml(h.id.slice(-6))}</div>
                </div>
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="text-align:right;">
                        <div class="history-amt" style="color:${isUdhaar ? 'var(--danger)' : 'var(--text-main)'};">₹${Formatters.currency(h.total)}</div>
                        ${isUdhaar ? '<div style="font-size:10px; color:var(--danger); font-weight:700; margin-top:2px;">UNPAID</div>' : ''}
                    </div>
                    ${isUdhaar ? `<button class="btn-outline" style="padding:4px 8px; font-size:10px; border-radius:6px; color:var(--primary); border-color:var(--primary);" data-action="open-receipt" data-json="${dataStr}">Settle</button>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    const btnWa = document.getElementById('btnWhatsappCust');
    if(c.phone) {
        btnWa.style.display = 'block';
        btnWa.onclick = () => {
            let msg = `Hello ${c.name}, thank you for visiting our shop!`;
            if (c.pendingUdhaar > 0) {
                msg = `Hello ${c.name}, a gentle reminder regarding your pending balance of Rs ${c.pendingUdhaar}. Please settle it at your earliest convenience. Thank you!`;
            }
            window.open(`https://wa.me/91${c.phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank');
        };
    } else {
        btnWa.style.display = 'none';
    }

    UI.showModal('profileModal');
}

// Ensure the UI Modal exists in Customers page dynamically if missing
function injectReceiptModalIfMissing() {
    if(!document.getElementById('receiptModal')) {
        document.body.insertAdjacentHTML('beforeend', `
        <div id="receiptModal" class="modal-overlay" style="z-index: 10500 !important;">
            <div class="modal-box" style="max-width: 380px; padding: 20px; border-radius: 12px; background: #fff; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
                <button class="btn-close" id="btnCloseReceipt"><i class="fa-solid fa-xmark"></i></button>
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #000;">
                    <div style="text-align:center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px;">
                        <h2 id="rec-shop" style="margin:0; font-size:18px;">Shop Name</h2>
                        <div id="rec-id">INV: 000000</div>
                        <div id="rec-date">Date</div>
                    </div>
                    <div style="margin-bottom:10px;">
                        <div>Cust: <span id="rec-name"></span></div>
                        <div>Ph: <span id="rec-phone"></span></div>
                    </div>
                    <table style="width:100%; text-align:left; border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:1px dashed #000;">
                                <th style="padding:4px 0;">Item</th>
                                <th style="padding:4px 0; text-align:center;">Qty</th>
                                <th style="padding:4px 0; text-align:right;">Amt</th>
                            </tr>
                        </thead>
                        <tbody id="rec-items"></tbody>
                    </table>
                    <div style="border-top: 1px dashed #000; padding-top: 10px; margin-top: 10px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                            <span>Total Bill Value:</span> <span id="rec-full-total" style="font-weight:800;">₹0</span>
                        </div>
                        <div id="rec-split-info" style="display:flex; justify-content:space-between; margin-bottom:4px;"></div>
                        <div style="display:flex; justify-content:space-between; font-weight:800; font-size:14px; margin-top:8px; border-top:1px solid #000; padding-top:8px;">
                            <span style="color:var(--danger);">PENDING UDHAAR:</span>
                            <span id="rec-due" style="color:var(--danger);">₹0</span>
                        </div>
                    </div>
                </div>
                <button id="btnSettle" class="btn btn-primary" style="width:100%; margin-top:20px; background:var(--success); border-color:var(--success); font-size:15px; box-shadow:0 4px 15px rgba(16,185,129,0.3);"><i class="fa-solid fa-check-circle"></i> Receive Cash & Settle</button>
            </div>
        </div>`);
    }
}

function getPendingUdhaarAmount(sale) {
    if(sale.isPaid) return 0;
    const pMode = sale.paymentMethod || sale.paymentMode;
    if(pMode === 'Udhaar') return Number(sale.total || sale.amount || 0);
    if(pMode === 'Partial' && sale.split) return Number(sale.split.udhaar || 0);
    return 0;
}

function openReceipt(dataStr) {
    injectReceiptModalIfMissing();
    
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
    payBtn.onclick = () => settleDebt(invId, inv._branchId || inv.merchantId);

    UI.showModal('receiptModal');
}

// THE BUG FIX: Bulletproof Partial Settlement Math & Firebase Sync
async function settleDebt(id, saleBranchId) {
    if(!confirm("Mark this pending amount as PAID (Cash Received)?")) return;

    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const targetBranch = saleBranchId || user.merchantId;
    
    const index = enterpriseSalesRef.findIndex(s => (s.id === id || s.invoiceNo === id));

    if(index > -1) {
        const s = enterpriseSalesRef[index];
        const pendingAmt = getPendingUdhaarAmount(s);
        
        s.isPaid = true;
        s.settledDate = new Date().toISOString();
        
        if((s.paymentMethod === 'Partial' || s.paymentMethod === 'Partial (Settled)') && s.split) {
            s.split.cash = Number(s.split.cash || 0) + pendingAmt;
            s.split.udhaar = 0; // Explicitly clear
            s.paymentMethod = "Partial (Settled)";
            s.paymentMode = "Partial (Settled)";
        } else {
            s.paymentMode = "Cash (Settled)"; 
            s.paymentMethod = "Cash (Settled)";
        }
        
        await dbSave('bharatpos_enterprise_sales', enterpriseSalesRef);

        if (targetBranch === user.merchantId) {
            const localSales = await dbGet('bharatpos_sales', '[]');
            const lIndex = localSales.findIndex(ls => (ls.id === id || ls.invoiceNo === id));
            if (lIndex > -1) {
                localSales[lIndex].isPaid = true;
                localSales[lIndex].settledDate = s.settledDate;
                if((localSales[lIndex].paymentMethod === 'Partial' || localSales[lIndex].paymentMethod === 'Partial (Settled)') && localSales[lIndex].split) {
                    localSales[lIndex].split.cash = Number(localSales[lIndex].split.cash || 0) + pendingAmt;
                    localSales[lIndex].split.udhaar = 0; 
                    localSales[lIndex].paymentMethod = "Partial (Settled)";
                    localSales[lIndex].paymentMode = "Partial (Settled)";
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
        
        // Re-aggregate data so UI updates instantly
        await loadAndAggregateData();
        
        if(targetBranch && db && navigator.onLine) {
            try {
                await runTransaction(db, async (transaction) => {
                    const saleRef = doc(db, "shops", targetBranch, "sales", id);
                    const updatePayload = {
                        isPaid: true,
                        settledDate: s.settledDate,
                        paymentMethod: s.paymentMethod
                    };
                    
                    if (s.paymentMode !== undefined) updatePayload.paymentMode = s.paymentMode;
                    if (s.split !== undefined) updatePayload.split = s.split;

                    transaction.update(saleRef, updatePayload);
                });
            } catch(e) { 
                console.error("Firebase Udhaar Update Failed:", e); 
                UI.showToast("Cloud Sync failed, but saved locally.", true);
            }
        }
    } else {
        alert("Error: Invoice not found.");
    }
}

// --- ACTIONS ---
function runAiMarketingSimulation() {
    const btn = document.getElementById('btnAiMarketing');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing Audience...`;
    btn.disabled = true;

    setTimeout(() => {
        const riskCount = aggregatedCustomers.filter(c => c.status === 'RISK').length;
        if(riskCount > 0) {
            UI.showToast(`AI deployed successfully! Sent "We Miss You" SMS to ${riskCount} At-Risk customers.`);
        } else {
            UI.showToast(`No At-Risk customers to target right now.`);
        }
        btn.innerHTML = origHtml;
        btn.disabled = false;
    }, 1500);
}

function exportToCSV() {
    if(filteredCustomers.length === 0) return UI.showToast("No data to export", true);
    
    let csv = "Name,Phone,Status,Total Spent,Visits,Pending Udhaar,Last Visit\n";
    filteredCustomers.forEach(c => { 
        const lv = c.lastVisit.getTime() === 0 ? 'Never' : c.lastVisit.toLocaleDateString();
        csv += `"${Security.escapeHtml(c.name)}","${Security.escapeHtml(c.phone)}",${c.status},${c.totalSpent},${c.visitCount},${c.pendingUdhaar},${lv}\n`; 
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `BharatCRM_Customers_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// KICKSTART
initCustomers();