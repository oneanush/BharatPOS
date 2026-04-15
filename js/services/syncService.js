import { db } from '../core/firebase.js';
import { dbGet } from '../core/storage.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export class SyncService {
    static async gatherLocalBackup() {
        const keys = ['bharatpos_products', 'bharatpos_sales', 'bharatpos_customers', 'bharatpos_settings', 'shopName'];
        const backup = {};
        
        // Grab IndexedDB data
        for (let k of keys) {
            backup[k] = await dbGet(k, null);
        }
        backup._meta = { generatedAt: new Date().toISOString(), userAgent: navigator.userAgent };
        return backup;
    }

    static async pushFullBackup() {
        const user = JSON.parse(localStorage.getItem('bharatpos_user') || '{}');
        if (!user.merchantId || !navigator.onLine) return;

        try {
            const payload = await this.gatherLocalBackup();
            const backupRef = doc(db, "shops", user.merchantId, "legacy_backup", "latest");
            await setDoc(backupRef, { backupData: payload, timestamp: new Date().toISOString() });
            console.log('🔁 Full backup pushed to Firestore');
        } catch (err) {
            console.warn('Full backup failed', err);
        }
    }

    // Debounced trigger to prevent spamming the database
    static pushBackupDebounced() {
        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => { this.pushFullBackup(); }, 2000);
    }
}