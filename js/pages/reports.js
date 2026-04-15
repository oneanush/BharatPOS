// File: /js/pages/reports.js

import { db } from '../core/firebase.js';
import { doc, updateDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { dbGet } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';
import { Security } from '../utils/security.js';
import { Formatters } from '../utils/formatters.js';

// --- ENCAPSULATED STATE ---
let allSales = [];

// --- INITIALIZATION ---
async function initReports() {
    Navigation.inject('reports');

    // Set default dates
    const today = new Date();
    const endEl = document.getElementById('endDate');
    if(endEl) endEl.valueAsDate = today;
    const startEl = document.getElementById('startDate');
    if(startEl) startEl.valueAsDate = new Date(today.getFullYear(), today.getMonth(), 1);

    bindEvents();
    await loadSalesFromCloud();
}

// --- EVENT BINDING ---
function bindEvents() {
    document.getElementById('btnExportExcel')?.addEventListener('click', exportExcel);
    document.getElementById('btnExportPDF')?.addEventListener('click', exportPDF);
    document.getElementById('btnOpenExportModal')?.addEventListener('click', () => UI.showModal('exportModal'));
    document.getElementById('btnCloseExportModal')?.addEventListener('click', () => UI.hideModal('exportModal'));

    // Compact Mode Toggle
    document.getElementById('btnToggleCompact')?.addEventListener('click', () => {
        document.body.classList.toggle('compact-mode');
        const icon = document.querySelector('#btnToggleCompact i');
        if(!icon) return;

        if(document.body.classList.contains('compact-mode')) {
            icon.className = 'fa-solid fa-expand';
            localStorage.setItem('reports_compact', 'true');
        } else {
            icon.className = 'fa-solid fa-compress';
            localStorage.setItem('reports_compact', 'false');
        }
    });

    if(localStorage.getItem('reports_compact') === 'true') {
        document.body.classList.add('compact-mode');
        const icon = document.querySelector('#btnToggleCompact i');
        if(icon) icon.className = 'fa-solid fa-expand';
    }

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) UI.hideModal(overlay.id);
        });
    });

    document.getElementById('startDate')?.addEventListener('change', renderReports);
    document.getElementById('endDate')?.addEventListener('change', renderReports);

    // Event Delegation for row expansion (Removes inline onclick)
    document.getElementById('salesHistoryBody')?.addEventListener('click', (e) => {
        const row = e.target.closest('.sale-row');
        if(row) {
            const dateId = row.getAttribute('data-dateid');
            toggleDetails(dateId);
        }
    });
}

function animateValue(obj, start, end, duration, isCurrency=false) {
    if(!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const val = (progress * (end - start) + start);
        obj.innerHTML = isCurrency ? Formatters.currency(val) : Math.floor(val);
        if (progress < 1) { window.requestAnimationFrame(step); }
    };
    window.requestAnimationFrame(step);
}

function toggleDetails(dateId) {
    const detailRow = document.getElementById('details-' + dateId);
    if(!detailRow) return;
    const isHidden = getComputedStyle(detailRow).display === 'none';
    
    // Close all others
    document.querySelectorAll('.details-row').forEach(row => { 
        row.classList.remove('active'); 
        row.style.display = 'none'; 
    });
    
    if(isHidden) {
        if(window.innerWidth < 768) { 
            detailRow.style.display = 'block'; 
        } else { 
            detailRow.style.display = 'table-row'; 
        }
        setTimeout(() => detailRow.classList.add('active'), 10);
    }
}

