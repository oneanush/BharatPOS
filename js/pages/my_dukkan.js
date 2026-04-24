// File: /js/pages/my_dukkan.js

import { db } from '../core/firebase.js';
import { collection, getDocs, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { dbGet, dbSave } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';
import { Security } from '../utils/security.js';
import { Formatters } from '../utils/formatters.js';

// --- ENCAPSULATED STATE ---
let enterpriseSales = [];
let enterpriseExpenses = [];
let drawerShifts = []; // NEW: Drawer State
let currentBranch = 'all';

let chartTrend = null;
let chartPie = null;

// --- INITIALIZATION ---
async function initDukkan() {
    Navigation.inject('finance');
    bindEvents();
    await loadData();
}

// --- EVENT BINDING ---
function bindEvents() {
    // Tab Switching
    document.getElementById('financeTabs')?.addEventListener('click', (e) => {
        if(e.target.classList.contains('tab-btn')) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            e.target.classList.add('active');
            const targetId = e.target.getAttribute('data-target');
            const content = document.getElementById(targetId);
            if(content) content.classList.add('active');

            if(targetId === 'tab-analytics') renderCharts();
        }
    });

    // Expense Form Submit
    document.getElementById('formAddExpense')?.addEventListener('submit', addExpense);

    // Dynamic Expense Deletion
    document.getElementById('expenseListBody')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-delete-exp');
        if(btn) deleteExpense(btn.getAttribute('data-id'));
    });

    // NEW: Drawer Events
    document.getElementById('btnOpenDrawer')?.addEventListener('click', openDrawer);
    document.getElementById('btnCloseDrawer')?.addEventListener('click', closeDrawer);
    document.getElementById('btnPayIn')?.addEventListener('click', () => handlePayInOut('IN'));
    document.getElementById('btnPayOut')?.addEventListener('click', () => handlePayInOut('OUT'));

    // CSV Download
    document.getElementById('btnDownloadCSV')?.addEventListener('click', downloadCSV);

    // Branch Switcher
    const branchFilter = document.getElementById('filterBranch');
    const globalSwitcher = document.getElementById('globalShopSwitcher');
    
    const applyBranchFilter = (val) => {
        currentBranch = val;
        if(branchFilter) branchFilter.value = val;
        if(globalSwitcher) globalSwitcher.value = val;
        refreshUI();
    };

    if(branchFilter) branchFilter.addEventListener('change', (e) => applyBranchFilter(e.target.value));
    if(globalSwitcher) globalSwitcher.addEventListener('change', (e) => applyBranchFilter(e.target.value));
}

