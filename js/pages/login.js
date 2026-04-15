// File: /js/pages/login.js

import { db } from '../core/firebase.js';
import { collection, doc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { dbSave } from '../core/storage.js';
import { Security } from '../utils/security.js';

document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
});

function bindEvents() {
    const btnModeRegistered = document.getElementById('btnModeRegistered');
    const btnModeNew = document.getElementById('btnModeNew');

    btnModeRegistered?.addEventListener('click', () => setMode('registered'));
    btnModeNew?.addEventListener('click', () => setMode('new'));

    document.getElementById('regSendOtpBtn')?.addEventListener('click', handleExistingLogin);
    document.getElementById('newSendOtpBtn')?.addEventListener('click', handleNewRegistration);
    
    document.getElementById('btnEnterDashboard')?.addEventListener('click', () => {
        window.location.href = 'dashboard.html';
    });

    document.getElementById('btnCancelShopSelect')?.addEventListener('click', () => {
        document.getElementById('shopSelectModal').style.display = 'none';
    });

    // Secure Event Delegation for dynamic shop selection buttons
    document.getElementById('shopSelectList')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.shop-select-btn');
        if (btn) {
            const shopStr = btn.getAttribute('data-shop');
            const mobile = btn.getAttribute('data-mobile');
            triggerRestoreSequenceObj(shopStr, mobile);
        }
    });
}

function setMode(mode) {
    const btnModeRegistered = document.getElementById('btnModeRegistered');
    const btnModeNew = document.getElementById('btnModeNew');
    const registeredPane = document.getElementById('registeredPane');
    const newPaneForm = document.getElementById('newPane');

    if (mode === 'registered') {
        btnModeRegistered?.classList.add('active');
        btnModeNew?.classList.remove('active');
        if(registeredPane) registeredPane.style.display = 'block';
        if(newPaneForm) newPaneForm.style.display = 'none';
    } else {
        btnModeNew?.classList.add('active');
        btnModeRegistered?.classList.remove('active');
        if(registeredPane) registeredPane.style.display = 'none';
        if(newPaneForm) newPaneForm.style.display = 'block';
    }
}

async function handleExistingLogin(e) {
    const btn = e.currentTarget; 
    const status = document.getElementById('regStatus');
    const mobile = (document.getElementById('reg_mobile').value || '').trim();
    
    if (!mobile || mobile.length !== 10) { 
        status.innerText = 'Enter valid 10-digit mobile'; 
        return; 
    }
    
    btn.classList.add('loading'); 
    status.innerText = 'Searching database...';

    try {
        const shopsRef = collection(db, "shops");
        const querySnapshot = await getDocs(shopsRef);

        if (querySnapshot.size === 0) {
            status.innerText = 'Firebase is empty. Click "New Merchant" to register.';
            btn.classList.remove('loading');
            return;
        }

        const shops = [];
        const inputMobile = String(mobile).replace("+91", "").trim();

        querySnapshot.forEach((doc) => { 
            const data = doc.data();
            const dbMobile = String(data.mobile || data.profile?.mobile || data.profile?.phone || "").replace("+91", "").trim();
            
            if (dbMobile === inputMobile) {
                if(!data.merchantId) data.merchantId = doc.id;
                if(!data.profile) data.profile = { shopName: "My Shop", mobile: dbMobile };
                shops.push(data); 
            }
        });

        if (shops.length > 0) {
            if (shops.length === 1) {
                triggerRestoreSequenceObj(encodeURIComponent(JSON.stringify(shops[0])), mobile);
            } else {
                const listHtml = shops.map(shop => `
                    <button type="button" class="shop-select-btn" data-shop="${encodeURIComponent(JSON.stringify(shop))}" data-mobile="${Security.escapeHtml(mobile)}">
                        <div>
                            <strong style="font-size:16px; color: var(--primary);">${Security.escapeHtml(shop.profile?.shopName || shop.merchantId)}</strong>
                            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">ID: ${Security.escapeHtml(shop.merchantId)}</div>
                        </div>
                        <i class="fa-solid fa-chevron-right" style="color: var(--text-muted);"></i>
                    </button>
                `).join('');
                
                const selectList = document.getElementById('shopSelectList');
                const selectModal = document.getElementById('shopSelectModal');
                if(selectList && selectModal) {
                    selectList.innerHTML = listHtml;
                    selectModal.style.display = 'flex';
                }
            }
        } else {
            status.innerText = 'Looked at all shops, but no phone number matched. Register new.';
        }
    } catch(err) { 
        console.error("🚨 FIREBASE ERROR:", err);
        status.innerText = 'Firebase Error! Check console (F12).';
    } finally {
        btn.classList.remove('loading');
    }
}