// --- DATA ENGINE ---
async function loadSalesFromCloud() {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const mobile = user.mobile || user.phone;

    let shops = [{ merchantId: user.merchantId, shopName: user.shopName || 'Main Shop' }];

    const storedShopsStr = localStorage.getItem(`bharatpos_shops_${mobile}`);
    if (storedShopsStr) {
        try {
            const fetchedShops = JSON.parse(storedShopsStr);
            if (fetchedShops && fetchedShops.length > 0) shops = fetchedShops;
        } catch(e) {}
    }

    const branchFilter = document.getElementById('filterBranch');
    const shopSwitcher = document.getElementById('globalShopSwitcher');

    if (shops.length > 1) {
        const optionsHtml = '<option value="all">🌍 All Branches</option>' + 
            shops.map(s => `<option value="${s.merchantId}" ${s.merchantId === user.merchantId ? 'selected' : ''}>${Security.escapeHtml(s.shopName)} ${s.isMain ? '⭐' : ''}</option>`).join('');

        if (branchFilter) {
            branchFilter.style.display = 'inline-block';
            branchFilter.innerHTML = optionsHtml;
            branchFilter.value = user.merchantId;
            branchFilter.addEventListener('change', (e) => {
                const val = e.target.value;
                if(shopSwitcher) shopSwitcher.value = val;
                
                if (val === 'all' || val === user.merchantId) {
                    renderReports();
                } else if (window.switchActiveShop) {
                    window.switchActiveShop(val);
                }
            });
        }
        
        if (shopSwitcher) {
            shopSwitcher.style.display = 'inline-block';
            shopSwitcher.innerHTML = optionsHtml;
            shopSwitcher.value = user.merchantId;
            shopSwitcher.addEventListener('change', (e) => {
                const val = e.target.value;
                if(branchFilter) branchFilter.value = val;
                
                if (val === 'all' || val === user.merchantId) {
                    renderReports();
                } else if (window.switchActiveShop) {
                    window.switchActiveShop(val);
                }
            });
        }
    }

    let eSales = await dbGet('bharatpos_enterprise_sales', 'null');
    if (eSales === null) {
        eSales = await dbGet('bharatpos_sales', '[]');
    }
    allSales = eSales;
    if(allSales.length > 0) renderReports();

    if (user && user.merchantId && typeof user.merchantId === 'string' && user.merchantId.trim() !== '' && db && navigator.onLine) {
        try {
            let allEnterpriseSales = [];
            
            const fetchPromises = shops.map(async (shop) => {
                if(!shop.merchantId) return;
                try {
                    const salesRef = collection(db, "shops", shop.merchantId, "sales");
                    const snap = await getDocs(salesRef);
                    snap.forEach(doc => {
                        let data = doc.data();
                        data._branchId = shop.merchantId;
                        data._branchName = shop.shopName;
                        allEnterpriseSales.push(data);
                    });
                } catch(e) { console.warn(`Failed fetching sales for branch: ${shop.shopName}`); }
            });
            
            await Promise.all(fetchPromises);
            
            allEnterpriseSales.sort((a, b) => new Date(b.date) - new Date(a.date));
            allSales = allEnterpriseSales;
            
            if(window.dbSave) await window.dbSave('bharatpos_enterprise_sales', allSales);
            
            renderReports();
        } catch (e) {
            console.warn("Enterprise Fetch Error", e);
        }
    }
}

