// File: /js/pages/settings.js

import { db, auth } from '../core/firebase.js';
import { doc, setDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { dbGet, dbSave } from '../core/storage.js';
import { Navigation } from '../components/navigation.js';
import { UI } from '../utils/ui.js';
import { Security } from '../utils/security.js';

// State for Map
let mapInstance = null;
let mapMarker = null;

// --- INITIALIZATION ---
async function initSettings() {
    Navigation.inject('settings');

    bindEvents();
    loadProfileData();
    loadQR();
    initMap();
    
    // Load Multi-Branch (Strictly omitting "All Branches" for settings)
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const mobile = user.mobile || user.phone;
    
    if (mobile) {
        const storedShopsStr = localStorage.getItem(`bharatpos_shops_${mobile}`);
        if (storedShopsStr) {
            try {
                const shops = JSON.parse(storedShopsStr);
                if(shops && shops.length > 1) {
                    const switcher = document.getElementById('globalShopSwitcher');
                    if(switcher) {
                        switcher.style.display = 'inline-block';
                        // Notice: NO <option value="all"> is generated here.
                        switcher.innerHTML = shops.map(s => 
                            `<option value="${s.merchantId}" ${s.merchantId === user.merchantId ? 'selected' : ''}>
                                ${Security.escapeHtml(s.shopName)} ${s.isMain ? '⭐' : ''}
                            </option>`
                        ).join('');
                        
                        switcher.addEventListener('change', async (e) => {
                            const val = e.target.value;
                            if (val !== user.merchantId) {
                                // Trigger Shop Switch
                                try {
                                    if (typeof localforage !== 'undefined') {
                                        await localforage.removeItem('bharatpos_products');
                                        await localforage.removeItem('bharatpos_sales');
                                        await localforage.removeItem('bharatpos_customers');
                                        await localforage.removeItem('bharatpos_enterprise_sales');
                                        await localforage.removeItem('bharatpos_enterprise_products');
                                    }
                                    
                                    const targetShopInfo = shops.find(s => s.merchantId === val);
                                    if(targetShopInfo) {
                                        const newProfile = { ...user, merchantId: val, shopName: targetShopInfo.shopName, category: targetShopInfo.category };
                                        localStorage.setItem('bharatpos_user', JSON.stringify(newProfile));
                                        localStorage.setItem('shopName', targetShopInfo.shopName);
                                        window.location.reload();
                                    }
                                } catch(err) {
                                    console.error(err);
                                    window.location.reload();
                                }
                            }
                        });
                    }
                }
            } catch(e) {}
        }
    }
}

// --- EVENT BINDING ---
function bindEvents() {
    document.getElementById('btnSaveProfile')?.addEventListener('click', saveProfile);
    document.getElementById('btnReset')?.addEventListener('click', factoryReset);
    document.getElementById('btnExport')?.addEventListener('click', exportData);
    document.getElementById('fileImport')?.addEventListener('change', importData);
    document.getElementById('qrUpload')?.addEventListener('change', handleQRUpload);

    // Account Security
    document.getElementById('btnLogout')?.addEventListener('click', handleLogout);
    document.getElementById('btnDeleteAccountTrigger')?.addEventListener('click', () => {
        const confirmInput = document.getElementById('deleteConfirmInput');
        if(confirmInput) confirmInput.value = '';
        const confirmBtn = document.getElementById('btnConfirmDelete');
        if(confirmBtn) confirmBtn.disabled = true;
        UI.showModal('deleteAccountModal');
    });
    
    document.getElementById('deleteConfirmInput')?.addEventListener('input', (e) => {
        const confirmBtn = document.getElementById('btnConfirmDelete');
        if(confirmBtn) confirmBtn.disabled = e.target.value !== 'DELETE';
    });
    
    document.getElementById('btnConfirmDelete')?.addEventListener('click', handleAccountDeletion);
    document.getElementById('btnCloseDelete')?.addEventListener('click', () => UI.hideModal('deleteAccountModal'));
    
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) UI.hideModal(overlay.id);
        });
    });
}

