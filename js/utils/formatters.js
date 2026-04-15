export class Formatters {
    static currency(n) {
        return Number(n || 0).toLocaleString('en-IN');
    }

    static stock(amount, unitType) {
        const u = (unitType || '').toLowerCase();
        if (u.includes('kg') || u.includes('g') || u.includes('l') || u.includes('ml')) {
            return parseFloat(amount || 0).toFixed(2).replace(/\.00$/, '');
        }
        return Math.floor(amount || 0);
    }
}