// File: /js/pages/khata_bills.js

import { Security } from '../utils/security.js';

let currentFilter = 'PENDING'; 

export function initBills() {
    window.refreshKhataBills = () => {
        if(document.getElementById('tab-bills').classList.contains('active')) renderBillsData();
    };

    // Thermal Receipt Delegation
    document.getElementById('billsContent').addEventListener('click', (e) => {
        const billCard = e.target.closest('.bill-card');
        if(billCard && billCard.hasAttribute('data-sale')) {
            const saleData = JSON.parse(decodeURIComponent(billCard.getAttribute('data-sale')));
            openThermalReceipt(saleData);
        }
    });
    
    renderBillsData();
}

function renderBillsData() {
    const container = document.getElementById('billsContent');
    const allSales = window.KhataData.sales || [];
    const activeShop = window.KhataData.activeShopId;

    const filteredSales = activeShop === 'ALL' ? allSales : allSales.filter(s => s._resolvedShopId === activeShop);

    let totalSpent = 0;
    let totalPending = 0;
    let pendingBills = [];
    let paidBills = [];

    filteredSales.forEach(sale => {
        const total = Number(sale.total || sale.amount || 0);
        const pMode = sale.paymentMethod || sale.paymentMode || 'Cash';
        
        let isPending = false;
        let pendingAmt = 0;

        // STRICT LOGIC: If isPaid is true, it is ALWAYS resolved.
        if (!sale.isPaid) {
            if(pMode === 'Udhaar') { isPending = true; pendingAmt = total; }
            else if(pMode === 'Partial' && sale.split && Number(sale.split.udhaar) > 0) { isPending = true; pendingAmt = Number(sale.split.udhaar); }
        }

        if (isPending) {
            totalPending += pendingAmt;
            pendingBills.push({...sale, _pendingAmt: pendingAmt});
        } else {
            totalSpent += total;
            paidBills.push(sale);
        }
    });

    pendingBills.sort((a,b) => new Date(b.date) - new Date(a.date));
    paidBills.sort((a,b) => new Date(b.date) - new Date(a.date));

    const listToRender = currentFilter === 'PENDING' ? pendingBills : paidBills;

    const style = `
        <style>
            .kpi-grid { display:grid; grid-template-columns:1fr; gap:12px; margin-bottom:20px; }
            .kpi-card { background:white; padding:16px; border-radius:16px; border:1px solid #e2e8f0; box-shadow:0 4px 10px rgba(0,0,0,0.02);}
            .tab-switch { display:flex; background:#e2e8f0; border-radius:12px; padding:4px; margin-bottom:16px;}
            .tab-btn { flex:1; padding:10px; border:none; background:transparent; border-radius:8px; font-weight:800; font-size:13px; color:var(--text-sub); transition:0.2s; cursor:pointer;}
            .tab-btn.active { background:white; color:var(--brand-primary); box-shadow:0 2px 8px rgba(0,0,0,0.1); }
            
            .bill-card { background:white; border:1.5px solid #e2e8f0; border-radius:16px; padding:16px; margin-bottom:12px; box-shadow:0 4px 10px rgba(0,0,0,0.02); display:flex; flex-direction:column; gap:12px; cursor:pointer; transition:0.2s;}
            .bill-card:active { transform:scale(0.98); }
            .bill-header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px dashed #e2e8f0; padding-bottom:12px;}
            .bill-items { font-size:12px; color:var(--text-sub); font-weight:600; line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
            .badge-red { background:#fee2e2; color:#ef4444; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:800; text-transform:uppercase;}
            .badge-green { background:#d1fae5; color:#10b981; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:800; text-transform:uppercase;}
        </style>
    `;

    let html = style + `
        <div class="kpi-grid">
            <div class="kpi-card">
                <div style="font-size:11px; font-weight:800; color:var(--text-sub); text-transform:uppercase;">Total Lifetime Spent Here</div>
                <div style="font-size:24px; font-weight:800; color:var(--text-main); font-family:'JetBrains Mono'; margin-top:4px;">₹${totalSpent.toFixed(2)}</div>
            </div>
        </div>

        <div class="tab-switch" id="billTabs">
            <button class="tab-btn ${currentFilter==='PENDING'?'active':''}" data-f="PENDING">Pending (₹${totalPending.toFixed(2)})</button>
            <button class="tab-btn ${currentFilter==='PAID'?'active':''}" data-f="PAID">Resolved Bills</button>
        </div>

        <div id="billListContainer" style="display:flex; flex-direction:column; padding-bottom:30px;">
    `;

    if(listToRender.length === 0) {
        html += `<div style="text-align:center; padding:40px; color:var(--text-sub); font-weight:600;">No ${currentFilter.toLowerCase()} bills found.</div>`;
    } else {
        listToRender.forEach(b => {
            const dateStr = new Date(b.date).toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
            const itemsStr = (b.items||[]).map(i => `${i.qty}x ${Security.escapeHtml(i.name)}`).join(', ');
            const isPen = currentFilter === 'PENDING';
            const amtDisplay = isPen ? b._pendingAmt : (b.total || b.amount || 0);
            
            const encodedSale = encodeURIComponent(JSON.stringify(b));

            html += `
            <div class="bill-card" data-sale="${encodedSale}">
                <div class="bill-header">
                    <div>
                        <div style="font-weight:800; font-size:14px; color:var(--text-main);">${Security.escapeHtml(b._resolvedShopName || 'Local Shop')}</div>
                        <div style="font-size:11px; color:var(--text-sub); font-weight:600; margin-top:2px;">${dateStr} • #${Security.escapeHtml((b.id || 'INV').slice(-6))}</div>
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

// Thermal Receipt Generator
function openThermalReceipt(sale) {
    const paper = document.getElementById('receiptPaper');
    const shopName = sale._resolvedShopName || 'Local Store';
    const dateStr = new Date(sale.date).toLocaleString('en-IN');
    const pMode = sale.paymentMethod || sale.paymentMode || 'Cash';
    
    let rows = '';
    (sale.items || []).forEach(i => {
        const amt = i.total || (i.price * i.qty);
        rows += `
        <tr>
            <td>${Security.escapeHtml(i.name)} <div style="font-size:10px; color:#555;">${Security.escapeHtml(i.variant||'')}</div></td>
            <td style="text-align:center;">${i.qty}</td>
            <td style="text-align:right;">${amt.toFixed(2)}</td>
        </tr>`;
    });

    let splitInfo = '';
    if (sale.split) {
        splitInfo = `<div class="thermal-row" style="font-size:10px; font-weight:normal; margin-top:8px;"><span>Paid (Cash/Online):</span><span>₹${Number(sale.split.cash||0) + Number(sale.split.online||0)}</span></div>`;
        if(sale.split.udhaar > 0 && !sale.isPaid) {
            splitInfo += `<div class="thermal-row" style="font-size:11px; color:#ef4444; margin-top:4px;"><span>PENDING UDHAAR:</span><span>₹${sale.split.udhaar}</span></div>`;
        }
    } else if (pMode === 'Udhaar' && !sale.isPaid) {
        splitInfo += `<div class="thermal-row" style="font-size:11px; color:#ef4444; margin-top:4px;"><span>PENDING UDHAAR:</span><span>₹${sale.total || sale.amount}</span></div>`;
    } else {
        splitInfo = `<div class="thermal-row" style="font-size:10px; font-weight:normal; margin-top:8px;"><span>Status:</span><span>PAID (${Security.escapeHtml(pMode)})</span></div>`;
    }

    paper.innerHTML = `
        <div class="thermal-header">
            <h2 style="margin:0; font-size:16px;">${Security.escapeHtml(shopName)}</h2>
            <div style="font-size:10px; margin-top:4px;">TAX INVOICE</div>
        </div>
        <div style="font-size:11px; margin-bottom:12px;">
            <div class="thermal-row"><span>Inv: #${Security.escapeHtml((sale.id||'').slice(-6))}</span></div>
            <div class="thermal-row"><span>Date: ${dateStr}</span></div>
        </div>
        <table class="thermal-table">
            <thead>
                <tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Total</th></tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="thermal-totals">
            <div class="thermal-row" style="font-size:14px;"><span>Grand Total:</span><span>₹${Number(sale.total || sale.amount).toFixed(2)}</span></div>
            ${splitInfo}
        </div>
        <div style="text-align:center; margin-top:20px; font-size:10px; border-top:1px dashed #000; padding-top:10px;">Thank you for shopping!</div>
    `;

    document.getElementById('receiptModal').style.display = 'flex';
}