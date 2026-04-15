// File: /js/components/modals.js

export class Modals {
    static injectReceiptModal() {
        const html = `
        <div id="receiptModal" class="modal-overlay" style="z-index: 6000;">
            <div class="modal-content" style="max-width:360px; background:#f8fafc; padding:15px; border-radius: var(--radius-lg);">
              <div class="receipt-content">
                <div style="text-align:center; margin-bottom:12px; border-bottom:1px dashed #000; padding-bottom:10px;">
                  <h3 style="margin:0; font-size:14px; font-weight:800;" id="rec-shop">BHARAT POS</h3>
                  <div style="font-size:10px; margin-top:4px;" id="rec-id"></div>
                  <div style="font-size:10px;" id="rec-date"></div>
                </div>
                <div style="font-size:11px; margin-bottom:12px; border-bottom:1px solid #ccc; padding-bottom:8px;">
                  <strong>Bill To:</strong> <span id="rec-name"></span> <span id="rec-phone" style="color:#555;"></span>
                </div>
                <table class="rec-table">
                  <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Amt</th></tr></thead>
                  <tbody id="rec-items"></tbody>
                </table>
                <div style="border-top:1px dashed #000; padding-top:8px; margin-top:8px;">
                    <div style="display:flex; justify-content:space-between; font-size:10px; margin-bottom:4px; color:#555;">
                        <span>Total Bill Value:</span><span id="rec-full-total">₹0</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:10px; margin-bottom:4px; color:#555;" id="rec-split-info"></div>
                    <div class="rec-total" style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; border-top:1px solid #000; padding-top:8px;">
                        <span style="font-size:11px; color:var(--danger);">PENDING UDHAAR:</span>
                        <span id="rec-due" style="color:var(--danger); font-size:14px;">₹0</span>
                    </div>
                </div>
              </div>
              <div style="display:flex; gap:8px; margin-top:12px;">
                  <button id="btnSettle" class="btn-settle" style="flex:1; padding:10px; font-size:12px;">✅ Receive Cash</button>
                  <button id="btnCloseReceipt" class="btn-settle" style="flex:1; background:#e2e8f0; color:#333; box-shadow:none; padding:10px; font-size:12px;">Close</button>
              </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    }

    static injectPartialPayModal() {
        const html = `
        <div id="partialPayModal" class="modal-overlay">
            <div class="modal-box" style="max-width:400px; border-radius:20px 20px 0 0;">
                <div class="modal-header">
                    <h3 style="margin:0; font-size:15px; font-weight:800;"><i class="fa-solid fa-calculator" style="color:var(--primary);"></i> Partial / Mix Payment</h3>
                    <button id="btnClosePartial" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-muted);"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="modal-body">
                    <div style="text-align:center; margin-bottom:20px;">
                        <div style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Grand Total To Pay</div>
                        <div style="font-size:28px; font-weight:800; color:var(--text-main); font-family:'JetBrains Mono';" id="partialGrandTotal">₹0.00</div>
                    </div>
                    <div class="form-group">
                        <input type="number" id="payCash" class="form-input" placeholder=" " style="font-size:18px; font-weight:800; color:var(--success);">
                        <label class="floating-label-mod"><i class="fa-solid fa-money-bill-wave"></i> Cash Amount</label>
                    </div>
                    <div class="form-group">
                        <input type="number" id="payOnline" class="form-input" placeholder=" " style="font-size:18px; font-weight:800; color:var(--purple);">
                        <label class="floating-label-mod"><i class="fa-solid fa-qrcode"></i> Online (UPI/Card) Amount</label>
                    </div>
                    <div class="form-group" style="margin-bottom:25px;">
                        <input type="number" id="payUdhaar" class="form-input" placeholder=" " style="font-size:18px; font-weight:800; color:var(--danger);" readonly>
                        <label class="floating-label-mod"><i class="fa-solid fa-book-open"></i> Udhaar (Pending) Amount</label>
                    </div>
                    <button type="button" id="btnConfirmPartial" class="btn btn-primary" style="padding:16px; font-size:14px;"><i class="fa-solid fa-check-circle"></i> Save Mix Payment</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    }
}