// --- DATA ENGINE ---
async function loadData() {
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
            shops.map(s => `<option value="${s.merchantId}" ${s.merchantId === user.merchantId ? 'selected' : ''}>${Security.escapeHtml(s.shopName)}</option>`).join('');

        if (branchFilter) {
            branchFilter.style.display = 'inline-block';
            branchFilter.innerHTML = optionsHtml;
        }
        if (shopSwitcher) {
            shopSwitcher.style.display = 'inline-block';
            shopSwitcher.innerHTML = optionsHtml;
            shopSwitcher.value = user.merchantId;
        }
    }

    // Load Local Data
    let localSales = await dbGet('bharatpos_sales', '[]');
    let eSales = await dbGet('bharatpos_enterprise_sales', '[]');
    let mergedSales = {};
    [...eSales, ...localSales].forEach(s => mergedSales[s.id] = s);
    enterpriseSales = Object.values(mergedSales);

    let localExp = await dbGet('bharatpos_expenses', '[]');
    let eExp = await dbGet('bharatpos_enterprise_expenses', '[]');
    let mergedExp = {};
    [...eExp, ...localExp].forEach(e => mergedExp[e.id] = e);
    enterpriseExpenses = Object.values(mergedExp).sort((a,b) => new Date(b.date) - new Date(a.date));

    // NEW: Load Drawer Data
    drawerShifts = await dbGet('bharatpos_drawer_shifts', '[]');

    refreshUI();

    // Pull from Cloud
    if (user.merchantId && db && navigator.onLine) {
        try {
            let allEntSales = [];
            let allEntExp = [];
            let allEntDrawers = [];
            
            const fetchPromises = shops.map(async (shop) => {
                if(!shop.merchantId) return;
                try {
                    const sSnap = await getDocs(collection(db, "shops", shop.merchantId, "sales"));
                    sSnap.forEach(d => { let data = d.data(); data._branchId = shop.merchantId; allEntSales.push(data); });

                    const eSnap = await getDocs(collection(db, "shops", shop.merchantId, "expenses"));
                    eSnap.forEach(d => { let data = d.data(); data._branchId = shop.merchantId; allEntExp.push(data); });

                    const dSnap = await getDocs(collection(db, "shops", shop.merchantId, "drawer_shifts"));
                    dSnap.forEach(d => { let data = d.data(); data._branchId = shop.merchantId; allEntDrawers.push(data); });
                } catch(e) {}
            });
            
            await Promise.all(fetchPromises);
            
            enterpriseSales = allEntSales;
            enterpriseExpenses = allEntExp.sort((a,b) => new Date(b.date) - new Date(a.date));
            if(allEntDrawers.length > 0) drawerShifts = allEntDrawers.sort((a,b) => new Date(b.startTime) - new Date(a.startTime));
            
            await dbSave('bharatpos_enterprise_sales', enterpriseSales);
            await dbSave('bharatpos_enterprise_expenses', enterpriseExpenses);
            await dbSave('bharatpos_drawer_shifts', drawerShifts);
            
            refreshUI();
        } catch (e) {
            console.warn("Enterprise Fetch Error", e);
        }
    }
}

function refreshUI() {
    renderKPIs();
    renderExpenses();
    renderDrawerUI(); // NEW
    if(document.getElementById('tab-analytics')?.classList.contains('active')) {
        renderCharts();
    }
}

// --- NEW: DRAWER RENDERING & LOGIC ---
function getActiveShift() {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const targetBranch = (currentBranch !== 'all') ? currentBranch : user.merchantId;
    return drawerShifts.find(s => s.status === 'OPEN' && (s._branchId === targetBranch || s.merchantId === targetBranch));
}

function calculateExpectedCash(shift) {
    if (!shift) return 0;
    let expected = Number(shift.openingCash || 0);

    // Add Pay-Ins, subtract Pay-Outs
    (shift.transactions || []).forEach(tx => {
        if (tx.type === 'IN') expected += Number(tx.amount);
        if (tx.type === 'OUT') expected -= Number(tx.amount);
    });

    // Add Cash Sales during shift
    const shiftStart = new Date(shift.startTime);
    enterpriseSales.forEach(s => {
        const sDate = new Date(s.timestamp || s.date);
        if (sDate >= shiftStart && (s._branchId === shift._branchId || s.merchantId === shift.merchantId)) {
            const pMode = s.paymentMethod || s.paymentMode || 'Cash';
            if (pMode === 'Cash' && s.isPaid) {
                expected += Number(s.total || s.amount || 0);
            } else if (pMode === 'Partial' && s.split) {
                expected += Number(s.split.cash || 0);
            }
        }
    });

    return expected;
}

