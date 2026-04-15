// File: /js/core/layout.js

const i18nDictionary = {
    "nav_dashboard":    { "en": "Dashboard",          "hinglish": "Dashboard",         "hi": "डैशबोर्ड" },
    "nav_billing":      { "en": "Billing",            "hinglish": "Bill Banao",        "hi": "बिल बनाओ" },
    "nav_inventory":    { "en": "Inventory",          "hinglish": "Dukaan Ka Samaan",  "hi": "दुकान का सामान" },
    "nav_sales":        { "en": "Sales Ledger",       "hinglish": "Sales Record",      "hi": "सेल्स रिकॉर्ड" },
    "nav_finance":      { "en": "Finance HQ",         "hinglish": "Hisab Kitab",       "hi": "हिसाब किताब" },
    "nav_crm":          { "en": "Bharat CRM",         "hinglish": "Grahak (Customers)","hi": "ग्राहक" },
    "nav_ai":           { "en": "DemandMitra AI",     "hinglish": "AI Forecast",       "hi": "AI भविष्यवाणी" },
    "nav_settings":     { "en": "Settings",           "hinglish": "Settings",          "hi": "सेटिंग्स" },
    "top_pos_btn":      { "en": "Open POS",           "hinglish": "Bill Banao",        "hi": "बिल बनाओ" }
};

export const applyTranslations = () => {
    const lang = localStorage.getItem('app_lang') || 'en';
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18nDictionary[key] && i18nDictionary[key][lang]) {
            el.innerText = i18nDictionary[key][lang];
        }
    });
    document.body.className = `lang-${lang}`;
};

export const injectLayout = (activePageCode) => {
    const getActive = (code) => activePageCode === code ? 'active-link' : '';
    
    const sidebarHtml = `
      <div id="menuOverlay" class="menu-overlay"></div>
      <div id="sideMenu" class="side-menu">
        <div class="side-menu-brand">
          <div class="side-menu-brand-text">Bharat<span>POS</span></div>
          <button id="btnCloseMenuMain" style="background:none;border:none;color:var(--text-muted);font-size:22px;cursor:pointer;line-height:1;">&times;</button>
        </div>
        <div class="side-menu-links">
          <a href="dashboard.html" class="${getActive('dashboard')}"><i class="fa-solid fa-house"></i> <span data-i18n="nav_dashboard">Dashboard</span></a>
          <a href="billing.html" class="${getActive('billing')}"><i class="fa-solid fa-file-invoice"></i> <span data-i18n="nav_billing">Billing</span></a>
          <a href="products.html" class="${getActive('products')}"><i class="fa-solid fa-box-open"></i> <span data-i18n="nav_inventory">Inventory</span></a>
          <a href="sales.html" class="${getActive('sales')}"><i class="fa-solid fa-chart-line"></i> <span data-i18n="nav_sales">Sales Ledger</span></a>
          <a href="my_dukkan.html" class="${getActive('finance')}"><i class="fa-solid fa-wallet"></i> <span data-i18n="nav_finance">Finance HQ</span></a>
          <a href="customers.html" class="${getActive('crm')}"><i class="fa-solid fa-users"></i> <span data-i18n="nav_crm">Bharat CRM</span></a>
          <a href="forecast.html" class="${getActive('forecast')}"><i class="fa-solid fa-brain"></i> <span data-i18n="nav_ai">DemandMitra AI</span></a>
          <a href="settings.html" class="${getActive('settings')}"><i class="fa-solid fa-gear"></i> <span data-i18n="nav_settings">Settings</span></a>
        </div>
      </div>
    `;

    let iconClass = 'fa-cash-register';
    let pageTitle = 'Dashboard';
    if(activePageCode === 'billing') { iconClass = 'fa-file-invoice'; pageTitle = 'Point of Sale'; }
    if(activePageCode === 'products') { iconClass = 'fa-boxes-stacked'; pageTitle = 'Inventory'; }
    if(activePageCode === 'sales') { iconClass = 'fa-chart-line'; pageTitle = 'Sales Ledger'; }
    
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
          <button onclick="window.location.href='billing.html'" class="btn btn-success" style="padding:8px 16px;font-size:13px;width:auto;">
            <i class="fa-solid fa-cash-register"></i> <span data-i18n="top_pos_btn">Open POS</span>
          </button>` : `
          <div id="btnOnlineOrders" class="bell-icon" title="Online Orders">
              <i class="fa-solid fa-bell"></i><div class="bell-badge" id="onlineBadge">0</div>
          </div>`}
        </div>
      </nav>
      <div id="toast">✅ Action Successful</div>
    `;

    document.body.insertAdjacentHTML('afterbegin', navbarHtml);
    document.body.insertAdjacentHTML('afterbegin', sidebarHtml);

    // Secure Event Binding
    const toggleMenu = () => {
        document.getElementById('sideMenu')?.classList.toggle('open');
        const overlay = document.getElementById('menuOverlay');
        if(overlay) overlay.style.display = overlay.style.display === 'block' ? 'none' : 'block';
    };

    document.getElementById('btnOpenMenuMain')?.addEventListener('click', toggleMenu);
    document.getElementById('btnCloseMenuMain')?.addEventListener('click', toggleMenu);
    document.getElementById('menuOverlay')?.addEventListener('click', toggleMenu);

    document.getElementById('globalLangToggle')?.addEventListener('click', () => {
        const langs = ['en', 'hinglish', 'hi'];
        let currentIdx = langs.indexOf(localStorage.getItem('app_lang') || 'en');
        currentIdx = (currentIdx + 1) % langs.length;
        localStorage.setItem('app_lang', langs[currentIdx]);
        applyTranslations();
    });

    applyTranslations();
};