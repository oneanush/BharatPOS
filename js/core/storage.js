// File: /js/core/storage.js

export const dbSave = async (key, data) => {
    try {
        if (typeof localforage !== 'undefined') {
            await localforage.setItem(key, JSON.stringify(data));
            return true;
        } else {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        }
    } catch (err) {
        console.error(`Database Error saving ${key}:`, err);
        return false;
    }
};

export const dbGet = async (key, defaultValue = '[]') => {
    try {
        let value = null;
        if (typeof localforage !== 'undefined') {
            value = await localforage.getItem(key);
        }
        
        // Fallback to localStorage for older devices
        if (value === null) {
            value = localStorage.getItem(key);
        }

        if (value === null) return JSON.parse(defaultValue);
        return JSON.parse(value);
    } catch (err) {
        console.error(`Database Error reading ${key}:`, err);
        return JSON.parse(defaultValue);
    }
};