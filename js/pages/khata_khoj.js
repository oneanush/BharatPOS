// File: /js/pages/khata_khoj.js

import { db } from '../core/firebase.js';
import { collectionGroup, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let map = null;
let allShopsCache = {};
let markersLayer = null;
let routingControl = null;
let userLoc = [20.5937, 78.9629]; // Default India

export async function initKhoj() {
    const loader = document.getElementById('khojLoader');
    const content = document.getElementById('khojContent');
    
    const style = `
        <style>
            .khoj-search-bar { position: absolute; top: 20px; left: 20px; right: 20px; z-index: 1000; background: white; padding: 14px 20px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 12px; border: 1.5px solid var(--brand-primary);}
            .khoj-search-bar input { border: none; outline: none; width: 100%; font-family: inherit; font-size: 14px; font-weight: 600; color: var(--text-main); }
            .khoj-btn { background: var(--brand-primary); color: white; border: none; padding: 10px 16px; border-radius: 12px; font-weight: 800; cursor: pointer; }
            
            .custom-div-icon { background: white; border: 3px solid var(--brand-primary); border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
            .pin-icon { font-size: 38px; color: var(--brand-accent); filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3)); }
            
            /* Hide the text instructions from leaflet routing machine to save screen space on mobile */
            .leaflet-routing-container { display: none !important; }
        </style>
    `;

    content.innerHTML = style + `
        <div id="leafletMap" style="width:100%; height:100%; border-radius:24px 24px 0 0;"></div>
        <div class="khoj-search-bar">
            <i class="fa-solid fa-radar" style="color:var(--brand-primary);"></i>
            <input type="text" id="khojInput" placeholder="Find 'Aashirvaad Atta'...">
            <button id="btnKhojSearch" class="khoj-btn"><i class="fa-solid fa-magnifying-glass"></i></button>
        </div>
    `;

    loader.style.display = 'none';

    map = L.map('leafletMap', { zoomControl: false }).setView(userLoc, 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);

    // Get User Location & highlight nearest shop
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
            userLoc = [pos.coords.latitude, pos.coords.longitude];
            map.setView(userLoc, 13);
            
            // User Dot
            L.circleMarker(userLoc, { radius: 8, fillColor: '#3b82f6', color: '#fff', weight: 3, opacity: 1, fillOpacity: 1 }).addTo(map).bindPopup("You are here");
            
            await cacheAllShops();
            highlightNearestShop();
        });
    } else {
        await cacheAllShops();
    }

    document.getElementById('btnKhojSearch').addEventListener('click', performKhoj);
    document.getElementById('khojInput').addEventListener('keypress', (e) => {
        if(e.key === 'Enter') performKhoj();
    });

    // Make global routing function available for the popup buttons
    window.drawRouteToShop = function(lat, lng) {
        if(routingControl) map.removeControl(routingControl);
        
        routingControl = L.Routing.control({
            waypoints: [ L.latLng(userLoc[0], userLoc[1]), L.latLng(lat, lng) ],
            routeWhileDragging: false,
            addWaypoints: false,
            fitSelectedRoutes: true,
            show: false, // hide textual itinerary
            lineOptions: { styles: [{color: '#6366f1', opacity: 0.8, weight: 6}] }
        }).addTo(map);
    };
}