function groupSalesByDate() {
    const sales = allSales || [];
    const grouped = {};
    
    const startEl = document.getElementById('startDate');
    const endEl = document.getElementById('endDate');
    if(!startEl || !endEl) return grouped;

    const startD = new Date(startEl.value); startD.setHours(0,0,0,0);
    const endD = new Date(endEl.value); endD.setHours(23,59,59,999);
    
    let branchFilter = 'all';
    const ss = document.getElementById('globalShopSwitcher');
    const bf = document.getElementById('filterBranch');
    if(ss && ss.style.display !== 'none') branchFilter = ss.value;
    else if(bf && bf.style.display !== 'none') branchFilter = bf.value;

    sales.forEach(sale => {
        if(branchFilter !== 'all' && sale._branchId !== branchFilter && sale.merchantId !== branchFilter) return;

        const saleDateObj = new Date(sale.date);
        if(saleDateObj < startD || saleDateObj > endD) return;

        let rawDate = sale.date || new Date().toISOString();
        const d = rawDate.substring(0, 10); 
        if(!grouped[d]) grouped[d] = { gross: 0, netCollected: 0, tax: 0, bills: 0, itemsCount: 0, products: {} };
        
        const pMode = sale.paymentMethod || sale.paymentMode || 'Cash';
        let collected = 0;
        let gross = Number(sale.total || sale.amount || 0);

        if (pMode === 'Partial' && sale.split) {
            collected = Number(sale.split.cash || 0) + Number(sale.split.online || 0);
        } else if (pMode !== 'Udhaar') {
            collected = gross;
        }

        if(sale.isPaid && sale.settledDate) {
            const setStr = new Date(sale.settledDate).toISOString().substring(0, 10);
            if(setStr === d && rawDate.substring(0,10) !== d) {
                collected += (pMode === 'Partial' && sale.split) ? Number(sale.split.udhaar) : gross;
            }
        }

        let tax = 0;
        (sale.items || []).forEach(item => {
            let amt = Number(item.total || (item.price * item.qty) || 0);
            if(item.gstRate && Number(item.gstRate) > 0) {
                if(item.priceType === 'inclusive') tax += amt - (amt / (1 + (Number(item.gstRate)/100)));
                else tax += amt * (Number(item.gstRate)/100);
            }
            
            const q = Number(item.qty || 1);
            grouped[d].itemsCount += q;
            
            const displayName = `${Security.escapeHtml(item.name)} ${item.variant ? `(${Security.escapeHtml(item.variant)})` : ''}`;
            grouped[d].products[displayName] = (grouped[d].products[displayName] || 0) + q;
        });

        grouped[d].gross += gross;
        grouped[d].netCollected += collected;
        grouped[d].tax += tax;
        grouped[d].bills++;
    });
    return grouped;
}

// --- MAIN RENDER ---
function renderReports(){
    const data = groupSalesByDate();
    const tableBody = document.getElementById('salesHistoryBody');
    if(!tableBody) return;
    const sortedDates = Object.keys(data).sort().reverse();
    
    let totalNet = 0, totalGross = 0, totalTax = 0, totalBills = 0, totalItems = 0;
    let maxDailyNet = 0;

    sortedDates.forEach(date => {
        const d = data[date];
        totalNet += d.netCollected;
        totalGross += d.gross;
        totalTax += d.tax;
        totalBills += d.bills;
        totalItems += d.itemsCount;
        if(d.netCollected > maxDailyNet) maxDailyNet = d.netCollected;
    });

    animateValue(document.getElementById('kpiNetRev'), 0, totalNet, 1000, true);
    animateValue(document.getElementById('kpiGrossRev'), 0, totalGross, 1000, true);
    animateValue(document.getElementById('kpiGST'), 0, totalTax, 1000, true);
    animateValue(document.getElementById('kpiBills'), 0, totalBills, 1000);

    if(sortedDates.length === 0){
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:50px; color:var(--text-muted); font-weight:700;">No sales records found for this period.</td></tr>';
        return;
    }

    const historyHtml = sortedDates.map((date, index) => {
        const rowData = data[date];
        const dateId = date.replace(/-/g, ''); 
        const barWidth = maxDailyNet > 0 ? (rowData.netCollected / maxDailyNet) * 100 : 0;
        
        const productEntries = Object.entries(rowData.products).sort((a,b)=>b[1]-a[1]);
        let productsHtml = productEntries.length > 0 
            ? productEntries.map(([name, qty]) => `<div class="product-chip"><span>${name}</span><div class="chip-qty">${qty}</div></div>`).join('') 
            : '<span style="color:var(--text-muted); font-size:12px;">No item details</span>';
        
        const dateObj = new Date(date);
        const today = new Date().toISOString().split('T')[0];
        const friendlyDate = (date === today) ? "Today" : dateObj.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });

        return `
            <tr class="sale-row" data-dateid="${dateId}">
                <td>
                    <div style="font-weight:800; color:var(--text-main); font-size:14px; font-family:var(--font-head);">${friendlyDate}</div>
                    <div style="font-size:11px; color:var(--text-muted); margin-top:4px; font-weight:700;">${date}</div>
                </td>
                <td class="text-right">${rowData.bills}</td>
                <td class="text-right">${rowData.itemsCount}</td>
                <td class="text-right" style="color:var(--text-muted); font-family:'JetBrains Mono'; font-weight:700;">₹${rowData.gross.toFixed(2)}</td>
                <td class="text-right" style="color:var(--warning); font-family:'JetBrains Mono'; font-weight:700;">₹${rowData.tax.toFixed(2)}</td>
                <td class="text-right" style="position:relative;">
                    <div class="trend-bg" style="width:${barWidth * 0.7}px"></div> 
                    <span class="money-cell">₹${Formatters.currency(rowData.netCollected)}</span>
                </td>
            </tr>
            <tr id="details-${dateId}" class="details-row">
                <td colspan="6" style="padding:0; background:transparent;">
                    <div class="details-content">
                        <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:var(--primary); font-weight:800; margin-bottom:12px;">Items Breakdown</div>
                        <div class="product-grid">${productsHtml}</div>
                    </div>
                </td>
            </tr>`;
    }).join('');

    tableBody.innerHTML = historyHtml;
    handleAISnapshot(data, totalNet, totalGross, totalTax);
}

