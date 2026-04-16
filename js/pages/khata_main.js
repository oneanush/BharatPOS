// File: /js/pages/khata_main.js

let currentUserPhone = null;

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
    const storedPhone = localStorage.getItem('khata_user_phone');
    if (storedPhone && storedPhone.length === 10) {
        loginUser(storedPhone);
    } else {
        document.getElementById('authOverlay').style.display = 'flex';
    }
}

// Login Bypass Flow
document.getElementById('btnLoginBypass').addEventListener('click', () => {
    const phone = document.getElementById('loginPhone').value.trim();
    if (phone.length !== 10 || isNaN(phone)) {
        return alert("Please enter a valid 10-digit mobile number.");
    }
    
    // Simulate slight loading state for UX
    const btn = document.getElementById('btnLoginBypass');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Securing...`;
    
    setTimeout(() => {
        loginUser(phone);
    }, 500);
});

function loginUser(phone) {
    currentUserPhone = phone;
    localStorage.setItem('khata_user_phone', phone);
    
    // Update UI
    document.getElementById('authOverlay').style.display = 'none';
    document.getElementById('bottomNav').style.display = 'flex';
    document.getElementById('btnProfile').style.display = 'flex';
    document.getElementById('userNameDisplay').innerText = phone;
    
    // Load default tab (Bills)
    loadTabModule('bills');
}

// Logout Flow
document.getElementById('btnProfile').addEventListener('click', () => {
    if(confirm("Log out of Mera Khata?")) {
        localStorage.removeItem('khata_user_phone');
        location.reload();
    }
});

// Dynamic Tab Routing
function bindNavEvents() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');
            const moduleName = targetId.split('-')[1]; // extracts 'bills', 'store', or 'khoj'
            
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
        // We delay Leaflet map initialization slightly to ensure the tab's DOM is visible
        setTimeout(() => {
            import('./khata_khoj.js').then(module => {
                module.initKhoj();
                loadedModules.khoj = true;
            });
        }, 100);
    }
}