// File: /js/pages/forecast.js

import { dbGet } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';
import { Security } from '../utils/security.js';

// --- ENCAPSULATED STATE ---
let allProducts = [];
let allSales = [];
let chartInstance = null;
let currentSelectedProduct = null;

// --- INITIALIZATION ---
async function initForecast() {
    Navigation.inject('forecast');
    bindEvents();
    await loadData();
    initEmptyChart();
}

// --- EVENT BINDING ---
function bindEvents() {
    document.getElementById('btnPredict')?.addEventListener('click', handlePredictClick);
    document.getElementById('productSelect')?.addEventListener('change', (e) => {
        currentSelectedProduct = allProducts.find(p => p.id === e.target.value);
    });
    
    document.getElementById('btnRestock')?.addEventListener('click', () => {
        if (!currentSelectedProduct) return;
        const targetQty = document.getElementById('btnRestock').getAttribute('data-target-qty');
        if (targetQty) {
            localStorage.setItem("temp_add_stock", targetQty);
            window.location.href = `products.html?restock=${encodeURIComponent(currentSelectedProduct.name)}`;
        }
    });
}

// --- DATA LOGIC ---
async function loadData() {
    allProducts = await dbGet('bharatpos_enterprise_products', 'null') || await dbGet('bharatpos_products', '[]');
    allSales = await dbGet('bharatpos_enterprise_sales', 'null') || await dbGet('bharatpos_sales', '[]');

    const select = document.getElementById('productSelect');
    if (!select) return;

    if (allProducts.length === 0) {
        select.innerHTML = '<option value="">No products found in inventory</option>';
        return;
    }

    // Sort alphabetically
    allProducts.sort((a,b) => (a.name || '').localeCompare(b.name || ''));

    select.innerHTML = '<option value="">-- Choose a Product --</option>' + 
        allProducts.map(p => {
            const vCount = (p.variants || []).length;
            const displayName = vCount > 1 ? `${p.name} (Base/${vCount} Variants)` : p.name;
            return `<option value="${Security.escapeHtml(p.id)}">${Security.escapeHtml(displayName)}</option>`;
        }).join('');
}

// Extracts 30-day historical data for a specific product
function extractHistoricalData(productId) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    // Create an array of the last 30 days
    const dailySales = new Array(30).fill(0);
    const dateLabels = [];

    for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dateLabels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    allSales.forEach(sale => {
        const saleDate = new Date(sale.date);
        if (saleDate >= thirtyDaysAgo && saleDate <= today) {
            // Find difference in days from today (0 = today, 29 = 30 days ago)
            const diffTime = Math.abs(today - saleDate);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays >= 0 && diffDays < 30) {
                // The array is chronological, so today is index 29
                const arrayIndex = 29 - diffDays;
                
                (sale.items || []).forEach(item => {
                    if (item.prodId === productId) {
                        dailySales[arrayIndex] += Number(item.qty || 1);
                    }
                });
            }
        }
    });

    return { data: dailySales, labels: dateLabels };
}

function getTotalStock(product) {
    let total = 0;
    (product.variants || []).forEach(v => {
        let stock = Number(v.stock || 0);
        if (product.isLoose) {
            stock = stock * (Number(v.baseQty) || 1);
        }
        total += stock;
    });
    return total;
}

// --- AI API COMMUNICATION ---
async function handlePredictClick() {
    const select = document.getElementById('productSelect');
    if (!select || !select.value) {
        UI.showToast("Please select a product first.", true);
        return;
    }

    if (!currentSelectedProduct) {
        currentSelectedProduct = allProducts.find(p => p.id === select.value);
    }

    const btn = document.getElementById('btnPredict');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...`;
    btn.disabled = true;

    try {
        const history = extractHistoricalData(currentSelectedProduct.id);
        
        // Hide UI while loading
        document.getElementById('aiMsgBox').style.display = 'none';
        
        // Fallback for buildUrl if not globally defined
        const url = typeof window.buildUrl === 'function' ? window.buildUrl('/predict') : 'https://server-xy7s.onrender.com/predict';

        // Using AbortController for timeout (Server Wakeup)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 40000); // 40s timeout

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ historical_sales: history.data }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Server Error: ${response.status}`);

        const result = await response.json();
        
        const predictedData = result.predicted_sales || new Array(7).fill(0);
        const reason = result.reason || "Demand looks stable based on historical patterns.";
        const recommendation = result.restock_recommendation || "No";

        // Generate future date labels
        const futureLabels = [];
        const today = new Date();
        for (let i = 1; i <= 7; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            futureLabels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        }

        renderChart(
            [...history.labels, ...futureLabels], 
            history.data, 
            predictedData
        );
        
        updateAIUI(reason, recommendation, predictedData);

        UI.showToast("✅ AI Prediction Generated");
    } catch (err) {
        console.error(err);
        if (err.name === 'AbortError') {
            UI.showToast("Server is waking up. Please wait 10s and try again.", true);
        } else {
            UI.showToast("Failed to connect to AI server. Check console.", true);
        }
    } finally {
        btn.innerHTML = origHtml;
        btn.disabled = false;
    }
}

