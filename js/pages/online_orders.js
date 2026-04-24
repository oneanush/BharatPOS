// File: /js/pages/online_orders.js

import { db } from '../core/firebase.js';
import { collection, onSnapshot, query, where, doc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { dbGet, dbSave } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';

let liveOrders = [];
let activeOrder = null;
let mapInstance = null;
let mapMarker = null;

async function initOnlineOrders() {
    Navigation.inject('orders'); // Assuming you add an 'orders' icon to your sidebar
    
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if (!user.merchantId) {
        document.getElementById('ordersList').innerHTML = `<div style="padding:20px; text-align:center;">Please login first.</div>`;
        return;
    }

    listenToFirebaseOrders(user.merchantId);
    bindEvents();
}

function listenToFirebaseOrders(merchantId) {
    const ordersRef = collection(db, "shops", merchantId, "onlineOrders");
    const q = query(ordersRef, where("status", "==", "PENDING"));

    onSnapshot(q, (snapshot) => {
        liveOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Sort newest first
        liveOrders.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        document.getElementById('orderCount').innerText = liveOrders.length;
        renderOrdersList();
    });
}

function renderOrdersList() {
    const listEl = document.getElementById('ordersList');
    
    if (liveOrders.length === 0) {
        listEl.innerHTML = `<div style="padding: 40px 20px; text-align: center; color: var(--text-muted); font-weight: 600;"><i class="fa-solid fa-box-open fa-2x" style="margin-bottom:10px; opacity:0.5;"></i><br>No pending requests.</div>`;
        if(!activeOrder) clearDetails();
        return;
    }

    listEl.innerHTML = liveOrders.map(o => {
        const time = new Date(o.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        return `
        <div class="order-card ${activeOrder?.id === o.id ? 'active' : ''}" data-id="${o.id}">
            <div class="oc-type">${o.orderType || 'Online Order'}</div>
            <div class="oc-phone"><i class="fa-solid fa-phone"></i> ${o.customerMobile}</div>
            <div class="oc-meta">Total: ₹${o.totalAmount} • ${time}</div>
        </div>`;
    }).join('');
}

function bindEvents() {
    document.getElementById('ordersList').addEventListener('click', (e) => {
        const card = e.target.closest('.order-card');
        if (card) selectOrder(card.getAttribute('data-id'));
    });

    document.getElementById('extraCharge').addEventListener('input', updateGrandTotal);
    
    document.getElementById('btnReject').addEventListener('click', rejectOrder);
    document.getElementById('btnGenerateBill').addEventListener('click', generateBill);
}

function selectOrder(id) {
    activeOrder = liveOrders.find(o => o.id === id);
    if (!activeOrder) return;

    renderOrdersList(); // Update active highlight

    document.getElementById('detailHeader').innerText = `Order #${id.slice(-6).toUpperCase()}`;
    document.getElementById('detailBody').style.display = 'block';
    document.getElementById('billingSection').style.display = 'block';

    document.getElementById('detPhone').innerText = activeOrder.customerMobile;
    document.getElementById('detType').innerText = activeOrder.orderType || 'Standard Cart';

    // Render Items
    const itemsHtml = (activeOrder.items || []).map(i => `
        <div class="cart-item">
            <span>${i.qty}x ${i.name}</span>
            <span style="color:var(--success);">₹${i.price * i.qty}</span>
        </div>
    `).join('');
    document.getElementById('detItems').innerHTML = itemsHtml || '<div style="font-size:12px; color:#888;">No items attached</div>';

    // Reset extra charges
    document.getElementById('extraCharge').value = 0;
    updateGrandTotal();

    // Render Map
    setTimeout(() => renderMap(activeOrder.location), 100);
}

function clearDetails() {
    document.getElementById('detailHeader').innerText = 'Select an order to view details';
    document.getElementById('detailBody').style.display = 'none';
    document.getElementById('billingSection').style.display = 'none';
}

function renderMap(location) {
    if (!location || !location.lat || !location.lng) {
        document.getElementById('customerMap').style.display = 'none';
        return;
    }
    
    document.getElementById('customerMap').style.display = 'block';

    if (!mapInstance) {
        mapInstance = L.map('customerMap').setView([location.lat, location.lng], 15);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(mapInstance);
    } else {
        mapInstance.setView([location.lat, location.lng], 15);
    }

    if (mapMarker) mapInstance.removeLayer(mapMarker);
    mapMarker = L.marker([location.lat, location.lng]).addTo(mapInstance);
    mapMarker.bindPopup("<b>Customer Location</b>").openPopup();
    
    mapInstance.invalidateSize();
}

function updateGrandTotal() {
    if (!activeOrder) return;
    const baseTotal = Number(activeOrder.totalAmount || 0);
    const extra = Number(document.getElementById('extraCharge').value || 0);
    document.getElementById('grandTotalDisplay').innerText = `₹${baseTotal + extra}`;
}

// --- CORE BILLING INTEGRATION ---
async function generateBill() {
    if (!activeOrder) return;
    
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const merchantId = user.merchantId;
    
    const extra = Number(document.getElementById('extraCharge').value || 0);
    const baseTotal = Number(activeOrder.totalAmount || 0);
    const finalTotal = baseTotal + extra;

    // 1. Build the Sale Object (Matches standard billing format perfectly)
    const saleItems = [...(activeOrder.items || [])];
    
    // If there is an extra charge, add it as a line item!
    if (extra > 0) {
        saleItems.push({
            id: 'extra_charge',
            name: activeOrder.orderType === 'Service Request' ? 'Service Charge' : 'Delivery Charge',
            price: extra,
            qty: 1,
            total: extra
        });
    }

    const saleRecord = {
        id: `inv_${Date.now()}`,
        date: new Date().toISOString(),
        customer: activeOrder.customerName || 'Online Khata User',
        customerPhone: activeOrder.customerMobile,
        paymentMode: "Udhaar", // Starts as pending Khata credit by default
        isPaid: false,
        total: finalTotal,
        items: saleItems,
        orderRef: activeOrder.id,
        _branchId: merchantId,
        _branchName: user.shopName || "Main Shop"
    };

    try {
        const btn = document.getElementById('btnGenerateBill');
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`; btn.disabled = true;

        // 2. Save locally to LocalForage (Updates Sales Ledger & Reports instantly)
        let localSales = await dbGet('bharatpos_sales', '[]');
        localSales.push(saleRecord);
        await dbSave('bharatpos_sales', localSales);

        let eSales = await dbGet('bharatpos_enterprise_sales', '[]');
        eSales.unshift(saleRecord);
        await dbSave('bharatpos_enterprise_sales', eSales);

        // 3. Save Sale to Firebase
        await setDoc(doc(db, "shops", merchantId, "sales", saleRecord.id), saleRecord);

        // 4. Update Order Status to Completed
        await updateDoc(doc(db, "shops", merchantId, "onlineOrders", activeOrder.id), { status: "COMPLETED" });

        UI.showToast("Bill Generated! Added to Sales Ledger.");
        activeOrder = null;
        clearDetails();

    } catch (e) {
        console.error(e);
        UI.showToast("Failed to generate bill", true);
    } finally {
        const btn = document.getElementById('btnGenerateBill');
        if(btn) { btn.innerHTML = `<i class="fa-solid fa-file-invoice"></i> Generate Bill`; btn.disabled = false; }
    }
}

async function rejectOrder() {
    if (!activeOrder || !confirm("Are you sure you want to reject this request?")) return;

    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    try {
        await updateDoc(doc(db, "shops", user.merchantId, "onlineOrders", activeOrder.id), { status: "REJECTED" });
        UI.showToast("Order Rejected");
        activeOrder = null;
        clearDetails();
    } catch(e) {
        UI.showToast("Error rejecting order", true);
    }
}

// Kickstart
initOnlineOrders();