// --- PROFILE LOGIC ---
function loadProfileData() {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    
    const sName = document.getElementById('shopName'); if(sName) sName.value = user.shopName || localStorage.getItem('shopName') || '';
    const sPhone = document.getElementById('shopPhone'); if(sPhone) sPhone.value = user.mobile || user.phone || localStorage.getItem('shopPhone') || '';
    const mId = document.getElementById('merchantId'); if(mId) mId.value = user.merchantId || '';
    const sCat = document.getElementById('shopCat'); if(sCat) sCat.value = user.category || 'GROCERY';
    const sAdd = document.getElementById('shopAddress'); if(sAdd) sAdd.value = user.address || localStorage.getItem('shopAddress') || '';
    
    const gstin = localStorage.getItem('cfg_gstin') || user.gstin || '';
    const sGst = document.getElementById('shopGstin'); if(sGst) sGst.value = gstin;
}

async function saveProfile() {
    const btn = document.getElementById('btnSaveProfile');
    if(!btn) return;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`; btn.disabled = true;

    try {
        const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
        if (!user.merchantId) throw new Error("No active merchant ID found.");

        const newName = document.getElementById('shopName').value.trim();
        const newCat = document.getElementById('shopCat').value;
        const newAddress = document.getElementById('shopAddress').value.trim();
        const newGstin = document.getElementById('shopGstin').value.trim().toUpperCase();

        user.shopName = newName;
        user.category = newCat;
        user.address = newAddress;
        user.gstin = newGstin;

        if (mapMarker) {
            const pos = mapMarker.getLatLng();
            user.lat = pos.lat;
            user.lng = pos.lng;
        }

        localStorage.setItem('bharatpos_user', JSON.stringify(user));
        localStorage.setItem('shopName', newName);
        localStorage.setItem('shopAddress', newAddress);
        localStorage.setItem('cfg_gstin', newGstin);

        // FIREBASE SYNC
        if (db) {
            const shopRef = doc(db, "shops", user.merchantId);
            const payload = {
                shopName: newName, 
                category: newCat, 
                address: newAddress, 
                gstin: newGstin,
                mobile: user.mobile || user.phone,
                isBranch: user.isBranch || false,
                parentId: user.parentId || null
            };
            if(user.lat) payload.lat = user.lat;
            if(user.lng) payload.lng = user.lng;
            
            await setDoc(shopRef, { profile: payload }, { merge: true });
        }

        // Also update local cache for branch switcher
        const mobileNum = user.mobile || user.phone;
        const cacheKey = `bharatpos_shops_${mobileNum}`;
        let cachedShops = JSON.parse(localStorage.getItem(cacheKey) || '[]');
        const shopIdx = cachedShops.findIndex(s => s.merchantId === user.merchantId);
        if(shopIdx > -1) {
            cachedShops[shopIdx].shopName = newName;
            cachedShops[shopIdx].category = newCat;
            localStorage.setItem(cacheKey, JSON.stringify(cachedShops));
        }

        UI.showToast("Profile Saved Successfully!");
    } catch (e) {
        console.error(e);
        UI.showToast("Failed to sync profile to cloud.", true);
    } finally {
        btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Save & Sync Profile`; btn.disabled = false;
    }
}

// --- MAP LOGIC ---
async function initMap() {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    let lat = 20.5937, lng = 78.9629, zoom = 5; 

    if(user.merchantId && db && (!user.lat || !user.lng)) {
        try {
            const docSnap = await getDoc(doc(db, "shops", user.merchantId));
            if(docSnap.exists() && docSnap.data().profile?.lat) {
                lat = docSnap.data().profile.lat;
                lng = docSnap.data().profile.lng;
                zoom = 15;
            }
        } catch(e){}
    } else if (user.lat && user.lng) {
        lat = user.lat; lng = user.lng; zoom = 15;
    }

    const mapEl = document.getElementById('shopMap');
    if(!mapEl) return;

    mapInstance = L.map('shopMap', { zoomControl: false }).setView([lat, lng], zoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap' }).addTo(mapInstance);
    
    if(zoom === 15) {
        mapMarker = L.marker([lat, lng]).addTo(mapInstance).bindPopup('<b>Your Shop</b>').openPopup();
    }

    mapInstance.on('click', function(e) {
        if(mapMarker) mapInstance.removeLayer(mapMarker);
        mapMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(mapInstance);
        UI.showToast("Pin dropped. Don't forget to Save Profile.");
    });

    document.getElementById('btnAcquireGPS')?.addEventListener('click', () => {
        mapInstance.locate({setView: true, maxZoom: 16});
        UI.showToast("Acquiring GPS Signal...");
    });

    mapInstance.on('locationfound', function(e) {
        if(mapMarker) mapInstance.removeLayer(mapMarker);
        mapMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(mapInstance);
        UI.showToast("GPS Location found.");
    });
    
    mapInstance.on('locationerror', function(e) {
        UI.showToast("Could not access GPS. Please ensure location is enabled.", true);
    });
}

// --- QR ---
function loadQR() {
    const qrData = localStorage.getItem('upiQR');
    if (qrData) {
        const img = document.getElementById('upiQRImg');
        if(img) {
            img.src = qrData;
            img.style.display = 'block';
        }
    }
}

function handleQRUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const base64 = e.target.result;
        localStorage.setItem('upiQR', base64);
        const img = document.getElementById('upiQRImg');
        if(img) {
            img.src = base64;
            img.style.display = 'block';
        }
        UI.showToast("UPI QR Saved!");
    };
    reader.readAsDataURL(file);
}

