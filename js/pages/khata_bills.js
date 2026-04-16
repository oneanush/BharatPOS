// File: /js/pages/khata_bills.js

import { db } from '../core/firebase.js';
import { collectionGroup, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { Security } from '../utils/security.js'; // <-- Added missing import

let currentShopsList = [];

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
                shopsMap[shopId] = { id: shopId, shopName: sale._branchName || 'Local Shop', invoices: [], pending: 0 };
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
                id: sale.id, date: sale.date, total: sale.total, pending: pendingAmt, items: sale.items || []
            });
        });

        // SORTING: Sort by most visited (number of invoices descending)
        currentShopsList = Object.values(shopsMap).sort((a, b) => b.invoices.length - a.invoices.length);

        renderBillsUI(content, totalPending, currentShopsList);

    } catch (e) {
        console.error(e);
        // Graceful error handling for missing Firebase Index
        if (e.message && e.message.includes('requires a COLLECTION_GROUP_ASC index')) {
            content.innerHTML = `
                <div style="text-align:center; padding:24px; background:#fee2e2; border:1px solid #fca5a5; border-radius:16px; color:#b91c1c;">
                    <i class="fa-solid fa-database fa-2x" style="margin-bottom:12px;"></i>
                    <h3 style="margin:0 0 8px 0; font-family:var(--font-head);">Database Setup Required</h3>
                    <p style="font-size:13px; font-weight:600; line-height:1.5; margin:0;">
                        Firebase requires an index to search your phone number securely. <br><br>
                        <strong>Developer:</strong> Open the F12 Console, click the link in the red error message, and click "Create Index".
                    </p>
                </div>`;
        } else {
            content.innerHTML = `<div style="text-align:center; padding:40px; color:#ef4444; font-weight:700;">Failed to load records. Ensure you have internet.</div>`;
        }
    } finally {
        loader.style.display = 'none';
    }
}

function renderBillsUI(container, totalPending, shopsList) {
    let html = `
        <div style="background:var(--brand-gradient); color:white; padding:24px; border-radius:20px; box-shadow:0 10px 20px rgba(99,102,241,0.2); margin-bottom:24px;">
            <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; opacity:0.9;">Total Udhaar to Pay</div>
            <div style="font-size:36px; font-weight:800; font-family:'JetBrains Mono'; margin-top:4px;">₹${totalPending.toFixed(2)}</div>
        </div>
        
        <h3 style="font-size:16px; margin-bottom:12px; font-family:var(--font-head);">Your Associated Shops</h3>
        
        <div style="position:relative; margin-bottom:16px;">
            <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--text-sub);"></i>
            <input type="text" id="khataShopSearch" placeholder="Search your shops..." style="width:100%; padding:12px 14px 12px 40px; border-radius:12px; border:1px solid #e2e8f0; font-size:14px; font-weight:600; font-family:inherit; outline:none; box-sizing:border-box;">
        </div>

        <div id="khataShopsContainer" style="display:flex; flex-direction:column; gap:12px; padding-bottom:20px;"></div>
    `;

    container.innerHTML = html;

    const listContainer = document.getElementById('khataShopsContainer');
    const searchInput = document.getElementById('khataShopSearch');

    const renderList = (filtered) => {
        if (filtered.length === 0) {
            listContainer.innerHTML = `<div style="text-align:center; color:var(--text-sub); padding:30px; font-weight:600;">No shops found.</div>`;
            return;
        }
        listContainer.innerHTML = filtered.map(shop => `
            <div class="card" style="border-left: 4px solid ${shop.pending > 0 ? 'var(--brand-accent)' : '#10b981'}; margin-bottom:0;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h4 style="margin:0 0 4px 0; font-size:16px; font-weight:800;">${Security.escapeHtml(shop.shopName)}</h4>
                        <div style="font-size:12px; color:var(--text-sub); font-weight:600;">${shop.invoices.length} Bills / Visits</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:10px; font-weight:700; color:var(--text-sub); text-transform:uppercase;">Due</div>
                        <div style="font-size:16px; font-weight:800; color:${shop.pending > 0 ? '#ef4444' : '#10b981'}; font-family:'JetBrains Mono';">₹${shop.pending.toFixed(2)}</div>
                    </div>
                </div>
            </div>
        `).join('');
    };

    // Initial Render
    renderList(shopsList);

    // Fuzzy Search Event
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().replace(/\s+/g, '.*');
            const regex = new RegExp(q, 'i');
            const filtered = shopsList.filter(s => regex.test(s.shopName.toLowerCase()));
            renderList(filtered);
        });
    }
}