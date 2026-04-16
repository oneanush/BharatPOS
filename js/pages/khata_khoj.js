// File: /js/pages/khata_khoj.js

import { db } from '../core/firebase.js';
import { collectionGroup, query, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let map = null;
let allShopsCache = {};
let markersLayer = null;
let userLoc = [20.5937, 78.9629]; // Default India

export async function initKhoj() {
    const loader = document.getElementById('khojLoader');
    const content = document.getElementById('khojContent');
    
    // Add specific CSS for the map overlay
    const style = `
        <style>
            .khoj-search-bar { position: absolute; top: 20px; left: 20px; right: 20px; z-index: 1000; background: white; padding: 14px 20px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 12px; }
            .khoj-search-bar input { border: none; outline: none; width: 100%; font-family: inherit; font-size: 14px; font-weight: 600; color: var(--text-main); }
            .khoj-btn { background: var(--brand-primary); color: white; border: none; padding: 10px 16px; border-radius: 12px; font-weight: 800; cursor: pointer; }
            
            .custom-div-icon { background: var(--brand-primary); border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
            .pin-icon { font-size: 32px; color: var(--brand-accent); filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3)); }
        </style>
    `;

    content.innerHTML = style + `
        <div id="leafletMap" style="width:100%; height:100%; border-radius:24px 24px 0 0;"></div>
        <div class="khoj-search-bar">
            <i class="fa-solid fa-radar" style="color:var(--brand-primary);"></i>
            <input type="text" id="khojInput" placeholder="Find 'Aashirvaad Atta', 'Paracetamol'...">
            <button id="btnKhojSearch" class="khoj-btn"><i class="fa-solid fa-magnifying-glass"></i></button>
        </div>
    `;

    loader.style.display = 'none';

    // Initialize Map
    map = L.map('leafletMap', { zoomControl: false }).setView(userLoc, 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

    // Fetch User Location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            userLoc = [pos.coords.latitude, pos.coords.longitude];
            map.setView(userLoc, 13);
            
            // Add user marker
            L.circleMarker(userLoc, { radius: 8, fillColor: '#3b82f6', color: '#fff', weight: 3, opacity: 1, fillOpacity: 1 }).addTo(map).bindPopup("You are here");
        });
    }

    markersLayer = L.layerGroup().addTo(map);

    // Pre-fetch shops to draw dots
    await cacheAllShops();

    document.getElementById('btnKhojSearch').addEventListener('click', performKhoj);
    document.getElementById('khojInput').addEventListener('keypress', (e) => {
        if(e.key === 'Enter') performKhoj();
    });
}

async function cacheAllShops() {
    try {
        const shopsSnap = await getDocs(collectionGroup(db, 'shops'));
        shopsSnap.forEach(d => {
            const profile = d.data().profile;
            if(profile && profile.lat && profile.lng) {
                allShopsCache[d.id] = { id: d.id, ...profile };
                // Draw default dot
                const dotIcon = L.divIcon({ className: 'custom-div-icon', iconSize: [12, 12] });
                L.marker([profile.lat, profile.lng], { icon: dotIcon }).addTo(markersLayer);
            }
        });
    } catch(e) {
        console.warn("Could not cache shops for map.");
    }
}

async function performKhoj() {
    const q = document.getElementById('khojInput').value.toLowerCase().trim();
    if(!q) return;

    const btn = document.getElementById('btnKhojSearch');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    btn.disabled = true;

    try {
        markersLayer.clearLayers();
        
        // Redraw all dots first
        Object.values(allShopsCache).forEach(shop => {
            const dotIcon = L.divIcon({ className: 'custom-div-icon', iconSize: [12, 12] });
            L.marker([shop.lat, shop.lng], { icon: dotIcon }).addTo(markersLayer);
        });

        // Search products globally via Collection Group Query
        const prodSnap = await getDocs(collectionGroup(db, 'products'));
        
        let foundShops = {};

        prodSnap.forEach(d => {
            const p = d.data();
            const shopId = d.ref.parent.parent.id;
            
            if(p.name && p.name.toLowerCase().includes(q)) {
                if(allShopsCache[shopId]) {
                    if(!foundShops[shopId]) foundShops[shopId] = { shop: allShopsCache[shopId], products: [] };
                    foundShops[shopId].products.push(p);
                }
            }
        });

        const foundKeys = Object.keys(foundShops);

        if(foundKeys.length > 0) {
            // Define Pin Icon for Matches
            const pinIcon = L.divIcon({
                className: 'matched-pin',
                html: '<i class="fa-solid fa-location-dot pin-icon"></i>',
                iconSize: [32, 32],
                iconAnchor: [16, 32],
                popupAnchor: [0, -32]
            });

            foundKeys.forEach(key => {
                const s = foundShops[key];
                const lowestPrice = Math.min(...s.products.map(p => Number(p.variants[0]?.price || 0)));
                
                const marker = L.marker([s.shop.lat, s.shop.lng], { icon: pinIcon, zIndexOffset: 1000 }).addTo(markersLayer);
                
                let popupHtml = `
                    <div style="font-family:'Plus Jakarta Sans', sans-serif; min-width:150px;">
                        <div style="font-weight:800; font-size:14px; margin-bottom:4px; color:#1e293b;">${s.shop.shopName}</div>
                        <div style="font-size:12px; color:#64748b; font-weight:600; margin-bottom:8px;">Has ${s.products.length} matches</div>
                        <div style="font-size:14px; color:#10b981; font-weight:800; font-family:'JetBrains Mono';">Starts ₹${lowestPrice}</div>
                    </div>
                `;
                marker.bindPopup(popupHtml);
            });

            // Auto-zoom to fit all matches
            const group = new L.featureGroup(markersLayer.getLayers());
            map.fitBounds(group.getBounds().pad(0.1));
            
        } else {
            alert(`No shops found selling "${q}" nearby.`);
        }

    } catch(e) {
        console.error(e);
        alert("Search failed. Ensure internet connection.");
    } finally {
        btn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i>`;
        btn.disabled = false;
    }
}