// --- DATA MANAGEMENT ---
async function exportData() {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    const payload = {
        meta: { merchantId: user.merchantId, exportDate: new Date().toISOString() },
        profile: user,
        products: await dbGet('bharatpos_products', '[]'),
        sales: await dbGet('bharatpos_sales', '[]'),
        customers: await dbGet('bharatpos_customers', '[]')
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = `BharatPOS_Backup_${user.merchantId || 'Offline'}_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove(); 
    URL.revokeObjectURL(url);
    UI.showToast("Data Exported!");
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!confirm("Importing data will overwrite your current local database. Proceed?")) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.products) await dbSave('bharatpos_products', data.products);
            if (data.sales) await dbSave('bharatpos_sales', data.sales);
            if (data.customers) await dbSave('bharatpos_customers', data.customers);
            
            UI.showToast("Data Imported Successfully! Reloading...");
            setTimeout(() => window.location.reload(), 1500);
        } catch(err) {
            UI.showToast("Invalid Backup File.", true);
        }
    };
    reader.readAsText(file);
}

async function factoryReset() {
    const code = prompt("DANGER: This will wipe your local offline cache. Type 'RESET' to confirm:");
    if (code === 'RESET') {
        const user = localStorage.getItem('bharatpos_user'); 
        const shops = localStorage.getItem(`bharatpos_shops_${JSON.parse(user || '{}').mobile}`);
        
        localStorage.clear();
        if(typeof localforage !== 'undefined') await localforage.clear();
        
        if(user) localStorage.setItem('bharatpos_user', user);
        if(shops) localStorage.setItem(`bharatpos_shops_${JSON.parse(user || '{}').mobile}`, shops);
        
        alert("Cache Cleared. The app will now reload and attempt to pull fresh data from the cloud.");
        window.location.href = 'dashboard.html';
    } else if (code) {
        UI.showToast("Incorrect code. Cancelled.", true);
    }
}

// --- ACCOUNT SECURITY ---
async function handleLogout() {
    if(confirm("Are you sure you want to log out? You will need your phone number to log back in.")) {
        try {
            if(auth) await signOut(auth);
        } catch(e) { console.warn("Firebase signout issue", e); }
        
        localStorage.removeItem('bharatpos_user');
        window.location.href = 'login.html'; 
    }
}

async function handleAccountDeletion() {
    const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
    if(!user.merchantId) return;

    const btn = document.getElementById('btnConfirmDelete');
    if(btn) {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Deleting Account...`;
        btn.disabled = true;
    }

    try {
        if(db) {
            await deleteDoc(doc(db, "shops", user.merchantId));
        }
        
        localStorage.clear();
        if(typeof localforage !== 'undefined') await localforage.clear();
        
        alert("Your account and shop data have been permanently deleted.");
        window.location.href = 'login.html'; 
    } catch(e) {
        console.error(e);
        UI.showToast("Failed to delete account. Please try again.", true);
        if(btn) {
            btn.innerHTML = `<i class="fa-solid fa-trash"></i> Permanently Delete My Account`;
            btn.disabled = false;
        }
    }
}

// KICKSTART
initSettings();

