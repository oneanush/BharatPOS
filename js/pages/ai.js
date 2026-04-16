// File: /js/pages/ai.js

import { dbGet } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';
import { Security } from '../utils/security.js';

// --- INITIALIZATION ---
async function initAI() {
    Navigation.inject('ai');
    bindEvents();
    checkSnapshotStatus();
}

// --- EVENT BINDING ---
function bindEvents() {
    document.getElementById('btnSyncSnapshot')?.addEventListener('click', sendSnapshotToAI);

    document.querySelectorAll('[data-action="ask-ai"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const promptType = e.currentTarget.getAttribute('data-type');
            askAI(promptType);
        });
    });
}

// --- SNAPSHOT ENGINE ---
// Creates a fresh hash to determine if data has changed
function hashStringDjb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) { 
        hash = ((hash << 5) + hash) + str.charCodeAt(i); 
        hash = hash & 0xFFFFFFFF; 
    }
    return (hash >>> 0).toString(16);
}

function checkSnapshotStatus() {
    const lastHash = localStorage.getItem('bharatpos_last_sent_reports_snapshot_hash');
    const badge = document.getElementById('snapshotStatusBadge');
    const dot = document.getElementById('snapshotDot');
    const text = document.getElementById('snapshotText');

    if (!badge || !dot || !text) return;

    if (!lastHash) {
        dot.className = 'status-dot';
        text.innerText = "No data uploaded yet";
    } else {
        const auditStr = localStorage.getItem('bharatpos_audit');
        if(auditStr && auditStr.includes('Snapshot Generated')) {
            dot.className = 'status-dot fresh';
            text.innerText = "Data is fresh & synced";
        } else {
            dot.className = 'status-dot';
            text.innerText = "Data might be outdated";
        }
    }
}

// Generates an AI-readable context object directly from IndexedDB
async function generateLocalSnapshot() {
    const sales = await dbGet('bharatpos_enterprise_sales', 'null') || await dbGet('bharatpos_sales', '[]');
    const products = await dbGet('bharatpos_enterprise_products', 'null') || await dbGet('bharatpos_products', '[]');
    
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);

    let recentGross = 0;
    let recentNet = 0;
    let recentUdhaar = 0;
    let totalBills = 0;
    let productSalesMap = {};

    // Process Sales (Last 7 Days)
    sales.forEach(s => {
        const d = new Date(s.date);
        if(d >= sevenDaysAgo && d <= today) {
            totalBills++;
            const total = Number(s.total || s.amount || 0);
            recentGross += total;
            
            const pMode = s.paymentMethod || s.paymentMode || 'Cash';
            if (pMode === 'Partial' && s.split) {
                recentNet += Number(s.split.cash || 0) + Number(s.split.online || 0);
                if(!s.isPaid) recentUdhaar += Number(s.split.udhaar || 0);
            } else if (pMode === 'Udhaar') {
                if(!s.isPaid) recentUdhaar += total;
            } else {
                recentNet += total;
            }

            (s.items || []).forEach(item => {
                const name = `${item.name} ${item.variant ? `(${item.variant})` : ''}`;
                productSalesMap[name] = (productSalesMap[name] || 0) + Number(item.qty || 1);
            });
        }
    });

    const topProducts = Object.entries(productSalesMap)
        .sort((a,b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, qty]) => ({ name, qty }));

    // Process Inventory (Find dead stock & low stock)
    let lowStockAlerts = [];
    let deadStockPotentials = [];

    products.forEach(p => {
        const threshold = Number(p.reorderPoint || 5);
        (p.variants || []).forEach(v => {
            let stock = Number(v.stock || 0);
            if(p.isLoose) stock = stock * (Number(v.baseQty) || 1);
            
            const fullName = `${p.name} (${v.quantity})`;
            if (stock <= threshold) {
                lowStockAlerts.push({ name: fullName, current_stock: stock, threshold: threshold });
            } else if (stock > threshold * 5 && !(fullName in productSalesMap)) {
                // If we have 5x the threshold but haven't sold any in 7 days
                deadStockPotentials.push({ name: fullName, current_stock: stock });
            }
        });
    });

    return {
        type: "ai_business_snapshot",
        generated_at: new Date().toISOString(),
        timeframe: "Last 7 Days",
        metrics: {
            gross_revenue: recentGross,
            net_collected: recentNet,
            pending_udhaar: recentUdhaar,
            total_invoices: totalBills
        },
        top_selling_products: topProducts,
        inventory_alerts: {
            low_stock: lowStockAlerts.slice(0, 10),
            potential_dead_stock: deadStockPotentials.slice(0, 10)
        }
    };
}