// --- UI UPDATERS ---
function updateAIUI(reason, recommendation, predictedData) {
    const box = document.getElementById('aiMsgBox');
    const badgeStatus = document.getElementById('aiStatusBadge');
    const badgeQty = document.getElementById('aiQuantityBadge');
    const reasonText = document.getElementById('aiReason');
    const btnRestock = document.getElementById('btnRestock');
    
    const currentStock = getTotalStock(currentSelectedProduct);
    let totalPredicted = 0;
    predictedData.forEach(val => totalPredicted += Number(val));
    
    document.getElementById('statCurrentStock').innerText = Math.round(currentStock);
    document.getElementById('statPredictedDemand').innerText = Math.round(totalPredicted);

    // Default resetting
    box.className = 'ai-msg-box';
    badgeStatus.className = 'ai-badge badge-normal';
    badgeStatus.innerHTML = '<i class="fa-solid fa-check-circle"></i> Stock Sufficient';
    badgeQty.style.display = 'none';
    btnRestock.style.display = 'none';
    
    reasonText.innerText = reason;
    box.style.display = 'block';

    // Risk / Restock Logic
    if (recommendation === 'Yes' || totalPredicted > currentStock) {
        box.className = 'ai-msg-box alert';
        
        if (currentStock <= 0) {
            badgeStatus.className = 'ai-badge badge-danger';
            badgeStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Out of Stock';
        } else {
            badgeStatus.className = 'ai-badge badge-warning';
            badgeStatus.innerHTML = '<i class="fa-solid fa-bolt"></i> High Demand Expected';
        }

        const needed = Math.max(1, Math.round(totalPredicted - currentStock));
        
        badgeQty.innerText = `Target Restock: ${needed} Units Min.`;
        badgeQty.style.display = 'inline-flex';
        
        btnRestock.innerHTML = `<i class="fa-solid fa-cart-plus"></i> Auto-Fill Inventory (+${needed})`;
        btnRestock.setAttribute('data-target-qty', needed);
        btnRestock.style.display = 'flex';
    }
}

// --- CHART.JS RENDERING ---
function initEmptyChart() {
    const ctx = document.getElementById('forecastChart');
    if (!ctx) return;
    
    // Draw an empty placeholder chart
    renderChart(
        ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'], 
        [0, 0, 0, 0, 0], 
        []
    );
}

function renderChart(labels, historical, predicted) {
    const ctx = document.getElementById('forecastChart');
    if (!ctx) return;

    if (chartInstance) {
        chartInstance.destroy();
    }

    // Pad the historical array with nulls so the predicted line starts at the end
    const paddedPredicted = new Array(historical.length - 1).fill(null);
    // Connect the last historical point to the first predicted point for a smooth line
    if (historical.length > 0) {
        paddedPredicted.push(historical[historical.length - 1]);
    }
    const finalPredictedData = [...paddedPredicted, ...predicted];

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Past 30 Days (Actual)',
                    data: historical,
                    borderColor: '#1976D2', // var(--primary)
                    backgroundColor: 'rgba(25, 118, 210, 0.1)',
                    borderWidth: 2,
                    pointRadius: 2,
                    pointBackgroundColor: '#1976D2',
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Next 7 Days (AI Prediction)',
                    data: finalPredictedData,
                    borderColor: '#F59E0B', // var(--warning)
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointRadius: 3,
                    pointBackgroundColor: '#F59E0B',
                    fill: false,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false, // CRITICAL FOR MOBILE: allows wrapper height to control canvas
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: '600' }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    titleFont: { family: "'Plus Jakarta Sans', sans-serif" },
                    bodyFont: { family: "'Plus Jakarta Sans', sans-serif" }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        font: { family: "'Plus Jakarta Sans', sans-serif" }
                    },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    ticks: {
                        maxTicksLimit: 10,
                        font: { family: "'Plus Jakarta Sans', sans-serif", size: 10 }
                    },
                    grid: { display: false }
                }
            }
        }
    });
}

// KICKSTART
initForecast();