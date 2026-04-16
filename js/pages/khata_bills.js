// File: /js/pages/khata_bills.js

import { Security } from '../utils/security.js';

let currentFilter = 'PENDING'; // PENDING or PAID

export function initBills() {
    // Expose listener to global scope for top-menu changes
    window.onShopChanged = (shopId) => {
        // Ensure we are on the bills tab before rendering
        if(document.getElementById('tab-bills').classList.contains('active')) {
            renderBillsData();
        }
    };
    
    renderBillsData();
}

function renderBillsData() {
    const container = document.getElementById('billsContent');
    const allSales = window.KhataData.sales;
    const activeShop = window.KhataData.activeShopId;

    const filteredSales = activeShop === 'ALL' ? allSales : allSales.filter(s => {
        const sid = s._branchId || s.merchantId;
        return sid === activeShop;
    });

    let totalSpent = 0;
    let totalPending = 0;
    let categories = {};
    
    let pendingBills = [];
    let paidBills = [];

    filteredSales.forEach(sale => {
        const total = Number(sale.total || sale.amount || 0);
        const pMode = sale.paymentMethod || sale.paymentMode || 'Cash';
        
        let isPending = false;
        let pendingAmt = 0;

        if (!sale.isPaid) {
            if(pMode === 'Udhaar') { isPending = true; pendingAmt = total; }
            if(pMode === 'Partial' && sale.split && Number(sale.split.udhaar) > 0) { isPending = true; pendingAmt = Number(sale.split.udhaar); }
        }

        if (isPending) {
            totalPending += pendingAmt;
            pendingBills.push({...sale, _pendingAmt: pendingAmt});
        } else {
            totalSpent += total;
            paidBills.push(sale);
        }

        (sale.items || []).forEach(item => {
            const cat = item.category || 'General';
            categories[cat] = (categories[cat] || 0) + Number(item.qty || 1);
        });
    });

    // Find favorite category
    let favCat = "N/A";
    let maxQty = 0;
    Object.entries(categories).forEach(([cat, qty]) => {
        if(qty > maxQty) { maxQty = qty; favCat = cat; }
    });

    pendingBills.sort((a,b) => new Date(b.date) - new Date(a.date));
    paidBills.sort((a,b) => new Date(b.date) - new Date(a.date));

    const listToRender = currentFilter === 'PENDING' ? pendingBills : paidBills;

    const style = `
        <style>
            .kpi-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px; }
            .kpi-card { background:white; padding:16px; border-radius:16px; border:1px solid #e2e8f0; box-shadow:0 4px 10px rgba(0,0,0,0.02);}
            .tab-switch { display:flex; background:#e2e8f0; border-radius:12px; padding:4px; margin-bottom:16px;}
            .tab-btn { flex:1; padding:10px; border:none; background:transparent; border-radius:8px; font-weight:800; font-size:13px; color:var(--text-sub); transition:0.2s;}
            .tab-btn.active { background:white; color:var(--brand-primary); box-shadow:0 2px 8px rgba(0,0,0,0.1); }
            
            .bill-card { background:white; border:1.5px solid #e2e8f0; border-radius:16px; padding:16px; margin-bottom:12px; box-shadow:0 4px 10px rgba(0,0,0,0.02); display:flex; flex-direction:column; gap:12px;}
            .bill-header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px dashed #e2e8f0; padding-bottom:12px;}
            .bill-items { font-size:12px; color:var(--text-sub); font-weight:600; line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
            .bill-footer { display:flex; justify-content:space-between; align-items:center; padding-top:4px;}
            .badge-red { background:#fee2e2; color:#ef4444; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:800; text-transform:uppercase;}
            .badge-green { background:#d1fae5; color:#10b981; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:800; text-transform:uppercase;}
        </style>
    `;

    let html = style + `
        <div class="kpi-grid">
            <div class="kpi-card">
                <div style="font-size:11px; font-weight:800; color:var(--text-sub); text-transform:uppercase;">Total Spent</div>
                <div style="font-size:20px; font-weight:800; color:var(--text-main); font-family:'JetBrains Mono'; margin-top:4px;">₹${totalSpent.toFixed(2)}</div>
            </div>
            <div class="kpi-card" style="background:var(--brand-gradient); color:white; border:none;">
                <div style="font-size:11px; font-weight:800; opacity:0.9; text-transform:uppercase;">Fav Category</div>
                <div style="font-size:16px; font-weight:800; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${Security.escapeHtml(favCat)}</div>
            </div>
        </div>

        <div class="tab-switch" id="billTabs">
            <button class="tab-btn ${currentFilter==='PENDING'?'active':''}" data-f="PENDING">Pending (₹${totalPending})</button>
            <button class="tab-btn ${currentFilter==='PAID'?'active':''}" data-f="PAID">Paid Bills</button>
        </div>

        <div id="billListContainer" style="display:flex; flex-direction:column;">
    `;

    if(listToRender.length === 0) {
        html += `<div style="text-align:center; padding:40px; color:var(--text-sub); font-weight:600;">No ${currentFilter.toLowerCase()} bills found.</div>`;
    } else {
        listToRender.forEach(b => {
            const dateStr = new Date(b.date).toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
            const itemsStr = (b.items||[]).map(i => `${i.qty}x ${Security.escapeHtml(i.name)}`).join(', ');
            const isPen = currentFilter === 'PENDING';
            const amtDisplay = isPen ? b._pendingAmt : b.total;
            
            html += `
            <div class="bill-card">
                <div class="bill-header">
                    <div>
                        <div style="font-weight:800; font-size:14px; color:var(--text-main);">${Security.escapeHtml(b._branchName || 'Local Shop')}</div>
                        <div style="font-size:11px; color:var(--text-sub); font-weight:600; margin-top:2px;">${dateStr} • #${Security.escapeHtml(b.id.slice(-6))}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-family:'JetBrains Mono'; font-weight:800; font-size:16px; color:${isPen?'#ef4444':'#10b981'};">₹${Number(amtDisplay).toFixed(2)}</div>
                        <div class="${isPen?'badge-red':'badge-green'}" style="margin-top:4px; display:inline-block;">${isPen?'Due':'Paid'}</div>
                    </div>
                </div>
                <div class="bill-items">${itemsStr || 'No item details'}</div>
            </div>`;
        });
    }

    html += `</div>`;
    container.innerHTML = html;

    // Tab Listeners
    const tbs = document.getElementById('billTabs');
    if(tbs) {
        tbs.addEventListener('click', (e) => {
            if(e.target.tagName === 'BUTTON') {
                currentFilter = e.target.getAttribute('data-f');
                renderBillsData();
            }
        });
    }
}