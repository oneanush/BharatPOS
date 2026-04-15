// File: /js/services/salesService.js
import { db } from '../core/firebase.js';
import { dbGet, dbSave } from '../core/storage.js';
import { doc, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ProductService } from './productService.js';
import { CustomerService } from './customerService.js';

export class SalesService {
    static async getLocal() {
        return await dbGet('bharatpos_sales', '[]');
    }

    static async saveLocal(sales) {
        await dbSave('bharatpos_sales', sales);
    }

    static async getEnterprise() {
        return await dbGet('bharatpos_enterprise_sales', '[]');
    }

    static async saveEnterprise(sales) {
        await dbSave('bharatpos_enterprise_sales', sales);
    }

    // 🌟 Centralized Checkout Engine
    static async processCheckout(user, saleDoc, cart, currentCustomer, udhaarAmt) {
        const uniqueProdIds = [...new Set(cart.map(item => item.prodId))];
        let allProducts = await ProductService.getLocal();
        let customers = await CustomerService.getLocal();

        // Atomic Cloud Transaction
        if (navigator.onLine && db) {
            await runTransaction(db, async (transaction) => {
                let pSnaps = {};
                for (const pid of uniqueProdIds) {
                    pSnaps[pid] = await transaction.get(doc(db, "shops", user.merchantId, "products", pid));
                }

                let customerRef = null, customerSnap = null;
                if (currentCustomer.name || currentCustomer.phone) {
                    const custId = currentCustomer.phone || currentCustomer.name.toLowerCase().replace(/\s/g, '_');
                    customerRef = doc(db, "shops", user.merchantId, "customers", custId);
                    customerSnap = await transaction.get(customerRef);
                }

                // 1. Update Products
                for (const pid of uniqueProdIds) {
                    const snap = pSnaps[pid];
                    if (snap.exists()) {
                        let pData = snap.data();
                        cart.filter(c => c.prodId === pid).forEach(cItem => {
                            const vIdx = pData.variants.findIndex(v => v.id === cItem.id);
                            if (vIdx > -1) {
                                let deduction = cItem.qty;
                                if (pData.isLoose) {
                                    const bq = Number(pData.variants[vIdx].baseQty) || 1;
                                    deduction = cItem.qty / bq;
                                }
                                pData.variants[vIdx].stock -= deduction;

                                if (cItem.brand && pData.variants[vIdx].brands) {
                                    const bIdx = pData.variants[vIdx].brands.findIndex(b => b.name === cItem.brand);
                                    if (bIdx > -1) pData.variants[vIdx].brands[bIdx].stock -= deduction;
                                }
                            }
                        });
                        transaction.update(snap.ref, { variants: pData.variants });
                        
                        // Sync local memory
                        const localIdx = allProducts.findIndex(p => p.id === pid);
                        if (localIdx > -1) allProducts[localIdx].variants = pData.variants;
                    }
                }

                // 2. Update Customers
                if (customerRef) {
                    if (customerSnap.exists()) {
                        let cData = customerSnap.data();
                        if (currentCustomer.name) cData.name = currentCustomer.name;
                        if (currentCustomer.phone) cData.phone = currentCustomer.phone;
                        cData.balance = (Number(cData.balance) || 0) + udhaarAmt;
                        transaction.update(customerRef, cData);

                        const cIdx = customers.findIndex(c => c.id === customerRef.id);
                        if (cIdx > -1) customers[cIdx] = cData;
                    } else {
                        const newCust = { id: customerRef.id, name: currentCustomer.name, phone: currentCustomer.phone, balance: udhaarAmt };
                        transaction.set(customerRef, newCust);
                        customers.push(newCust);
                    }
                }

                // 3. Save Ledger
                transaction.set(doc(db, "shops", user.merchantId, "sales", saleDoc.id), saleDoc);
            });
        }

        // Save to IndexedDB Caches
        await ProductService.saveLocal(allProducts);
        await CustomerService.saveLocal(customers);

        const sales = await this.getLocal();
        sales.push(saleDoc);
        await this.saveLocal(sales);

        // Update Enterprise Caches instantly for the Dashboard
        const eSales = await this.getEnterprise();
        if(eSales !== null) {
            saleDoc._branchId = user.merchantId; 
            eSales.unshift(saleDoc);
            await this.saveEnterprise(eSales);
        }
        
        const eProds = await ProductService.getEnterprise();
        if(eProds !== null) {
            uniqueProdIds.forEach(pid => {
                const localP = allProducts.find(p => p.id === pid);
                const eIdx = eProds.findIndex(p => p.id === pid && (p._branchId === user.merchantId || p.merchantId === user.merchantId));
                if(localP && eIdx > -1) eProds[eIdx].variants = localP.variants;
            });
            await ProductService.saveEnterprise(eProds);
        }
    }
}