// File: /js/pages/sales.js

import { db } from '../core/firebase.js';
import { doc, runTransaction, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { dbGet, dbSave } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';
import { Security } from '../utils/security.js';
import { Formatters } from '../utils/formatters.js';

// --- ENCAPSULATED STATE ---
let enterpriseSales = [];
let filteredSales = [];
let currentPage = 0;
const pageSize = 50;
let observer = null;

// --- INITIALIZATION ---
async function initSales() {
    Navigation.inject('sales');

    // Set Default Dates
    const today = new Date();
    const startEl = document.getElementById('startDate');
    const endEl = document.getElementById('endDate');
    if(endEl) endEl.valueAsDate = today;
    if(startEl) startEl.valueAsDate = new Date(today.getFullYear(), today.getMonth(), 1);

    bindEvents();
    setupIntersectionObserver();
    await loadSalesData();
}

// --- EVENT BINDING ---
function bindEvents() {
    document.getElementById('startDate')?.addEventListener('change', applyFilters);
    document.getElementById('endDate')?.addEventListener('change', applyFilters);
    document.getElementById('filterMode')?.addEventListener('change', applyFilters);
    document.getElementById('searchInput')?.addEventListener('input', applyFilters);

    document.getElementById('btnExportExcel')?.addEventListener('click', exportToExcel);
    document.getElementById('btnExportPDF')?.addEventListener('click', exportToPDF);

    document.getElementById('btnCloseInvoice')?.addEventListener('click', () => UI.hideModal('invoiceModal'));
    document.getElementById('btnPrintInvoice')?.addEventListener('click', printInvoice);

    // Modals Click-Outside
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) UI.hideModal(e.target.id);
        });
    });

    // Event Delegation for Grid Actions
    document.getElementById('salesGrid')?.addEventListener('click', (e) => {
        const btnView = e.target.closest('.btn-view');
        if(btnView) {
            const id = btnView.getAttribute('data-id');
            viewInvoice(id);
            return;
        }

        const btnDel = e.target.closest('.btn-delete');
        if(btnDel) {
            const id = btnDel.getAttribute('data-id');
            deleteInvoice(id);
        }
    });

    // Handle Global Branch Switcher
    const switcher = document.getElementById('globalShopSwitcher');
    if (switcher) {
        switcher.addEventListener('change', (e) => {
            applyFilters();
        });
    }
}

// --- DATA ENGINE ---
async function loadSalesData() {
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

    const shopSwitcher = document.getElementById('globalShopSwitcher');
    if (shops.length > 1 && shopSwitcher) {
        const optionsHtml = '<option value="all">🌍 All Branches</option>' + 
            shops.map(s => `<option value="${s.merchantId}" ${s.merchantId === user.merchantId ? 'selected' : ''}>${Security.escapeHtml(s.shopName)} ${s.isMain ? '⭐' : ''}</option>`).join('');
        
        shopSwitcher.style.display = 'inline-block';
        shopSwitcher.innerHTML = optionsHtml;
        shopSwitcher.value = user.merchantId;
    }

    // Load Local & Enterprise Cache
    let localSales = await dbGet('bharatpos_sales', '[]');
    let eSales = await dbGet('bharatpos_enterprise_sales', '[]');
    
    let mergedSalesMap = {};
    [...eSales, ...localSales].forEach(s => mergedSalesMap[s.id] = s);
    enterpriseSales = Object.values(mergedSalesMap).sort((a, b) => new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp));

    applyFilters();

    // Pull Fresh from Cloud if online
    if (user.merchantId && db && navigator.onLine) {
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
                } catch(e) {}
            });
            
            await Promise.all(fetchPromises);
            
            allEnterpriseSales.sort((a, b) => new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp));
            enterpriseSales = allEnterpriseSales;
            
            await dbSave('bharatpos_enterprise_sales', enterpriseSales);
            applyFilters();
        } catch (e) {
            console.warn("Enterprise Fetch Error", e);
        }
    }
}

