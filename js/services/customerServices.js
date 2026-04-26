// File: /js/services/customerService.js
import { dbGet, dbSave } from '../core/storage.js';

export class CustomerService {
    static async getLocal() {
        return await dbGet('bharatpos_customers', '[]');
    }

    static async saveLocal(customers) {
        await dbSave('bharatpos_customers', customers);
    }
}