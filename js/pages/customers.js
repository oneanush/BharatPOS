// File: /js/pages/customers.js

import { dbGet } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';
import { Security } from '../utils/security.js';
import { Formatters } from '../utils/formatters.js';

// --- ENCAPSULATED STATE ---
let aggregatedCustomers = [];
let filteredCustomers = [];
let activeFilter = 'ALL';
let searchQuery = '';

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

    document.getElementById('btnCloseProfile')?.addEventListener('click', () => UI.hideModal('profileModal'));
    
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) UI.hideModal(e.target.id);
        });
    });

    document.getElementById('btnAiMarketing')?.addEventListener('click', runAiMarketingSimulation);
    document.getElementById('btnExportCustomers')?.addEventListener('click', exportToCSV);
}

// --- DATA AGGREGATION ENGINE (RFM Analysis) ---
async function loadAndAggregateData() {
    // 1. Fetch raw data
    const rawCustomers = await dbGet('bharatpos_customers', '[]');
    const localSales = await dbGet('bharatpos_sales', '[]');
    const eSales = await dbGet('bharatpos_enterprise_sales', '[]');
    
    // Merge Sales
    let mergedSalesMap = {};
    [...eSales, ...localSales].forEach(s => mergedSalesMap[s.id] = s);
    const allSales = Object.values(mergedSalesMap);

    // 2. Build Aggregation Map
    const custMap = {};

    // Seed map with known customers
    rawCustomers.forEach(c => {
        const id = c.phone || c.id || c.name.toLowerCase().replace(/\s/g, '_');
        custMap[id] = {
            id: id,
            name: c.name || 'Unknown',
            phone: c.phone || c.mobile || '',
            totalSpent: 0,
            visitCount: 0,
            lastVisit: new Date(0),
            pendingUdhaar: 0,
            history: []
        };
    });

    // Aggregate Sales Data
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
        
        // Calculate Udhaar vs Spent
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
            id: sale.id,
            date: sale.date,
            total: total,
            spent: spentThisTx,
            udhaar: udhaarThisTx,
            items: (sale.items || []).length,
            isPaid: sale.isPaid || false
        });
    });

    // 3. Assign Loyalty Status (RFM Logic)
    const today = new Date();
    const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(today.getDate() - 30);
    const sixtyDaysAgo = new Date(today); sixtyDaysAgo.setDate(today.getDate() - 60);

    aggregatedCustomers = Object.values(custMap).filter(c => c.visitCount > 0 || c.pendingUdhaar > 0);

    aggregatedCustomers.forEach(c => {
        c.status = 'REGULAR';
        c.badgeClass = 'badge-regular';
        c.cardClass = 'status-regular';

        if (c.visitCount >= 5 && c.totalSpent >= 2000 && c.lastVisit >= thirtyDaysAgo) {
            c.status = 'VIP';
            c.badgeClass = 'badge-vip';
            c.cardClass = 'status-vip';
        } else if (c.visitCount > 1 && c.lastVisit < sixtyDaysAgo) {
            c.status = 'RISK';
            c.badgeClass = 'badge-risk';
            c.cardClass = 'status-risk';
        }
        
        // Sort history newest first
        c.history.sort((a,b) => new Date(b.date) - new Date(a.date));
    });

    // Sort by most recently active
    aggregatedCustomers.sort((a,b) => b.lastVisit - a.lastVisit);
    
    applyFilters();
}

// --- FILTERING & RENDERING ---
function applyFilters() {
    filteredCustomers = aggregatedCustomers.filter(c => {
        // Loyalty Filter
        if (activeFilter === 'VIP' && c.status !== 'VIP') return false;
        if (activeFilter === 'REGULAR' && c.status !== 'REGULAR') return false;
        if (activeFilter === 'RISK' && c.status !== 'RISK') return false;
        if (activeFilter === 'UDHAAR' && c.pendingUdhaar <= 0) return false;

        // Search Filter
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
            
            return `
            <div class="history-item">
                <div>
                    <div class="history-date">${d}</div>
                    <div class="history-meta">${h.items} Items • Inv #${Security.escapeHtml(h.id.slice(-6))}</div>
                </div>
                <div style="text-align:right;">
                    <div class="history-amt" style="color:${isUdhaar ? 'var(--danger)' : 'var(--text-main)'};">₹${Formatters.currency(h.total)}</div>
                    ${isUdhaar ? '<div style="font-size:10px; color:var(--danger); font-weight:700; margin-top:2px;">UNPAID</div>' : ''}
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