// --- EXPORT LOGIC ---
function exportExcel() {
    const data = groupSalesByDate();
    const sortedDates = Object.keys(data).sort().reverse();
    if(sortedDates.length === 0) return alert("No data to export.");

    let rows = [];
    sortedDates.forEach(date => {
        const d = data[date];
        rows.push({
            "Date": date,
            "Total Bills": d.bills,
            "Items Sold": d.itemsCount,
            "Gross Sales": d.gross.toFixed(2),
            "GST Collected": d.tax.toFixed(2),
            "Net Collected": d.netCollected.toFixed(2)
        });
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch: 15}, {wch: 12}, {wch: 12}, {wch: 15}, {wch: 15}, {wch: 15}];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daily_Audit");
    XLSX.writeFile(wb, `BharatPOS_Daily_Audit_${Date.now()}.xlsx`);
    
    UI.hideModal('exportModal');
}

function exportPDF() {
    const data = groupSalesByDate();
    const sortedDates = Object.keys(data).sort().reverse();
    if(sortedDates.length === 0) return alert("No data to export.");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4'); 
    
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const shopName = user.shopName || "BharatPOS Merchant";
    
    doc.setFontSize(16); 
    doc.setTextColor(25, 118, 210);
    doc.text("DAILY AUDIT REPORT", 14, 15);
    
    doc.setFontSize(10); 
    doc.setTextColor(100, 100, 100);
    
    let branchFilter = 'all';
    let filterText = 'All Branches';
    const ss = document.getElementById('globalShopSwitcher');
    const bf = document.getElementById('filterBranch');
    
    if(ss && ss.style.display !== 'none') {
        branchFilter = ss.value;
        filterText = ss.options[ss.selectedIndex].text.replace('⭐','').trim();
    } else if (bf && bf.style.display !== 'none') {
        branchFilter = bf.value;
        filterText = bf.options[bf.selectedIndex].text.replace('⭐','').trim();
    }

    doc.text(`Business Name: ${shopName} (${filterText})`, 14, 22);
    doc.text(`Period: ${document.getElementById('startDate').value} to ${document.getElementById('endDate').value}`, 14, 27);
    
    const tableData = sortedDates.map(date => {
        const d = data[date];
        return [
            date,
            d.bills.toString(),
            d.itemsCount.toString(),
            d.gross.toFixed(2),
            d.tax.toFixed(2),
            d.netCollected.toFixed(2)
        ];
    });

    doc.autoTable({
        head: [['Date', 'Bills', 'Items', 'Gross (Rs)', 'GST (Rs)', 'Net Collected (Rs)']],
        body: tableData,
        startY: 35,
        theme: 'grid',
        headStyles: { fillColor: [25, 118, 210], textColor: [255, 255, 255] },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } }
    });
    
    doc.save(`Daily_Audit_${Date.now()}.pdf`);
    UI.hideModal('exportModal');
}