async function cacheAllShops() {
    try {
        const shopsSnap = await getDocs(collectionGroup(db, 'shops'));
        shopsSnap.forEach(d => {
            const profile = d.data().profile;
            if(profile && profile.lat && profile.lng) {
                allShopsCache[d.id] = { id: d.id, ...profile };
                const dotIcon = L.divIcon({ className: 'custom-div-icon', iconSize: [14, 14] });
                L.marker([profile.lat, profile.lng], { icon: dotIcon }).addTo(markersLayer);
            }
        });
    } catch(e) { console.warn("Map cache failed."); }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

async function highlightNearestShop() {
    let nearest = null;
    let minD = Infinity;

    Object.values(allShopsCache).forEach(shop => {
        const d = calculateDistance(userLoc[0], userLoc[1], shop.lat, shop.lng);
        if(d < minD) { minD = d; nearest = shop; }
    });

    if(nearest) {
        try {
            // Find most sold product locally by just picking one (simulated via pulling products)
            const prodSnap = await getDocs(collectionGroup(db, 'products'));
            let topProd = null;
            prodSnap.forEach(d => {
                if(d.ref.parent.parent.id === nearest.id && !topProd) topProd = d.data();
            });

            if(topProd) {
                const pinIcon = L.divIcon({
                    className: 'matched-pin', html: '<i class="fa-solid fa-location-dot pin-icon"></i>',
                    iconSize: [38, 38], iconAnchor: [19, 38], popupAnchor: [0, -38]
                });
                const marker = L.marker([nearest.lat, nearest.lng], { icon: pinIcon, zIndexOffset: 1000 }).addTo(markersLayer);
                
                let popupHtml = `
                    <div style="font-family:'Plus Jakarta Sans', sans-serif; min-width:160px; text-align:center;">
                        <div style="font-size:10px; color:#f59e0b; font-weight:800; text-transform:uppercase;">Nearest Shop</div>
                        <div style="font-weight:800; font-size:16px; margin-bottom:4px; color:#1e293b;">${nearest.shopName}</div>
                        <div style="font-size:12px; color:#64748b; font-weight:600; margin-bottom:10px;">Trending: ${topProd.name}</div>
                        <button onclick="drawRouteToShop(${nearest.lat}, ${nearest.lng})" style="width:100%; background:#6366f1; color:white; border:none; padding:8px; border-radius:8px; font-weight:800; cursor:pointer;">Get Route</button>
                    </div>
                `;
                marker.bindPopup(popupHtml).openPopup();
            }
        } catch(e) {}
    }
}

async function performKhoj() {
    const q = document.getElementById('khojInput').value.toLowerCase().trim();
    if(!q) return;

    const btn = document.getElementById('btnKhojSearch');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`; btn.disabled = true;

    if(routingControl) map.removeControl(routingControl); // clear previous route

    try {
        markersLayer.clearLayers();
        Object.values(allShopsCache).forEach(shop => {
            const dotIcon = L.divIcon({ className: 'custom-div-icon', iconSize: [14, 14] });
            L.marker([shop.lat, shop.lng], { icon: dotIcon }).addTo(markersLayer);
        });

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
            const pinIcon = L.divIcon({
                className: 'matched-pin', html: '<i class="fa-solid fa-location-dot pin-icon"></i>',
                iconSize: [38, 38], iconAnchor: [19, 38], popupAnchor: [0, -38]
            });

            foundKeys.forEach(key => {
                const s = foundShops[key];
                const lowestPrice = Math.min(...s.products.map(p => Number(p.variants[0]?.price || 0)));
                const marker = L.marker([s.shop.lat, s.shop.lng], { icon: pinIcon, zIndexOffset: 1000 }).addTo(markersLayer);
                
                let popupHtml = `
                    <div style="font-family:'Plus Jakarta Sans', sans-serif; min-width:160px; text-align:center;">
                        <div style="font-weight:800; font-size:16px; margin-bottom:4px; color:#1e293b;">${s.shop.shopName}</div>
                        <div style="font-size:12px; color:#64748b; font-weight:600; margin-bottom:8px;">Has ${s.products.length} matches</div>
                        <div style="font-size:16px; color:#10b981; font-weight:800; font-family:'JetBrains Mono'; margin-bottom:12px;">Starts ₹${lowestPrice}</div>
                        <button onclick="drawRouteToShop(${s.shop.lat}, ${s.shop.lng})" style="width:100%; background:#6366f1; color:white; border:none; padding:8px; border-radius:8px; font-weight:800; cursor:pointer;">Get Route</button>
                    </div>
                `;
                marker.bindPopup(popupHtml);
            });

            const group = new L.featureGroup(markersLayer.getLayers());
            map.fitBounds(group.getBounds().pad(0.1));
        } else {
            alert(`No shops found selling "${q}" nearby.`);
        }

    } catch(e) {
        alert("Search failed. Ensure internet connection.");
    } finally {
        btn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i>`; btn.disabled = false;
    }
}