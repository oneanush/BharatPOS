export class Security {
    static escapeHtml(str) {
        return str ? String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;') : '';
    }

    static generateUid(prefix = 'id') {
        return prefix + Date.now() + '-' + Math.floor(Math.random() * 90000);
    }
}