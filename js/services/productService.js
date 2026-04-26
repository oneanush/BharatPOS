// File: /js/services/productService.js
import { dbGet, dbSave } from '../core/storage.js';

export class ProductService {
    // 🛡️ The Legacy Shield is now centralized and updated for the new Type/Brand engine!
    static applyLegacyShield(products) {
        return products.map(p => {
            if (!p.variants || !Array.isArray(p.variants) || p.variants.length === 0) {
                
                // Backwards compatibility for older items
                const oldType = p.quantity || 'General';
                const oldBrand = p.brand || '';
                const finalQuantity = oldBrand ? `${oldType} - ${oldBrand}` : oldType;

                p.variants = [{
                    id: p.id + '_v0', 
                    type: oldType,           // NEW: Added Type field
                    brandName: oldBrand,     // NEW: Added Brand field
                    quantity: finalQuantity, // Combined label
                    price: Number(p.price) || 0,
                    stock: Number(p.stock) || 0, 
                    barcode: p.barcode || '', 
                    costPrice: p.costPrice || '',
                    expiryDate: p.expiryDate || '',
                    baseQty: 1, 
                    baseUnit: 'pcs'
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