function renderDrawerUI() {
    const shift = getActiveShift();
    const closedDiv = document.getElementById('drawerClosedState');
    const openDiv = document.getElementById('drawerOpenState');
    const statusLbl = document.getElementById('lblDrawerStatus');
    const timeLbl = document.getElementById('lblDrawerTime');
    const icon = document.getElementById('drawerStatusIcon');
    
    // KPI Elements
    const lblExpected = document.getElementById('lblExpectedCash');
    const lblDiff = document.getElementById('lblCashDiff');

    if (shift) {
        closedDiv.style.display = 'none';
        openDiv.style.display = 'block';
        statusLbl.innerText = 'OPEN';
        statusLbl.style.color = 'var(--success)';
        icon.className = 'fa-solid fa-lock-open';
        icon.style.color = 'var(--success)';
        timeLbl.innerText = `Started: ${new Date(shift.startTime).toLocaleTimeString()}`;
        
        const expected = calculateExpectedCash(shift);
        lblExpected.innerText = `₹${Formatters.currency(expected)}`;
        
        // Show current running discrepancy logic (0 while open)
        lblDiff.innerText = "Pending Close";
        lblDiff.style.color = "var(--text-muted)";
    } else {
        closedDiv.style.display = 'block';
        openDiv.style.display = 'none';
        statusLbl.innerText = 'CLOSED';
        statusLbl.style.color = 'var(--text-muted)';
        icon.className = 'fa-solid fa-lock';
        icon.style.color = 'var(--text-muted)';
        timeLbl.innerText = 'Open shift to start';
        lblExpected.innerText = `₹0.00`;

        // Find last closed shift to show discrepancy
        const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
        const targetBranch = (currentBranch !== 'all') ? currentBranch : user.merchantId;
        const lastShift = drawerShifts.find(s => s.status === 'CLOSED' && (s._branchId === targetBranch || s.merchantId === targetBranch));
        
        if (lastShift) {
            const diff = Number(lastShift.discrepancy || 0);
            lblDiff.innerText = `${diff > 0 ? '+' : ''}₹${Formatters.currency(diff)}`;
            lblDiff.style.color = diff < 0 ? 'var(--danger)' : (diff > 0 ? 'var(--success)' : 'var(--text-main)');
        } else {
            lblDiff.innerText = `₹0.00`;
        }
    }

    // Render History
    const historyBox = document.getElementById('drawerHistoryList');
    if (historyBox) {
        const targetBranch = (currentBranch !== 'all') ? currentBranch : JSON.parse(localStorage.getItem('bharatpos_user') || '{}').merchantId;
        const branchShifts = drawerShifts.filter(s => s._branchId === targetBranch || s.merchantId === targetBranch).slice(0, 10);
        
        if (branchShifts.length === 0) {
            historyBox.innerHTML = `<div class="empty-state"><i class="fa-solid fa-cash-register"></i><p>No drawer activity found.</p></div>`;
            return;
        }

        historyBox.innerHTML = branchShifts.map(s => {
            const isClosed = s.status === 'CLOSED';
            const dateStr = new Date(s.startTime).toLocaleDateString('en-IN', {month:'short', day:'numeric'});
            const diff = Number(s.discrepancy || 0);
            const diffColor = diff < 0 ? 'var(--danger)' : 'var(--success)';
            
            let html = `
            <div class="expense-item" style="border-left: 4px solid ${isClosed ? 'var(--text-muted)' : 'var(--success)'}">
                <div class="exp-info">
                    <div class="exp-title">Shift: ${dateStr} ${isClosed ? '(Closed)' : '(Active)'}</div>
                    <div class="exp-meta">
                        Opened: ₹${Formatters.currency(s.openingCash)}
                        ${isClosed ? `• Expected: ₹${Formatters.currency(s.expectedCash)}` : ''}
                    </div>
                </div>
                <div style="text-align:right;">
                    ${isClosed ? `<div style="font-size:12px; font-weight:800; color:${diffColor}">${diff > 0 ? '+' : ''}₹${Formatters.currency(diff)}</div>` : '<div style="font-size:12px; color:var(--success); font-weight:800;">Running</div>'}
                </div>
            </div>`;
            return html;
        }).join('');
    }
}

async function openDrawer() {
    const input = document.getElementById('inputOpeningCash');
    if(!input.value || input.value < 0) return UI.showToast("Enter a valid opening amount", true);
    
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const targetBranch = (currentBranch !== 'all') ? currentBranch : user.merchantId;

    const newShift = {
        id: `shift_${Date.now()}`,
        _branchId: targetBranch,
        merchantId: targetBranch,
        startTime: new Date().toISOString(),
        openingCash: Number(input.value),
        status: 'OPEN',
        transactions: []
    };

    drawerShifts.unshift(newShift);
    await dbSave('bharatpos_drawer_shifts', drawerShifts);
    
    if (db && navigator.onLine) {
        await setDoc(doc(db, "shops", targetBranch, "drawer_shifts", newShift.id), newShift);
    }

    input.value = '';
    refreshUI();
    UI.showToast("Register Opened successfully!");
}

