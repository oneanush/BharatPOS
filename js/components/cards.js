// File: /js/components/cards.js
import { Security } from '../utils/security.js';
import { Formatters } from '../utils/formatters.js';

export class Cards {
    // Generates a single Product Card for the Billing/Inventory grid
    static createProductCard(p, getUnitPrice, getUnitLabel) {
        const vCount = (p.variants || []).length;
        let badges = '';
        if (vCount > 1) badges += `<div class="pc-badge">${vCount} Types</div>`;
        if (p.isLoose) badges += `<div class="pc-badge-loose" style="right:${vCount > 1 ? '55px' : '0'};">Loose / Wt</div>`;
        
        const varPrices = (p.variants || []).map(v => {
            const uPrice = getUnitPrice(p, v);
            const uLabel = getUnitLabel(p, v);
            return `<span class="pc-variant-item">${Security.escapeHtml(v.quantity)}: ₹${uPrice.toFixed(2)}/${Security.escapeHtml(uLabel)}</span>`;
        }).join('');
        
        // Calculate Total Display Stock
        let totalBase = 0;
        let unit = p.variants?.[0]?.baseUnit || 'units';
        (p.variants || []).forEach(v => {
            const bq = Number(v.baseQty) || 1;
            totalBase += (Number(v.stock) || 0) * (p.isLoose ? bq : 1);
        });
        const displayStock = p.isLoose ? `${Formatters.stock(totalBase, unit)} ${unit}` : `${totalBase} in stock`;

        return `
        <div class="prod-card" data-id="${Security.escapeHtml(p.id)}">
            <button class="pc-info-btn" onclick="event.stopPropagation(); window.openProductInfo('${Security.escapeHtml(p.id)}')">
                <i class="fa-solid fa-circle-info"></i>
            </button>
            ${badges}
            <div class="pc-cat">${Security.escapeHtml(p.category || 'General')}</div>
            <div class="pc-name">${Security.escapeHtml(p.name)}</div>
            <div class="pc-variant-prices">${varPrices}</div>
            <div class="pc-bottom">
                <span class="pc-stock">${Security.escapeHtml(displayStock)}</span>
            </div>
        </div>`;
    }

    // Generates a single Cart Item row
    static createCartItem(item, idx) {
        return `
        <div class="cart-item">
            <div class="ci-details">
                <div class="ci-name">${Security.escapeHtml(item.name)}</div>
                <div class="ci-meta">
                    ${Security.escapeHtml(item.variant)} ${item.brand ? `• ${Security.escapeHtml(item.brand)}` : ''} 
                    @ ₹${item.unitPrice.toFixed(2)}/${Security.escapeHtml(item.unitLabel)}
                </div>
                <div class="ci-controls">
                    <button class="ci-btn ci-minus" data-idx="${idx}">-</button>
                    <span class="ci-qty">${item.qty} ${item.unitLabel === 'unit' ? '' : Security.escapeHtml(item.unitLabel)}</span>
                    <button class="ci-btn ci-plus" data-idx="${idx}">+</button>
                </div>
            </div>
            <div class="ci-pricing">
                <button class="ci-del" data-idx="${idx}"><i class="fa-solid fa-trash"></i></button>
                <div class="ci-total">₹${item.total.toFixed(2)}</div>
            </div>
        </div>`;
    }

    // Generates a KPI block for the Dashboard
    static createKpiCard(title, value, iconClass, colorClass, isClickable = false, clickId = '') {
        return `
        <div class="kpi-card glass-panel ${isClickable ? 'clickable' : ''}" ${clickId ? `id="${clickId}"` : ''}>
            <div class="kpi-icon ${colorClass}"><i class="fa-solid ${iconClass}"></i></div>
            <div class="kpi-details">
                <h4>${Security.escapeHtml(title)}</h4>
                <div class="value">${Security.escapeHtml(value)}</div>
            </div>
        </div>`;
    }
}