async function handleNewRegistration(e) {
    const btn = e.currentTarget; 
    const formData = {
      ownerName: (document.getElementById('ownerName').value || '').trim(),
      mobile: (document.getElementById('mobile').value || '').trim(),
      shopName: (document.getElementById('shopName').value || '').trim(),
      category: (document.getElementById('shopCategory').value || '').trim()
    };
    
    if (!formData.shopName || !formData.mobile || formData.mobile.length !== 10) { 
        alert('Please fill out all required fields correctly (10 digit mobile).'); 
        return; 
    }

    btn.classList.add('loading');

    try {
        const codePrefix = (formData.category || 'SHP').substring(0, 3).toUpperCase();
        const codeSuffix = (formData.mobile || '0000000000').substring(6, 10);
        const merchantId = `${codePrefix}-${codeSuffix}`;
        
        const shopRef = doc(db, "shops", merchantId);
        await setDoc(shopRef, {
            merchantId: merchantId,
            profile: { ...formData, joinedDate: new Date().toISOString() }
        });

        const userObj = { ...formData, merchantId: merchantId };
        localStorage.setItem('bharatpos_user', JSON.stringify(userObj));
        
        const mShopName = document.getElementById('modalShopName');
        const mGenCode = document.getElementById('generatedCode');
        const idModal = document.getElementById('idModal');

        if(mShopName) mShopName.innerText = formData.shopName;
        if(mGenCode) mGenCode.innerText = merchantId;
        if(idModal) idModal.style.display = 'flex';

    } catch(err) { 
        alert('Registration Failed. Check console.');
        console.error(err);
    } finally {
        btn.classList.remove('loading');
    }
}

function triggerRestoreSequenceObj(shopString, mobile) {
    const shop = JSON.parse(decodeURIComponent(shopString));
    const selectModal = document.getElementById('shopSelectModal');
    if(selectModal) selectModal.style.display = 'none';
    triggerRestoreSequence(shop, mobile);
}

async function triggerRestoreSequence(shopDoc, mobile) {
    // Wipe old session completely via Async storage to be safe
    if (typeof localforage !== 'undefined') {
        await localforage.removeItem('bharatpos_products');
        await localforage.removeItem('bharatpos_sales');
        await localforage.removeItem('bharatpos_customers');
        await localforage.removeItem('bill_items');
    }
    localStorage.removeItem('bharatpos_products');
    localStorage.removeItem('bharatpos_sales');
    localStorage.removeItem('bharatpos_customers');
    
    // Set Identity
    const user = { ...shopDoc.profile, merchantId: shopDoc.merchantId, mobile: mobile };
    localStorage.setItem('bharatpos_user', JSON.stringify(user));

    try {
        // Sync vital core data immediately for offline fallback
        const prodRef = collection(db, "shops", shopDoc.merchantId, "products");
        const prodSnap = await getDocs(prodRef);
        const products = prodSnap.docs.map(d => d.data());
        await dbSave('bharatpos_products', products);

        const custRef = collection(db, "shops", shopDoc.merchantId, "customers");
        const custSnap = await getDocs(custRef);
        const customers = custSnap.docs.map(d => d.data());
        await dbSave('bharatpos_customers', customers);

        const salesRef = collection(db, "shops", shopDoc.merchantId, "sales");
        const salesSnap = await getDocs(salesRef);
        const sales = salesSnap.docs.map(d => d.data());
        await dbSave('bharatpos_sales', sales);

    } catch(e) {
        console.warn("Could not cache offline data on login. Proceeding to dashboard.", e);
    }

    const mShopName = document.getElementById('modalShopName');
    const mGenCode = document.getElementById('generatedCode');
    const idModal = document.getElementById('idModal');

    if(mShopName) mShopName.innerText = user.shopName || 'Shop Restored';
    if(mGenCode) mGenCode.innerText = shopDoc.merchantId;
    if(idModal) idModal.style.display = 'flex';
}