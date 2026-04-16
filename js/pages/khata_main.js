// File: /js/pages/khata_main.js

import { db } from '../core/firebase.js';
import { collectionGroup, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { Security } from '../utils/security.js';

let currentUserPhone = null;

// Global Memory Cache
window.KhataData = {
    sales: [],
    shopsMap: {}, // { shopId: { shopName, lat, lng } }
    activeShopId: null
};

const loadedModules = { bills: false, store: false, khoj: false };

document.addEventListener('DOMContentLoaded', () => {
    checkAuthState();
    bindNavEvents();
});

function checkAuthState() {
    const storedPhone = localStorage.getItem('khata_user_phone');
    if (storedPhone && storedPhone.length === 10) {
        loginUser(storedPhone);
    } else {
        document.getElementById('authOverlay').style.display = 'flex';
    }
}

// Auth Bypass
document.getElementById('btnLoginBypass').addEventListener('click', () => {
    const phone = document.getElementById('loginPhone').value.trim();
    if (phone.length !== 10 || isNaN(phone)) return alert("Please enter a valid 10-digit mobile number.");
    
    const btn = document.getElementById('btnLoginBypass');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Securing...`;
    setTimeout(() => { loginUser(phone); }, 500);
});

async function loginUser(phone) {
    currentUserPhone = phone;
    localStorage.setItem('khata_user_phone', phone);
    
    document.getElementById('authOverlay').style.display = 'none';
    const globalLoader = document.getElementById('globalLoader');
    globalLoader.style.display = 'flex';

    try {
        // Fetch ALL Sales for this user ONCE.
        const salesQuery = query(collectionGroup(db, 'sales'), where('customerPhone', '==', phone));
        const snapshot = await getDocs(salesQuery);
        
        const sales = [];
        const shopsMap = {};

        snapshot.forEach(doc => {
            const s = doc.data();
            const shopId = s._branchId || s.merchantId || doc.ref.parent.parent.id;
            const shopName = s._branchName || 'Local Shop';
            
            sales.push(s);
            if (!shopsMap[shopId]) shopsMap[shopId] = { id: shopId, name: shopName };
        });

        // Store globally
        window.KhataData.sales = sales;
        window.KhataData.shopsMap = shopsMap;

        // Populate Top Selector
        populateTopSelector(shopsMap);

        document.getElementById('bottomNav').style.display = 'flex';
        document.getElementById('btnProfile').style.display = 'flex';
        
        // Load initial tab
        loadTabModule('bills');

    } catch (err) {
        console.error(err);
        alert("Failed to sync data. Please check your internet connection.");
    } finally {
        globalLoader.style.display = 'none';
    }
}

function populateTopSelector(shopsMap) {
    const wrapper = document.getElementById('globalShopWrapper');
    const select = document.getElementById('globalShopSelect');
    
    const shopIds = Object.keys(shopsMap);
    
    if (shopIds.length === 0) {
        wrapper.style.display = 'none';
        return;
    }

    // Default to 'ALL' for bills, but the module handles behavior
    let html = `<option value="ALL">All My Shops</option>`;
    shopIds.forEach(id => {
        html += `<option value="${Security.escapeHtml(id)}">${Security.escapeHtml(shopsMap[id].name)}</option>`;
    });

    select.innerHTML = html;
    window.KhataData.activeShopId = 'ALL';
    wrapper.style.display = 'block';

    select.addEventListener('change', (e) => {
        window.KhataData.activeShopId = e.target.value;
        // Broadcast change
        if (window.onShopChanged) window.onShopChanged(e.target.value);
    });
}

document.getElementById('btnProfile').addEventListener('click', () => {
    if(confirm("Log out of Mera Khata?")) {
        localStorage.removeItem('khata_user_phone');
        location.reload();
    }
});

function bindNavEvents() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');
            const moduleName = targetId.split('-')[1]; 
            
            navItems.forEach(nav => nav.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            document.querySelectorAll('.tab-view').forEach(tab => tab.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');

            // Manage Top Selector Visibility
            const wrapper = document.getElementById('globalShopWrapper');
            if(moduleName === 'khoj') wrapper.style.display = 'none';
            else if(Object.keys(window.KhataData.shopsMap).length > 0) wrapper.style.display = 'block';

            loadTabModule(moduleName);
        });
    });
}

function loadTabModule(moduleName) {
    if (moduleName === 'bills' && !loadedModules.bills) {
        import('./khata_bills.js').then(module => { module.initBills(); loadedModules.bills = true; });
    } 
    else if (moduleName === 'store' && !loadedModules.store) {
        import('./khata_store.js').then(module => { module.initStore(currentUserPhone); loadedModules.store = true; });
    }
    else if (moduleName === 'khoj' && !loadedModules.khoj) {
        setTimeout(() => {
            import('./khata_khoj.js').then(module => { module.initKhoj(); loadedModules.khoj = true; });
        }, 100);
    }
    
    // If module already loaded, force a refresh based on active shop
    if (loadedModules[moduleName] && window.onShopChanged) {
        window.onShopChanged(window.KhataData.activeShopId);
    }
}