async function handlePayInOut(type) {
    const shift = getActiveShift();
    if(!shift) return UI.showToast("No active shift found.", true);

    const amtStr = prompt(`Enter Cash Amount to Pay-${type}:`);
    if(!amtStr || isNaN(amtStr) || Number(amtStr) <= 0) return;
    
    const reason = prompt(`Reason for Pay-${type}:`, type === 'IN' ? 'Change added' : 'Petty expense');
    
    shift.transactions.push({
        id: Date.now().toString(),
        type: type,
        amount: Number(amtStr),
        reason: reason || 'N/A',
        time: new Date().toISOString()
    });

    await dbSave('bharatpos_drawer_shifts', drawerShifts);
    
    if (db && navigator.onLine) {
        await setDoc(doc(db, "shops", shift._branchId || shift.merchantId, "drawer_shifts", shift.id), shift, {merge:true});
    }

    refreshUI();
    UI.showToast(`Pay-${type} recorded!`);
}

async function closeDrawer() {
    const shift = getActiveShift();
    if(!shift) return;

    const input = document.getElementById('inputClosingCash');
    if(!input.value || input.value === '') return UI.showToast("Enter Actual Closing Cash", true);

    const expected = calculateExpectedCash(shift);
    const actual = Number(input.value);
    const discrepancy = actual - expected;

    if(!confirm(`Expected Cash: ₹${expected}\nActual Entered: ₹${actual}\nDiscrepancy: ₹${discrepancy}\n\nClose register?`)) return;

    shift.status = 'CLOSED';
    shift.endTime = new Date().toISOString();
    shift.expectedCash = expected;
    shift.actualCash = actual;
    shift.discrepancy = discrepancy;

    await dbSave('bharatpos_drawer_shifts', drawerShifts);
    
    if (db && navigator.onLine) {
        await setDoc(doc(db, "shops", shift._branchId || shift.merchantId, "drawer_shifts", shift.id), shift, {merge:true});
    }

    input.value = '';
    refreshUI();
    UI.showToast("Register Closed!");
}
// --- END DRAWER LOGIC ---


// --- EXISTING RENDERERS ---
function renderKPIs() {
    const fSales = currentBranch === 'all' ? enterpriseSales : enterpriseSales.filter(s => s._branchId === currentBranch || s.merchantId === currentBranch);
    const fExp = currentBranch === 'all' ? enterpriseExpenses : enterpriseExpenses.filter(e => e._branchId === currentBranch || e.merchantId === currentBranch);

    let revenue = 0;
    fSales.forEach(s => {
        const pMode = s.paymentMethod || s.paymentMode || 'Cash';
        const total = Number(s.total || s.amount || 0);

        if (s.isPaid) {
            revenue += total; 
        } else if (pMode === 'Partial' && s.split) {
            revenue += Number(s.split.cash || 0) + Number(s.split.online || 0);
        } else if (pMode !== 'Udhaar') {
            revenue += total;
        }
    });

    let expenseTotal = 0;
    fExp.forEach(e => { expenseTotal += Number(e.amount || 0); });

    const balance = revenue - expenseTotal;

    document.getElementById('kpiMoneyIn').innerText = `₹${Formatters.currency(revenue)}`;
    document.getElementById('kpiMoneyOut').innerText = `₹${Formatters.currency(expenseTotal)}`;
    
    const balEl = document.getElementById('kpiBalance');
    balEl.innerText = `${balance < 0 ? '-' : ''}₹${Formatters.currency(Math.abs(balance))}`;
    balEl.style.color = balance < 0 ? 'var(--danger)' : 'var(--primary)';
}

