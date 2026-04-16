// File: /js/pages/khata_main.js

import { auth } from '../core/firebase.js';
import { RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let currentUserPhone = null;
let confirmationResultObj = null;

// Track loaded modules to prevent duplicate fetching
const loadedModules = {
    bills: false,
    store: false,
    khoj: false
};

document.addEventListener('DOMContentLoaded', () => {
    checkAuthState();
    bindNavEvents();
});

function checkAuthState() {
    onAuthStateChanged(auth, (user) => {
        if (user && user.phoneNumber) {
            currentUserPhone = user.phoneNumber.replace('+91', '');
            document.getElementById('authOverlay').style.display = 'none';
            document.getElementById('bottomNav').style.display = 'flex';
            document.getElementById('btnProfile').style.display = 'flex';
            document.getElementById('userNameDisplay').innerText = currentUserPhone;
            
            // Load default tab (Bills)
            loadTabModule('bills');
        } else {
            document.getElementById('authOverlay').style.display = 'flex';
            initRecaptcha();
        }
    });
}

function initRecaptcha() {
    if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'btnSendOtp', { 'size': 'invisible' });
    }
}

// Authentication Flow
document.getElementById('btnSendOtp').addEventListener('click', async () => {
    const phone = document.getElementById('loginPhone').value.trim();
    if (phone.length !== 10) return alert("Enter valid 10 digit number");
    
    const btn = document.getElementById('btnSendOtp');
    btn.innerText = "Sending..."; btn.disabled = true;

    try {
        const appVerifier = window.recaptchaVerifier;
        confirmationResultObj = await signInWithPhoneNumber(auth, `+91${phone}`, appVerifier);
        document.getElementById('phoneStep').style.display = 'none';
        document.getElementById('otpStep').style.display = 'block';
    } catch (e) {
        console.error(e);
        alert("Failed to send OTP. Try again.");
    } finally {
        btn.innerText = "Send OTP"; btn.disabled = false;
    }
});

document.getElementById('btnVerifyOtp').addEventListener('click', async () => {
    const otp = document.getElementById('loginOtp').value.trim();
    if (otp.length !== 6) return alert("Enter 6 digit OTP");
    
    const btn = document.getElementById('btnVerifyOtp');
    btn.innerText = "Verifying..."; btn.disabled = true;

    try {
        await confirmationResultObj.confirm(otp);
        // onAuthStateChanged will handle the rest
    } catch (e) {
        alert("Invalid OTP");
        btn.innerText = "Verify & Proceed"; btn.disabled = false;
    }
});

document.getElementById('btnCancelOtp').addEventListener('click', () => {
    document.getElementById('otpStep').style.display = 'none';
    document.getElementById('phoneStep').style.display = 'block';
});

document.getElementById('btnProfile').addEventListener('click', () => {
    if(confirm("Log out of Mera Khata?")) {
        auth.signOut();
        location.reload();
    }
});

// Dynamic Tab Routing
function bindNavEvents() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');
            const moduleName = targetId.split('-')[1]; // bills, store, khoj
            
            // UI Switch
            navItems.forEach(nav => nav.classList.remove('active'));
            e.currentTarget.classList.add('active');
            
            document.querySelectorAll('.tab-view').forEach(tab => tab.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');

            // Lazy Load Module
            loadTabModule(moduleName);
        });
    });
}

function loadTabModule(moduleName) {
    if (!currentUserPhone) return;

    if (moduleName === 'bills' && !loadedModules.bills) {
        import('./khata_bills.js').then(module => {
            module.initBills(currentUserPhone);
            loadedModules.bills = true;
        });
    } 
    else if (moduleName === 'store' && !loadedModules.store) {
        import('./khata_store.js').then(module => {
            module.initStore(currentUserPhone);
            loadedModules.store = true;
        });
    }
    else if (moduleName === 'khoj' && !loadedModules.khoj) {
        // We delay Leaflet map initialization slightly to ensure the tab is visible
        setTimeout(() => {
            import('./khata_khoj.js').then(module => {
                module.initKhoj();
                loadedModules.khoj = true;
            });
        }, 100);
    }
}