export class I18n {
    static dictionary = {
        "nav_dashboard":    { "en": "Dashboard",          "hinglish": "Dashboard",         "hi": "डैशबोर्ड" },
        "nav_billing":      { "en": "Billing",            "hinglish": "Bill Banao",        "hi": "बिल बनाओ" },
        "nav_inventory":    { "en": "Inventory",          "hinglish": "Dukaan Ka Samaan",  "hi": "दुकान का सामान" },
        "nav_sales":        { "en": "Sales Ledger",       "hinglish": "Sales Record",      "hi": "सेल्स रिकॉर्ड" },
        "nav_finance":      { "en": "Finance HQ",         "hinglish": "Hisab Kitab",       "hi": "हिसाब किताब" },
        "nav_crm":          { "en": "Bharat CRM",         "hinglish": "Grahak (Customers)","hi": "ग्राहक" },
        "nav_online_orders": { "en": "Online Orders",      "hinglish": "Online Orders",     "hi": "ऑनलाइन ऑर्डर्स" },
        "nav_reports":      { "en": "Reports",            "hinglish": "Reports",           "hi": "रिपोर्ट" },
        "nav_ai":           { "en": "AI-Assistant",     "hinglish": "AI-Madad",       "hi": "AI-सहायक" },
        "nav_settings":     { "en": "Settings",           "hinglish": "Settings",          "hi": "सेटिंग्स" },
        "top_pos_btn":      { "en": "Open POS",           "hinglish": "Bill Banao",        "hi": "बिल बनाओ" }
    };

    static apply() {
        const lang = localStorage.getItem('app_lang') || 'en';
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (this.dictionary[key] && this.dictionary[key][lang]) {
                el.innerText = this.dictionary[key][lang];
            }
        });
        document.body.className = `lang-${lang}`;
    }

    static toggleLanguage() {
        const langs = ['en', 'hinglish', 'hi'];
        let currentIdx = langs.indexOf(localStorage.getItem('app_lang') || 'en');
        currentIdx = (currentIdx + 1) % langs.length;
        localStorage.setItem('app_lang', langs[currentIdx]);
        this.apply();
    }
}