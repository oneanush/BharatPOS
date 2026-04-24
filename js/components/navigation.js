import { I18n } from '../utils/i18n.js';

export class Navigation {
    static inject(activePageCode) {
        const getActive = (code) => activePageCode === code ? 'active-link' : '';
        
        const sidebarHtml = `
          <div id="menuOverlay" class="menu-overlay"></div>
          <div id="sideMenu" class="side-menu">
            <div class="side-menu-brand">
              <div class="side-menu-brand-text">Bharat<span>POS</span></div>
              <button id="btnCloseMenuMain" class="btn-close" style="font-size:22px; line-height:1;">&times;</button>
            </div>
            <div class="side-menu-links">
              <a href="dashboard.html" class="${getActive('dashboard')}"><i class="fa-solid fa-house"></i> <span data-i18n="nav_dashboard">Dashboard</span></a>
              <a href="billing.html" class="${getActive('billing')}"><i class="fa-solid fa-file-invoice"></i> <span data-i18n="nav_billing">Billing</span></a>
              <a href="products.html" class="${getActive('products')}"><i class="fa-solid fa-box-open"></i> <span data-i18n="nav_inventory">Inventory</span></a>
              <a href="sales.html" class="${getActive('sales')}"><i class="fa-solid fa-chart-line"></i> <span data-i18n="nav_sales">Sales Ledger</span></a>
              <a href="my_dukkan.html" class="${getActive('finance')}"><i class="fa-solid fa-wallet"></i> <span data-i18n="nav_finance">Finance HQ</span></a>
              <a href="reports.html" class="${getActive('reports')}"><i class="fa-solid fa-users"></i> <span data-i18n="nav_reports">Reports</span></a>
              <a href="customers.html" class="${getActive('crm')}"><i class="fa-solid fa-users"></i> <span data-i18n="nav_crm">Bharat CRM</span></a>
              <a href="ai.html" class="${getActive('ai')}"><i class="fa-solid fa-brain"></i> <span data-i18n="nav_ai"> AI-Madad</span></a>
              <a href="settings.html" class="${getActive('settings')}"><i class="fa-solid fa-gear"></i> <span data-i18n="nav_settings">Settings</span></a>
            </div>
          </div>
        `;

        let iconClass = 'fa-cash-register';
        let pageTitle = 'Dashboard';
        if(activePageCode === 'billing') { iconClass = 'fa-file-invoice'; pageTitle = 'Point of Sale'; }
        if(activePageCode === 'products') { iconClass = 'fa-boxes-stacked'; pageTitle = 'Inventory'; }
        
        const navbarHtml = `
          <nav class="navbar">
            <div class="brand">
              <button id="btnOpenMenuMain" class="menu-btn"><i class="fa-solid fa-bars"></i></button>
              <div class="brand-logo-wrap"><i class="fa-solid ${iconClass}"></i></div>
              <div class="nav-breadcrumb">
                <span>BharatPOS</span> <span style="color:var(--border-hover);">/</span> 
                <strong><span data-i18n="nav_${activePageCode}">${pageTitle}</span></strong>
              </div>
            </div>
            <div class="nav-actions" id="mainNavActions">
              <select id="globalShopSwitcher" class="shop-switcher" style="display:none;"></select>
              <button id="globalLangToggle" class="btn btn-outline btn-icon-only" style="font-weight:800; padding:6px 10px; border-radius:8px;">A/अ</button>
              ${activePageCode !== 'billing' ? `
              <button onclick="window.location.href='billing.html'" class="btn btn-primary" style="padding:8px 16px;font-size:13px;width:auto;">
                <i class="fa-solid fa-cash-register"></i> <span data-i18n="top_pos_btn">Open POS</span>
              </button>` : ''}
            </div>
          </nav>
          <div id="toast"></div>
        `;

        document.body.insertAdjacentHTML('afterbegin', navbarHtml);
        document.body.insertAdjacentHTML('afterbegin', sidebarHtml);

        this.bindEvents();
        I18n.apply(); // Translate immediately
    } // <--- THIS BRACKET WAS MISSING

    static bindEvents() {
        const toggleMenu = () => {
            document.getElementById('sideMenu')?.classList.toggle('open');
            const overlay = document.getElementById('menuOverlay');
            if(overlay) overlay.style.display = overlay.style.display === 'block' ? 'none' : 'block';
        };

        document.getElementById('btnOpenMenuMain')?.addEventListener('click', toggleMenu);
        document.getElementById('btnCloseMenuMain')?.addEventListener('click', toggleMenu);
        document.getElementById('menuOverlay')?.addEventListener('click', toggleMenu);

        document.getElementById('globalLangToggle')?.addEventListener('click', () => {
            I18n.toggleLanguage();
        });
    }
} // <--- THE CLASS CLOSES HERE
// --- ADVANCED PWA UPDATE MANAGER ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(registration => {
            
            // Function to show the "Update App" button
            const showUpdatePrompt = (worker) => {
                // Don't show multiple prompts
                if(document.getElementById('pwa-update-toast')) return; 

                const toastHTML = `
                    <div id="pwa-update-toast" style="position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#1e293b; color:white; padding:12px 20px; border-radius:30px; display:flex; align-items:center; gap:15px; box-shadow:0 10px 30px rgba(0,0,0,0.3); z-index:2147483647; font-family:'Plus Jakarta Sans', sans-serif; font-size:13px; font-weight:700;">
                        <span><i class="fa-solid fa-cloud-arrow-down" style="color:#10b981;"></i> App Update Available!</span>
                        <button id="pwa-refresh-btn" style="background:#10b981; color:white; border:none; padding:8px 16px; border-radius:20px; font-weight:800; cursor:pointer;">Refresh Now</button>
                    </div>
                `;
                document.body.insertAdjacentHTML('beforeend', toastHTML);

                // When user clicks Refresh, tell the Service Worker to take over
                document.getElementById('pwa-refresh-btn').addEventListener('click', () => {
                    document.getElementById('pwa-refresh-btn').innerText = "Updating...";
                    worker.postMessage('SKIP_WAITING');
                });
            };

            // 1. Check if there's an update already waiting
            if (registration.waiting) showUpdatePrompt(registration.waiting);

            // 2. Listen for a new update installing in the background
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    // If it finished installing and we already have a previous SW controlling the page
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdatePrompt(newWorker);
                    }
                });
            });
        });

        // 3. The moment the new Service Worker takes over, reload the page to apply the new code
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                window.location.reload();
                refreshing = true;
            }
        });
    });
}