export class UI {
    static showToast(msg, isError = false) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.innerText = msg;
        t.style.background = isError ? 'var(--danger)' : 'var(--success)';
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    static showModal(id) {
        const m = document.getElementById(id);
        if (m) {
            m.style.display = 'flex';
            setTimeout(() => m.classList.add('show'), 10);
        }
    }

    static hideModal(id) {
        const m = document.getElementById(id);
        if (m) {
            m.classList.remove('show');
            setTimeout(() => m.style.display = 'none', 300);
        }
    }
}