// --- AI & FIREBASE SYNC LOGIC ---
function hashStringDjb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) + hash) + str.charCodeAt(i); hash = hash & 0xFFFFFFFF; }
    return (hash >>> 0).toString(16);
}

function updateSyncStatus(status) {
    const el = document.getElementById('syncStatus');
    const txt = document.getElementById('syncText');
    if(!el || !txt) return;
    
    if (status === 'syncing') {
        el.classList.add('sync-active');
        txt.innerText = "Syncing with AI...";
    } else if (status === 'success') {
        el.classList.add('sync-active');
        const dot = document.querySelector('.sync-dot');
        if(dot) dot.style.background = 'var(--success)';
        txt.innerText = "AI Up to Date";
        setTimeout(() => el.classList.remove('sync-active'), 3000);
    } else if (status === 'error') {
        el.classList.add('sync-active');
        const dot = document.querySelector('.sync-dot');
        if(dot) dot.style.background = 'var(--danger)';
        txt.innerText = "Sync Failed";
    }
}

async function handleAISnapshot(data, totalNet, totalGross, totalTax) {
    try {
        const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
        if (!user.merchantId) return;

        const snapshot = getReportsSnapshot(data, totalNet, totalGross, totalTax, user);
        
        const contentToHash = JSON.stringify({ revenue: snapshot.net_collected_revenue, history: snapshot.daily_history });
        const snapshotHash = hashStringDjb2(contentToHash);
        const lastHash = localStorage.getItem('bharatpos_last_sent_reports_snapshot_hash');

        if (lastHash !== snapshotHash) {
            updateSyncStatus('syncing');

            let firebasePromise = Promise.resolve();
            if(db) {
                firebasePromise = updateDoc(doc(db, "shops", user.merchantId), {
                    auditData: snapshot
                }).catch(e => console.error("Firebase Audit Sync failed:", e));
            }

            // Fallback for buildUrl if not globally defined
            const consultUrl = typeof window.buildUrl === 'function' ? window.buildUrl('/ai-business-consult') : 'https://server-xy7s.onrender.com/ai-business-consult';
            const renderPromise = fetch(consultUrl, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ snapshot: snapshot, user_prompt: "System Update" }) 
            });

            const [fbRes, renderRes] = await Promise.allSettled([firebasePromise, renderPromise]);

            if (renderRes.status === 'fulfilled' && renderRes.value.ok) {
                localStorage.setItem('bharatpos_last_sent_reports_snapshot_hash', snapshotHash);
                updateSyncStatus('success');
            } else {
                updateSyncStatus('error');
            }
        }
    } catch(e) { console.error("Snapshot Error", e); updateSyncStatus('error'); }
}

function getReportsSnapshot(groupedData, netTotal, grossTotal, taxTotal, user) {
    const dates = Object.keys(groupedData).sort().reverse();
    
    const dateEntries = dates.map(date => {
        const d = groupedData[date];
        const products = Object.entries(d.products || {}).map(([name, qty])=>({ name, qty: Number(qty) })).slice(0, 10);
        return { 
            date, 
            net_collected: Number(d.netCollected || 0), 
            gross_sales: Number(d.gross || 0),
            tax_collected: Number(d.tax || 0),
            bills: Number(d.bills || 0), 
            total_items: Number(d.itemsCount || 0),
            top_products: products 
        };
    });

    return { 
        type: "aggregated_audit_report", 
        generated_at: new Date().toISOString(), 
        net_collected_revenue: Number(netTotal || 0), 
        gross_sales_revenue: Number(grossTotal || 0),
        total_gst_collected: Number(taxTotal || 0),
        daily_history: dateEntries 
    };
}

// KICKSTART
initReports();