function renderExpenses() {
    const box = document.getElementById('expenseListBody');
    if(!box) return;

    const fExp = currentBranch === 'all' ? enterpriseExpenses : enterpriseExpenses.filter(e => e._branchId === currentBranch || e.merchantId === currentBranch);

    if (fExp.length === 0) {
        box.innerHTML = `<div class="empty-state"><i class="fa-solid fa-receipt"></i><p>No expenses recorded yet.</p></div>`;
        return;
    }

    box.innerHTML = fExp.slice(0, 50).map(e => {
        const dateStr = new Date(e.date).toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
        let branchHtml = '';
        if(currentBranch === 'all' && e._branchId) {
            branchHtml = `<span style="color:var(--primary); font-weight:800;"><i class="fa-solid fa-store"></i> Loc: ${Security.escapeHtml(e._branchId.slice(-4))}</span>`;
        }
        
        return `
        <div class="expense-item">
            <div class="exp-info">
                <div class="exp-title">${Security.escapeHtml(e.desc || e.cat)}</div>
                <div class="exp-meta">
                    <span>${dateStr}</span> • 
                    <span style="color:var(--warning);">${Security.escapeHtml(e.cat)}</span>
                    ${branchHtml}
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
                <div class="exp-amount">-₹${Formatters.currency(e.amount)}</div>
                <button class="btn-delete-exp" data-id="${Security.escapeHtml(e.id)}" title="Delete Expense"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;
    }).join('');
}

function renderCharts() {
    const fSales = currentBranch === 'all' ? enterpriseSales : enterpriseSales.filter(s => s._branchId === currentBranch || s.merchantId === currentBranch);
    const fExp = currentBranch === 'all' ? enterpriseExpenses : enterpriseExpenses.filter(e => e._branchId === currentBranch || e.merchantId === currentBranch);

    const today = new Date();
    today.setHours(23,59,59,999);
    const days30 = new Date(today);
    days30.setDate(days30.getDate() - 29);
    days30.setHours(0,0,0,0);

    // Prepare Trend Data
    const trendMap = {};
    for(let i=29; i>=0; i--) {
        const d = new Date(today); d.setDate(d.getDate() - i);
        const dStr = d.toISOString().split('T')[0];
        trendMap[dStr] = { in: 0, out: 0 };
    }

    fSales.forEach(s => {
        const dObj = new Date(s.date || s.timestamp);
        if(dObj >= days30 && dObj <= today) {
            const dStr = dObj.toISOString().split('T')[0];
            const pMode = s.paymentMethod || s.paymentMode || 'Cash';
            const total = Number(s.total || s.amount || 0);

            if(s.isPaid) trendMap[dStr].in += total;
            else if(pMode === 'Partial' && s.split) trendMap[dStr].in += Number(s.split.cash||0) + Number(s.split.online||0);
            else if(pMode !== 'Udhaar') trendMap[dStr].in += total;
        }
    });

    const catMap = {};
    fExp.forEach(e => {
        const dObj = new Date(e.date);
        if(dObj >= days30 && dObj <= today) {
            const dStr = dObj.toISOString().split('T')[0];
            trendMap[dStr].out += Number(e.amount);
        }
        catMap[e.cat] = (catMap[e.cat] || 0) + Number(e.amount);
    });

    const labels = Object.keys(trendMap).map(d => new Date(d).toLocaleDateString('en-US', {month:'short', day:'numeric'}));
    const dataIn = Object.values(trendMap).map(v => v.in);
    const dataOut = Object.values(trendMap).map(v => v.out);

    const ctxTrend = document.getElementById('trendChart');
    if(ctxTrend) {
        if(chartTrend) chartTrend.destroy();
        chartTrend = new Chart(ctxTrend, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Income', data: dataIn, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.4 },
                    { label: 'Expense', data: dataOut, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top', labels:{font:{family:"'Plus Jakarta Sans'"}} } },
                scales: { 
                    x: { ticks: { maxTicksLimit: 7, font:{family:"'Plus Jakarta Sans'", size:10} }, grid:{display:false} },
                    y: { ticks: { font:{family:"'Plus Jakarta Sans'"} } }
                }
            }
        });
    }

    const ctxPie = document.getElementById('pieChart');
    if(ctxPie) {
        if(chartPie) chartPie.destroy();
        const pieLabels = Object.keys(catMap);
        const pieData = Object.values(catMap);
        const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#64748b', '#0ea5e9'];

        chartPie = new Chart(ctxPie, {
            type: 'doughnut',
            data: {
                labels: pieLabels.length ? pieLabels : ['No Data'],
                datasets: [{ 
                    data: pieData.length ? pieData : [1], 
                    backgroundColor: pieData.length ? colors : ['#e2e8f0'], 
                    borderWidth: 2, borderColor: '#ffffff' 
                }]
            },
            options: { 
                responsive: true, maintainAspectRatio: false,
                plugins: { 
                    legend: { position: 'right', labels:{font:{family:"'Plus Jakarta Sans'", size:11}} }, 
                    tooltip: { backgroundColor: '#0f172a' } 
                },
                cutout: '65%'
            }
        });
    }
}

async function addExpense(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    btn.disabled = true;

    try {
        const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
        const targetBranch = (currentBranch !== 'all') ? currentBranch : user.merchantId;
        
        if(!targetBranch) throw new Error("No branch selected");

        const exp = {
            id: `exp_${Date.now()}`,
            amount: parseFloat(document.getElementById('expAmount').value),
            cat: document.getElementById('expCategory').value,
            desc: document.getElementById('expDesc').value.trim(),
            paymentMode: document.getElementById('expMode').value,
            date: new Date().toISOString(),
            _branchId: targetBranch
        };

        let localExp = await dbGet('bharatpos_expenses', '[]');
        localExp.push(exp);
        await dbSave('bharatpos_expenses', localExp);

        enterpriseExpenses.unshift(exp);
        await dbSave('bharatpos_enterprise_expenses', enterpriseExpenses);

        refreshUI();
        document.getElementById('formAddExpense').reset();
        UI.showToast("Expense Recorded Successfully!");

        if (db && navigator.onLine) {
            await setDoc(doc(db, "shops", targetBranch, "expenses", exp.id), exp);
        }
    } catch(err) {
        UI.showToast("Failed to save expense.", true);
    } finally {
        btn.innerHTML = origHtml;
        btn.disabled = false;
    }
}

async function deleteExpense(id) {
    if(!confirm("Delete this expense record?")) return;

    try {
        const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
        const expItem = enterpriseExpenses.find(e => e.id === id);
        const targetBranch = expItem ? (expItem._branchId || user.merchantId) : user.merchantId;

        enterpriseExpenses = enterpriseExpenses.filter(e => e.id !== id);
        await dbSave('bharatpos_enterprise_expenses', enterpriseExpenses);

        let localExp = await dbGet('bharatpos_expenses', '[]');
        localExp = localExp.filter(e => e.id !== id);
        await dbSave('bharatpos_expenses', localExp);

        refreshUI();
        UI.showToast("Expense Deleted");

        if (db && navigator.onLine && targetBranch) {
            await deleteDoc(doc(db, "shops", targetBranch, "expenses", id));
        }
    } catch(err) {
        UI.showToast("Failed to delete.", true);
    }
}

function downloadCSV() {
    const fExp = currentBranch === 'all' ? enterpriseExpenses : enterpriseExpenses.filter(e => e._branchId === currentBranch || e.merchantId === currentBranch);
    if(fExp.length === 0) return UI.showToast("No expenses to download.", true);
    
    let csv = "Date,Category,Amount,Description,PaymentMode,BranchId\n";
    fExp.forEach(row => { 
        const desc = row.desc ? row.desc.replace(/,/g, ' ') : '';
        csv += `${new Date(row.date).toLocaleDateString()},${Security.escapeHtml(row.cat)},${row.amount},${Security.escapeHtml(desc)},${Security.escapeHtml(row.paymentMode||'Cash')},${Security.escapeHtml(row._branchId||'Main')}\n`; 
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", `BharatPOS_Expenses_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// KICKSTART
initDukkan();