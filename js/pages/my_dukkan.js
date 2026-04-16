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

    // Form Submit
    document.getElementById('formAddExpense')?.addEventListener('submit', addExpense);

    // Dynamic Expense Deletion
    document.getElementById('expenseListBody')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-delete-exp');
        if(btn) deleteExpense(btn.getAttribute('data-id'));
    });

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

    refreshUI();

    // Pull from Cloud
    if (user.merchantId && db && navigator.onLine) {
        try {
            let allEntSales = [];
            let allEntExp = [];
            
            const fetchPromises = shops.map(async (shop) => {
                if(!shop.merchantId) return;
                try {
                    const sSnap = await getDocs(collection(db, "shops", shop.merchantId, "sales"));
                    sSnap.forEach(d => { let data = d.data(); data._branchId = shop.merchantId; allEntSales.push(data); });

                    const eSnap = await getDocs(collection(db, "shops", shop.merchantId, "expenses"));
                    eSnap.forEach(d => { let data = d.data(); data._branchId = shop.merchantId; allEntExp.push(data); });
                } catch(e) {}
            });
            
            await Promise.all(fetchPromises);
            
            enterpriseSales = allEntSales;
            enterpriseExpenses = allEntExp.sort((a,b) => new Date(b.date) - new Date(a.date));
            
            await dbSave('bharatpos_enterprise_sales', enterpriseSales);
            await dbSave('bharatpos_enterprise_expenses', enterpriseExpenses);
            
            refreshUI();
        } catch (e) {
            console.warn("Enterprise Fetch Error", e);
        }
    }
}

function refreshUI() {
    renderKPIs();
    renderExpenses();
    if(document.getElementById('tab-analytics')?.classList.contains('active')) {
        renderCharts();
    }
}

// --- RENDERERS ---
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

    // Confetti logic if balance is high and hasn't triggered recently
    if (balance > 10000 && !sessionStorage.getItem('confetti_played')) {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors: ['#10b981', '#1976d2'] });
        sessionStorage.setItem('confetti_played', 'true');
    }
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
        const dObj = new Date(s.date);
        if(dObj >= days30 && dObj <= today) {
            const dStr = dObj.toISOString().split('T')[0];
            const pMode = s.paymentMethod || s.paymentMode || 'Cash';
            const total = Number(s.total || s.amount || 0);

            if(s.isPaid) trendMap[dStr].in += total;
            else if(pMode === 'Partial' && s.split) trendMap[dStr].in += Number(s.split.cash||0) + Number(s.split.online||0);
            else if(pMode !== 'Udhaar') trendMap[dStr].in += total;
        }
    });

    // Prepare Pie Data
    const catMap = {};

    fExp.forEach(e => {
        const dObj = new Date(e.date);
        if(dObj >= days30 && dObj <= today) {
            const dStr = dObj.toISOString().split('T')[0];
            trendMap[dStr].out += Number(e.amount);
        }
        catMap[e.cat] = (catMap[e.cat] || 0) + Number(e.amount);
    });

    const labels = Object.keys(trendMap).map(d => {
        const dt = new Date(d);
        return dt.toLocaleDateString('en-US', {month:'short', day:'numeric'});
    });
    const dataIn = Object.values(trendMap).map(v => v.in);
    const dataOut = Object.values(trendMap).map(v => v.out);

    // Draw Trend Chart
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

    // Draw Pie Chart
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

// --- LOGIC ACTIONS ---
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

        // Cache Locally
        let localExp = await dbGet('bharatpos_expenses', '[]');
        localExp.push(exp);
        await dbSave('bharatpos_expenses', localExp);

        // Update Enterprise Array Instantly
        enterpriseExpenses.unshift(exp);
        await dbSave('bharatpos_enterprise_expenses', enterpriseExpenses);

        refreshUI();
        document.getElementById('formAddExpense').reset();
        UI.showToast("Expense Recorded Successfully!");

        // Cloud Sync
        if (db && navigator.onLine) {
            await setDoc(doc(db, "shops", targetBranch, "expenses", exp.id), exp);
        }
    } catch(err) {
        console.error(err);
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
        
        // Find expense to know which branch it belongs to
        const expItem = enterpriseExpenses.find(e => e.id === id);
        const targetBranch = expItem ? (expItem._branchId || user.merchantId) : user.merchantId;

        // Remove from arrays
        enterpriseExpenses = enterpriseExpenses.filter(e => e.id !== id);
        await dbSave('bharatpos_enterprise_expenses', enterpriseExpenses);

        let localExp = await dbGet('bharatpos_expenses', '[]');
        localExp = localExp.filter(e => e.id !== id);
        await dbSave('bharatpos_expenses', localExp);

        refreshUI();
        UI.showToast("Expense Deleted");

        // Cloud Sync
        if (db && navigator.onLine && targetBranch) {
            await deleteDoc(doc(db, "shops", targetBranch, "expenses", id));
        }
    } catch(err) {
        console.error(err);
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
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `BharatPOS_Expenses_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// KICKSTART
initDukkan();
