// File: /js/pages/khata_bills.js

import { db } from '../core/firebase.js';
import { collectionGroup, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export async function initBills(userPhone) {
    const loader = document.getElementById('billsLoader');
    const content = document.getElementById('billsContent');
    
    try {
        // Query across ALL shops where this phone number is recorded in sales
        const salesQuery = query(collectionGroup(db, 'sales'), where('customerPhone', '==', userPhone));
        const snapshot = await getDocs(salesQuery);
        
        let totalPending = 0;
        let shopsMap = {};

        snapshot.forEach(doc => {
            const sale = doc.data();
            const shopId = sale._branchId || sale.merchantId || doc.ref.parent.parent.id;
            
            if(!shopsMap[shopId]) {
                shopsMap[shopId] = { shopName: sale._branchName || 'Local Shop', invoices: [], pending: 0 };
            }

            let pendingAmt = 0;
            if(!sale.isPaid) {
                const mode = sale.paymentMethod || sale.paymentMode || 'Cash';
                if(mode === 'Udhaar') pendingAmt = Number(sale.total || 0);
                if(mode === 'Partial' && sale.split) pendingAmt = Number(sale.split.udhaar || 0);
            }

            shopsMap[shopId].pending += pendingAmt;
            totalPending += pendingAmt;

            shopsMap[shopId].invoices.push({
                id: sale.id,
                date: sale.date,
                total: sale.total,
                pending: pendingAmt,
                items: sale.items || []
            });
        });

        renderBillsUI(content, totalPending, shopsMap);
    } catch (e) {
        console.error(e);
        content.innerHTML = `<div style="text-align:center; padding:40px; color:#ef4444;">Failed to load records.</div>`;
    } finally {
        loader.style.display = 'none';
    }
}

function renderBillsUI(container, totalPending, shopsMap) {
    const shopKeys = Object.keys(shopsMap);

    let html = `
        <div style="background:var(--brand-gradient); color:white; padding:24px; border-radius:20px; box-shadow:0 10px 20px rgba(99,102,241,0.2); margin-bottom:24px;">
            <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; opacity:0.9;">Total Udhaar to Pay</div>
            <div style="font-size:36px; font-weight:800; font-family:'JetBrains Mono'; margin-top:4px;">₹${totalPending.toFixed(2)}</div>
        </div>
        <h3 style="font-size:16px; margin-bottom:16px; font-family:var(--font-head);">Your Associated Shops</h3>
    `;

    if(shopKeys.length === 0) {
        html += `<div style="text-align:center; color:var(--text-sub); padding:40px;">You have no digital Khata records yet.</div>`;
    } else {
        shopKeys.forEach(key => {
            const shop = shopsMap[key];
            html += `
            <div class="card" style="border-left: 4px solid ${shop.pending > 0 ? 'var(--brand-accent)' : '#10b981'};">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h4 style="margin:0 0 4px 0; font-size:16px; font-weight:800;">${shop.shopName}</h4>
                        <div style="font-size:12px; color:var(--text-sub);">${shop.invoices.length} Bills Found</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:10px; font-weight:700; color:var(--text-sub); text-transform:uppercase;">Due</div>
                        <div style="font-size:16px; font-weight:800; color:${shop.pending > 0 ? '#ef4444' : '#10b981'};">₹${shop.pending.toFixed(2)}</div>
                    </div>
                </div>
            </div>`;
        });
    }

    container.innerHTML = html;
}