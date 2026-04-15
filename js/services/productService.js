// File: /js/services/productService.js
import { dbGet, dbSave } from '../core/storage.js';

export class ProductService {
    // 🛡️ The Legacy Shield is now centralized!
    static applyLegacyShield(products) {
        return products.map(p => {
            if (!p.variants || !Array.isArray(p.variants) || p.variants.length === 0) {
                p.variants = [{
                    id: p.id + '_v0', quantity: p.quantity || '1 pcs', price: Number(p.price) || 0,
                    stock: Number(p.stock) || 0, barcode: p.barcode || '', baseQty: 1, baseUnit: 'pcs'
                }];
            }
            return p;
        });
    }

    static async getLocal() {
        let prods = await dbGet('bharatpos_products', '[]');
        return this.applyLegacyShield(prods);
    }

    static async saveLocal(products) {
        await dbSave('bharatpos_products', products);
    }

    static async getEnterprise() {
        let prods = await dbGet('bharatpos_enterprise_products', '[]');
        return this.applyLegacyShield(prods);
    }

    static async saveEnterprise(products) {
        await dbSave('bharatpos_enterprise_products', products);
    }
}