function applyFilters() {
    const startEl = document.getElementById('startDate');
    const endEl = document.getElementById('endDate');
    const modeEl = document.getElementById('filterMode');
    const searchEl = document.getElementById('searchInput');
    const branchEl = document.getElementById('globalShopSwitcher');

    if(!startEl || !endEl || !modeEl || !searchEl) return;

    const startD = new Date(startEl.value); startD.setHours(0,0,0,0);
    const endD = new Date(endEl.value); endD.setHours(23,59,59,999);
    const mode = modeEl.value;
    const query = searchEl.value.toLowerCase().trim();
    const branchFilter = (branchEl && branchEl.style.display !== 'none') ? branchEl.value : 'all';

    filteredSales = enterpriseSales.filter(s => {
        if(branchFilter !== 'all' && s._branchId !== branchFilter && s.merchantId !== branchFilter) return false;

        const d = new Date(s.date || s.timestamp || Date.now());
        if(d < startD || d > endD) return false;
        
        // Bulletproof Payment Mode Extraction
        const pMode = String(s.paymentMethod || s.paymentMode || 'Cash');
        
        if(mode === 'Settled') {
            if(!s.isPaid || !s.settledDate) return false;
        } else if(mode !== 'ALL') {
            if(mode === 'Udhaar' && s.isPaid) return false;
            if(!pMode.includes(mode)) return false;
        }

        if(query) {
            const cust = String(s.customer || s.customerName || '').toLowerCase();
            const phone = String(s.phone || s.customerPhone || '');
            const id = String(s.id || '').toLowerCase();
            if(!cust.includes(query) && !phone.includes(query) && !id.includes(query)) return false;
        }

        return true;
    });

    renderKPIs();
    
    currentPage = 0;
    const grid = document.getElementById('salesGrid');
    if(grid) grid.innerHTML = '';
    renderChunk();
}

// --- RENDERERS ---
function renderKPIs() {
    let totalSales = 0;
    let udhaarPending = 0;
    
    filteredSales.forEach(s => {
        const pMode = String(s.paymentMethod || s.paymentMode || 'Cash');
        const total = Number(s.total || s.amount || 0);

        if (pMode === 'Partial' && s.split) {
            totalSales += Number(s.split.cash || 0) + Number(s.split.online || 0);
            if(!s.isPaid) udhaarPending += Number(s.split.udhaar || 0);
        } else if (pMode === 'Udhaar') {
            if(!s.isPaid) udhaarPending += total;
        } else {
            totalSales += total;
        }

        if(s.isPaid && s.settledDate) {
            totalSales += (pMode.includes('Partial') && s.split) ? Number(s.split.udhaar || 0) : total;
        }
    });

    const avgBill = filteredSales.length > 0 ? (totalSales / filteredSales.length) : 0;

    const tSalesEl = document.getElementById('kpiTotalSales'); if(tSalesEl) tSalesEl.innerText = `₹${Formatters.currency(totalSales)}`;
    const tBillsEl = document.getElementById('kpiTotalBills'); if(tBillsEl) tBillsEl.innerText = Formatters.currency(filteredSales.length);
    const avgEl = document.getElementById('kpiAvgBill'); if(avgEl) avgEl.innerText = `₹${Formatters.currency(avgBill)}`;
    const udhaarEl = document.getElementById('kpiUdhaar'); if(udhaarEl) udhaarEl.innerText = `₹${Formatters.currency(udhaarPending)}`;
}