async function sendSnapshotToAI() {
    const btn = document.getElementById('btnSyncSnapshot');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Uploading...`;
    btn.disabled = true;

    try {
        const snapshot = await generateLocalSnapshot();
        const contentToHash = JSON.stringify(snapshot);
        const snapshotHash = hashStringDjb2(contentToHash);
        
        localStorage.setItem('bharatpos_last_snapshot_data', JSON.stringify(snapshot));
        localStorage.setItem('bharatpos_last_sent_reports_snapshot_hash', snapshotHash);

        // Audit Logging
        let logs = JSON.parse(localStorage.getItem('bharatpos_audit') || '[]');
        logs.unshift({ time: new Date().toISOString(), action: "Snapshot Generated", details: "Manual sync to AI engine.", user: "Admin" });
        if(logs.length > 20) logs = logs.slice(0, 20); 
        localStorage.setItem('bharatpos_audit', JSON.stringify(logs));

        checkSnapshotStatus();
        UI.showToast("✅ Data Snapshot uploaded to AI successfully!");
    } catch (e) {
        console.error(e);
        UI.showToast("Failed to generate snapshot.", true);
    } finally {
        btn.innerHTML = origHtml;
        btn.disabled = false;
    }
}

// --- AI API COMMUNICATION ---
async function askAI(promptType) {
    const out = document.getElementById('aiOutput');
    if(!out) return;

    out.innerHTML = `
        <div class="ai-loading">
            <i class="fa-solid fa-brain"></i>
            <h3>Cortex AI is analyzing your data...</h3>
            <p>This may take 5-10 seconds depending on data volume.</p>
        </div>`;
    
    // Smooth scrolling to output area
    out.scrollIntoView({ behavior: 'smooth', block: 'center' });

    try {
        let snapshotStr = localStorage.getItem('bharatpos_last_snapshot_data');
        if (!snapshotStr) {
            UI.showToast("Generating fresh snapshot...");
            const freshSnapshot = await generateLocalSnapshot();
            snapshotStr = JSON.stringify(freshSnapshot);
            localStorage.setItem('bharatpos_last_snapshot_data', snapshotStr);
        }

        const snapshot = JSON.parse(snapshotStr);
        let prompt = "Analyze my business.";

        if(promptType === 'general') prompt = "Give me a general health check of my retail business based on the last 7 days of sales. Are my revenues healthy compared to my pending Udhaar?";
        else if(promptType === 'inventory') prompt = "Look at my low_stock and potential_dead_stock arrays. Which items should I reorder immediately, and what should I do with the dead stock to clear space?";
        else if(promptType === 'sales') prompt = "Based on my top_selling_products, suggest 2 specific bundle offers or discount strategies to increase my average ticket size.";
        else if(promptType === 'customer') prompt = "Look at my pending_udhaar. Suggest a polite but firm strategy to recover these funds without losing the customers. Provide a sample WhatsApp message I can send them.";

        const url = 'https://server-xy7s.onrender.com/ai-business-consult';
        
        // Timeout wrapper since Free-tier Render servers spin down and take 30s to wake up
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 40000); // 40s timeout

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                snapshot: snapshot, 
                user_prompt: prompt 
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Server Error: ${response.status}`);

        const result = await response.json();
        const advice = result.advice || result.reply || result.message;

        if (advice) {
            // Formatting bold text (**text**) and newlines
            let formattedText = String(advice)
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');
                
            out.innerHTML = `
                <div class="ai-suggestion-card">
                    <div class="ai-badge"><i class="fa-solid fa-bolt"></i> CORTEX ANALYTICS</div>
                    <div class="ai-text">${formattedText}</div>
                </div>`;
        } else {
            throw new Error("AI returned an empty response.");
        }

    } catch (err) {
        console.error("AI Error:", err);
        
        if (err.name === 'AbortError') {
            out.innerHTML = `
                <div class="ai-error-card">
                    <h3>⚡ Server Waking Up</h3>
                    <p>The AI cloud server was asleep. It is booting up now. Please <strong>click the prompt again in 10 seconds.</strong></p>
                </div>`;
        } else {
            out.innerHTML = `
                <div class="ai-error-card">
                    <h3>⚡ Connection Stalled</h3>
                    <p>The AI server is likely waking up from sleep or encountered an error. Please wait 10 seconds and <strong>try again.</strong></p>
                    <div style="font-size:11px; opacity:0.6; margin-top:8px;">${Security.escapeHtml(err.message)}</div>
                </div>`;
        }
    }
}

// KICKSTART
initAI();