function renderChunk() {
    const grid = document.getElementById('salesGrid');
    if(!grid) return;

    const start = currentPage * pageSize;
    const end = start + pageSize;
    const chunk = filteredSales.slice(start, end);

    if (filteredSales.length === 0 && currentPage === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:50px;color:var(--text-muted);font-weight:700;">No sales found for the selected filters.</div>`;
        const trigger = document.getElementById('loadMoreTrigger');
        if(trigger) trigger.style.display = 'none';
        return;
    }

    const fragment = document.createDocumentFragment();

    // BULLETPROOF LOOP: Wrap in Try/Catch to prevent 1 bad record from breaking the whole grid
    chunk.forEach(sale => {
        try {
            const id = String(sale.id || 'UNKNOWN');
            const shortId = id.length > 8 ? id.slice(-8) : id;
            
            const dateObj = new Date(sale.date || sale.timestamp || Date.now());
            const dateStr = dateObj.toLocaleString('en-IN', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
            
            const total = Number(sale.total || sale.amount || 0).toFixed(2);
            
            const custName = String(sale.customer || sale.customerName || 'Walk-in Customer');
            const custPhone = String(sale.phone || sale.customerPhone || '');
            const custDisplay = custPhone ? `${Security.escapeHtml(custName)} (${Security.escapeHtml(custPhone)})` : Security.escapeHtml(custName);
            
            // Extremely safe item parsing
            const itemsSummary = Array.isArray(sale.items) 
                ? sale.items.map(i => {
                    if(!i) return '';
                    return `${i.qty || 1}x ${Security.escapeHtml(String(i.name || 'Item'))}`;
                  }).filter(Boolean).join(', ') 
                : 'No items';
            
            let pMode = String(sale.paymentMethod || sale.paymentMode || 'Cash');
            let modeClass = 'mode-cash';
            
            if(pMode.includes('Online')) modeClass = 'mode-online';
            if(pMode.includes('Udhaar') && !sale.isPaid) modeClass = 'mode-udhaar';
            if(pMode.includes('Partial')) modeClass = 'mode-partial';
            
            if(sale.isPaid && sale.settledDate) modeClass = 'mode-settled'; 

            const card = document.createElement('div');
            card.className = 'invoice-card';
            card.innerHTML = `
                <div class="inv-header">
                    <div>
                        <div class="inv-id">#${Security.escapeHtml(shortId)}</div>
                        <div class="inv-date">${dateStr}</div>
                        ${sale._branchName ? `<div style="font-size:10px; color:var(--primary); font-weight:800; margin-top:4px;">📍 ${Security.escapeHtml(String(sale._branchName))}</div>` : ''}
                    </div>
                    <div style="text-align:right;">
                        <div class="inv-amount">₹${total}</div>
                        <div class="inv-mode ${modeClass}">${Security.escapeHtml(pMode)}</div>
                    </div>
                </div>
                <div class="inv-body">
                    <div class="inv-customer"><i class="fa-solid fa-user"></i> ${custDisplay}</div>
                    <div class="inv-items">${Security.escapeHtml(itemsSummary) || 'No items listed'}</div>
                </div>
                <div class="inv-footer">
                    <button class="btn-action btn-view" data-id="${Security.escapeHtml(id)}"><i class="fa-solid fa-eye"></i> View</button>
                    <button class="btn-action btn-delete" data-id="${Security.escapeHtml(id)}"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            fragment.appendChild(card);
        } catch (error) {
            console.warn("Skipped rendering corrupted invoice:", error, sale);
        }
    });

    grid.appendChild(fragment);

    const trigger = document.getElementById('loadMoreTrigger');
    if(trigger) {
        if (end < filteredSales.length) {
            trigger.style.display = 'block';
        } else {
            trigger.style.display = 'none';
        }
    }
}

function setupIntersectionObserver() {
    const trigger = document.getElementById('loadMoreTrigger');
    if(!trigger) return;
    observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && (currentPage * pageSize) < filteredSales.length) {
            currentPage++;
            renderChunk();
        }
    }, { root: null, threshold: 0.1 });
    observer.observe(trigger);
}

// --- INVOICE VIEW & PRINT ---
function viewInvoice(id) {
    const sale = enterpriseSales.find(s => String(s.id) === String(id));
    if(!sale) return;

    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const shopName = sale._branchName || user.shopName || "BharatPOS Merchant";
    const shopAddress = user.address || "";
    
    let hasGst = false;
    let rows = ''; 
    let subtotal = 0; 
    let totalTax = 0;

    (sale.items || []).forEach(i => {
        if(i.gstRate > 0) hasGst = true;
    });

    (sale.items || []).forEach(i => {
        let taxHtml = '';
        const amt = Number(i.total || (i.price * i.qty));
        if(hasGst) {
            let base = amt; let tax = 0;
            if(i.gstRate > 0) {
                if(i.priceType === 'inclusive') { base = amt / (1 + (Number(i.gstRate)/100)); tax = amt - base; }
                else { tax = amt * (Number(i.gstRate)/100); base = amt; }
            }
            totalTax += tax; subtotal += base;
            taxHtml = `<td class="inv-center">${i.gstRate}%</td>`;
        } else { subtotal += amt; }

        rows += `
        <tr>
            <td>${Security.escapeHtml(String(i.name))} <div style="font-size:10px; color:#555;">${Security.escapeHtml(String(i.variant || ''))} ${i.brand?`(${Security.escapeHtml(String(i.brand))})`:''}</div></td>
            <td class="inv-center">${i.qty}${i.unitLabel==='unit'?'':Security.escapeHtml(String(i.unitLabel || ''))}</td>
            <td class="inv-right">${Number(i.unitPrice || i.price).toFixed(2)}</td>
            ${taxHtml}
            <td class="inv-right">${amt.toFixed(2)}</td>
        </tr>`;
    });

    let taxSummary = hasGst ? `<div class="inv-row"><span>Total GST:</span><span>₹${totalTax.toFixed(2)}</span></div>` : '';
    let discountRow = sale.discount > 0 ? `<div class="inv-row" style="color:red;"><span>Discount:</span><span>-₹${Number(sale.discount).toFixed(2)}</span></div>` : '';

    let splitData = '';
    const pMode = String(sale.paymentMethod || sale.paymentMode || 'Cash');
    if(sale.split) {
        splitData = `<div style="font-size:10px; margin-top:10px; border-top:1px dotted #ccc; padding-top:5px;">
            Split: Cash: ₹${Number(sale.split.cash||0)} | Online: ₹${Number(sale.split.online||0)} | Udhaar: ₹${Number(sale.split.udhaar||0)}
        </div>`;
    }

    const html = `
        <div class="inv-paper-header">
            <h2 style="margin:0; font-size:18px;">${Security.escapeHtml(String(shopName))}</h2>
            ${shopAddress ? `<div>${Security.escapeHtml(String(shopAddress))}</div>` : ''}
            <div style="margin-top:10px; font-weight:bold;">TAX INVOICE</div>
        </div>
        <div style="margin-bottom:10px;">
            <div class="inv-row">
                <span>Inv No: ${Security.escapeHtml(String(sale.id || '').slice(-8))}</span>
                <span>Date: ${new Date(sale.date || sale.timestamp || Date.now()).toLocaleDateString()}</span>
            </div>
            <div class="inv-row">
                <span>Cust: ${Security.escapeHtml(String(sale.customer || sale.customerName || 'Walk-in'))} ${sale.customerPhone || sale.phone ? `(${Security.escapeHtml(String(sale.customerPhone || sale.phone))})` : ''}</span>
                <span>Mode: ${Security.escapeHtml(pMode)}</span>
            </div>
        </div>
        <table class="inv-table">
            <thead>
                <tr>
                    <th>Item</th>
                    <th class="inv-center">Qty</th>
                    <th class="inv-right">Rate</th>
                    ${hasGst ? '<th class="inv-center">GST</th>' : ''}
                    <th class="inv-right">Total</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="inv-totals">
            <div class="inv-row"><span>SubTotal:</span><span>₹${subtotal.toFixed(2)}</span></div>
            ${taxSummary}
            ${discountRow}
            <div class="inv-row" style="font-weight:bold; font-size:16px; margin-top:5px;">
                <span>Grand Total:</span><span>₹${Number(sale.total || sale.amount).toFixed(2)}</span>
            </div>
            ${splitData}
        </div>
        <div style="text-align:center; margin-top:20px; font-size:10px; font-weight:bold;">Thank you for visiting!</div>
    `;
    
    const paper = document.getElementById('invoicePaper');
    if(paper) {
        paper.innerHTML = html;
        paper.setAttribute('data-current-inv', id);
        UI.showModal('invoiceModal');
    }
}

function printInvoice() {
    const paper = document.getElementById('invoicePaper');
    if(!paper) return;
    const printContent = paper.innerHTML;
    const originalContent = document.body.innerHTML;
    
    document.body.innerHTML = `<div style="padding:20px; font-family:monospace; font-size:12px;">${printContent}</div>`;
    window.print();
    document.body.innerHTML = originalContent;
    
    window.location.reload(); 
}

// --- DELETE & RESTORE STOCK LOGIC ---
async function deleteInvoice(id) {
    if(!confirm("Are you sure you want to delete this invoice? The stock for these items will be added back to your inventory.")) return;

    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const saleIndex = enterpriseSales.findIndex(s => String(s.id) === String(id));
    if(saleIndex === -1) return;

    const sale = enterpriseSales[saleIndex];
    const targetBranch = sale._branchId || user.merchantId;
    const uniqueProdIds = [...new Set((sale.items || []).map(item => item.prodId))];

    enterpriseSales.splice(saleIndex, 1);
    
    let localSales = await dbGet('bharatpos_sales', '[]');
    localSales = localSales.filter(s => String(s.id) !== String(id));
    await dbSave('bharatpos_sales', localSales);
    await dbSave('bharatpos_enterprise_sales', enterpriseSales);
    
    applyFilters();
    UI.showToast("Invoice deleted locally. Restoring stock...");

    if (db && navigator.onLine && targetBranch) {
        try {
            await runTransaction(db, async (transaction) => {
                let pSnaps = {};
                for(const pid of uniqueProdIds) {
                    const pRef = doc(db, "shops", targetBranch, "products", pid);
                    pSnaps[pid] = await transaction.get(pRef);
                }

                for(const pid of uniqueProdIds) {
                    const snap = pSnaps[pid];
                    if(snap.exists()) {
                        let pData = snap.data();
                        
                        sale.items.filter(c => c.prodId === pid).forEach(cItem => {
                            const vIdx = pData.variants.findIndex(v => String(v.id) === String(cItem.id));
                            if(vIdx > -1) {
                                let addition = Number(cItem.qty) || 0;
                                if(pData.isLoose) {
                                    const bq = Number(pData.variants[vIdx].baseQty) || 1;
                                    addition = addition / bq; 
                                }
                                
                                pData.variants[vIdx].stock = (Number(pData.variants[vIdx].stock) || 0) + addition;
                            }
                        });
                        transaction.update(snap.ref, { variants: pData.variants });
                    }
                }

                const pMode = String(sale.paymentMethod || sale.paymentMode || 'Cash');
                let udhaarAmt = 0;
                if(!sale.isPaid && pMode.includes('Udhaar')) udhaarAmt = Number(sale.total || sale.amount || 0);
                if(!sale.isPaid && pMode.includes('Partial') && sale.split) udhaarAmt = Number(sale.split.udhaar || 0);

                if(udhaarAmt > 0 && (sale.customerPhone || sale.phone || sale.customer || sale.customerName)) {
                    const identifier = sale.customerPhone || sale.phone || String(sale.customer || sale.customerName).toLowerCase().replace(/\s/g,'_');
                    const cRef = doc(db, "shops", targetBranch, "customers", identifier);
                    const cSnap = await transaction.get(cRef);
                    if(cSnap.exists()) {
                        let cData = cSnap.data();
                        cData.balance = Math.max(0, (Number(cData.balance) || 0) - udhaarAmt);
                        transaction.update(cRef, { balance: cData.balance });
                    }
                }

                const saleRef = doc(db, "shops", targetBranch, "sales", id);
                transaction.delete(saleRef);
            });
            UI.showToast("Cloud sync complete. Stock restored.");
        } catch(e) {
            UI.showToast("Failed to sync stock restoration to cloud.", true);
        }
    }
}

// --- EXPORTS ---
function exportToExcel() {
    if(filteredSales.length === 0) return UI.showToast("No data to export", true);
    
    let rows = [];
    filteredSales.forEach(s => {
        const dateStr = new Date(s.date || s.timestamp || Date.now()).toLocaleString();
        const pMode = String(s.paymentMethod || s.paymentMode || 'Cash');
        const custName = String(s.customer || s.customerName || 'Walk-in');
        
        let itemsStr = '';
        (s.items || []).forEach(i => { itemsStr += `${i.qty}x ${i.name}, `; });
        
        rows.push({
            "Invoice ID": String(s.id),
            "Date": dateStr,
            "Customer": custName,
            "Phone": String(s.customerPhone || s.phone || ''),
            "Payment Mode": pMode,
            "Total Amount": Number(s.total || s.amount).toFixed(2),
            "Items": itemsStr
        });
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Ledger");
    XLSX.writeFile(wb, `Sales_Ledger_${new Date().toISOString().slice(0,10)}.xlsx`);
    UI.showToast("Excel Exported!");
}

function exportToPDF() {
    if(filteredSales.length === 0) return UI.showToast("No data to export", true);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4'); 
    
    doc.setFontSize(16); doc.text("Sales Ledger Report", 14, 15);
    doc.setFontSize(10); doc.text(`Date Range: ${document.getElementById('startDate').value} to ${document.getElementById('endDate').value}`, 14, 22);

    const tableData = filteredSales.map(s => {
        const dateStr = new Date(s.date || s.timestamp || Date.now()).toLocaleDateString();
        const pMode = String(s.paymentMethod || s.paymentMode || 'Cash');
        const custName = String(s.customer || s.customerName || 'Walk-in');
        return [ String(s.id).slice(-8), dateStr, custName, pMode, s.items ? s.items.length.toString() : '0', Number(s.total || s.amount).toFixed(2) ];
    });

    doc.autoTable({
        head: [['Inv ID', 'Date', 'Customer', 'Mode', 'Items', 'Total (Rs)']],
        body: tableData,
        startY: 30,
        theme: 'grid',
        headStyles: { fillColor: [25, 118, 210] }
    });
    
    doc.save(`Sales_Report_${Date.now()}.pdf`);
    UI.showToast("PDF Exported!");
}

// KICKSTART
initSales();