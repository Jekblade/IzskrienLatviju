const state = {
    map: null,
    drawnItems: null,
    selectedArea: null,
    latviaBorderCoords: [],
    routingControl: null,
    markers: [],
    routePoints: [],
    customRouteLayer: null,
    grayBorderLine: null,
    routeHistory: [],
    currentDistance: 0
};

// Utility functions
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

const showError = (message, duration = 5000) => {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => { errorDiv.style.display = 'none'; }, duration);
};

const updateInfoPanel = () => {
    const panel = document.getElementById('info-panel');
    if (state.currentDistance > 0) {
        panel.style.display = 'block';
        panel.textContent = `Distance: ${(state.currentDistance / 1000).toFixed(2)} km`;
    } else {
        panel.style.display = 'none';
    }
};

// Map initialization
async function initializeMap() {
    try {
        state.map = L.map('map', {
            minZoom: 7
        }).setView([56.8796, 24.6032], 7);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 17,
            minZoom: 5,
            attribution: '© OpenStreetMap contributors'
        }).addTo(state.map);

        // Load Latvia border coordinates
        try {
            const response = await fetch('LV.json');
            if (!response.ok) throw new Error("Failed to load Latvia border data");
            state.latviaBorderCoords = await response.json();
        } catch (error) {
            console.error("Error loading latvia.json:", error);
            showError("Failed to load Latvia border data");
        }

        // Initialize drawing controls
        state.drawnItems = new L.FeatureGroup();
        state.map.addLayer(state.drawnItems);
        
        const drawControl = new L.Control.Draw({
            draw: {
                polygon: false,
                rectangle: true,
                circle: false,
                marker: false,
                polyline: false
            },
            edit: {
                featureGroup: state.drawnItems,
                remove: true
            }
        });
        state.map.addControl(drawControl);

        // Event listeners
        setupEventListeners();

    } catch (error) {
        console.error("Map initialization failed:", error);
        showError("Failed to initialize map");
    }
}

// Event listeners setup
function setupEventListeners() {
    state.map.on('draw:created', handleDrawCreated);
    
    // Button event listeners
    document.getElementById('search-btn').addEventListener('click', searchPlace);
    document.getElementById('search-bar').addEventListener('keypress', e => {
        if (e.key === 'Enter') searchPlace();
    });
    document.getElementById('create-btn').addEventListener('click', () => {
    calculateOptimalRoute();
    updateButtonLayoutAfterCreate();
});
    document.getElementById('download-btn').addEventListener('click', generateGPX);
    document.getElementById('reset-btn').addEventListener('click', () => {
    setupButtonStates();
    resetSelection();
    resetRouteData();
});
    document.getElementById('undo-btn').addEventListener('click', undoLastEdit);

    // Map events for tutorial arrow
    state.map.on('zoomend moveend', debounce(updateTutorialArrow, 100));

    // Window resize handler
    window.addEventListener('resize', debounce(handleWindowResize, 250));
}

function handleDrawCreated(event) {
    state.drawnItems.clearLayers();
    const layer = event.layer;
    layer.setStyle({ fillOpacity: 0, weight: 3 });
    state.drawnItems.addLayer(layer);
    state.selectedArea = layer.getBounds();
    document.getElementById('arrow-select').style.display = 'none';
    document.getElementById('reset-btn').style.display = 'inline-block';
}


function handleWindowResize() {
    const header = document.getElementById('header');
    const isMobile = window.innerWidth <= 600;
    
    header.style.flexDirection = isMobile ? 'column' : 'row';
    updateTutorialArrow();
}



//search any place on earth
async function searchPlace() {
    const query = document.getElementById('search-bar').value.trim();
    if (!query) {
        showError("Please enter a location to search");
        return;
    }

    try {
        const sanitizedQuery = encodeURIComponent(query);
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${sanitizedQuery}+Latvia`
        );
        
        if (!response.ok) throw new Error("Search failed");
        
        const data = await response.json();
        
        if (data && data[0]) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            state.map.flyTo([lat, lon], 13);
            document.getElementById('arrow-select').style.display = 'block';
            updateTutorialArrow();
        } else {
            showError("Location not found in Latvia");
        }
    } catch (error) {
        console.error("Search error:", error);
        showError("Failed to search location");
    }
}

// fit LV to select area
function resizeAndFitBorder(coords, bounds) {
    if (!coords || coords.length === 0) {
        throw new Error("No border coordinates available");
    }

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    
    const latRange = Math.max(...coords.map(p => p[0])) - Math.min(...coords.map(p => p[0]));
    const lngRange = Math.max(...coords.map(p => p[1])) - Math.min(...coords.map(p => p[1]));
    
    if (latRange === 0 || lngRange === 0) throw new Error("Invalid border range");

    const areaLatRange = ne.lat - sw.lat;
    const areaLngRange = ne.lng - sw.lng;
    const scale = Math.min(areaLatRange / latRange, areaLngRange / lngRange) * 0.9;
    const latCenter = (Math.max(...coords.map(p => p[0])) + Math.min(...coords.map(p => p[0]))) / 2;
    const lngCenter = (Math.max(...coords.map(p => p[1])) + Math.min(...coords.map(p => p[1]))) / 2;
    const areaLatCenter = (sw.lat + ne.lat) / 2;
    const areaLngCenter = (sw.lng + ne.lng) / 2;

    const transformedCoords = coords.map(([lat, lng]) => [
        areaLatCenter + (lat - latCenter) * scale,
        areaLngCenter + (lng - lngCenter) * scale
    ]);

    if (state.grayBorderLine) {
        state.map.removeLayer(state.grayBorderLine);
    }

    state.grayBorderLine = L.polyline(transformedCoords, { 
        color: 'gray', 
        weight: 2, 
        dashArray: "5,10", 
        fillOpacity: 0 
    }).addTo(state.map);
    
    return transformedCoords;
}


async function calculateOptimalRoute() {
    if (!state.selectedArea) {
        showError("Please select an area on the map first");
        return;
    }

    document.getElementById('loading').style.display = 'block';
    try {
        resetRouteData();
        const resizedBorderPoints = resizeAndFitBorder(state.latviaBorderCoords, state.selectedArea);
        state.routePoints = resizedBorderPoints.map(point => [point[0], point[1]]);
        initializeRoutingControl();
    } catch (error) {
        console.error("Error calculating route:", error);
        showError("Failed to calculate route. Please try again.");
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

async function initializeRoutingControl() {
    // Remove existing route layer if it exists
    if (state.routeLayer) {
        state.map.removeLayer(state.routeLayer);
    }

    const waypoints = state.routePoints.map(point => point.join(',')).join(';');
    const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${waypoints}?geometries=geojson&access_token=pk.eyJ1IjoiamVrYWJzamFuIiwiYSI6ImNtM2RrMTd4bjAzNDMycnF1Y2huYjI1dWQifQ.r5oltP7NHqf3W-lJlN0n9A`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
            const routeGeoJSON = {
                type: 'Feature',
                geometry: data.routes[0].geometry,
                properties: {}
            };

            // Display route on map
            state.routeLayer = L.geoJSON(routeGeoJSON, {
                style: { color: 'red', opacity: 0.6, weight: 4 }
            }).addTo(state.map);

            // Save route coordinates and update distance
            state.finalRouteCoordinates = data.routes[0].geometry.coordinates;
            state.currentDistance = data.routes[0].distance;
            updateInfoPanel();
        } else {
            showError("No route found. Adjust waypoints and try again.");
        }
    } catch (error) {
        console.error("Failed to fetch route:", error);
        showError("Route calculation failed. Please check your waypoints.");
    }
}

// Function to handle dynamic updates when waypoints are dragged
function setupDraggableWaypoints() {
    state.routePoints.forEach((point, index) => {
        const marker = L.marker([point[0], point[1]], { draggable: true })
            .on('dragend', async function(e) {
                // Update waypoint coordinates
                const newLatLng = e.target.getLatLng();
                state.routePoints[index] = [newLatLng.lat, newLatLng.lng];
                await initializeRoutingControl(); // Recalculate the route
            });
        marker.addTo(state.map);
    });
}


function undoLastEdit() {
}


// reset views
function resetRouteData() {
    if (state.routingControl) {
        state.map.removeControl(state.routingControl);
        state.routingControl = null;
    }

    state.markers.forEach(marker => {
        marker.off('dragend');
        state.map.removeLayer(marker);
    });
    state.markers = [];
    state.routePoints = [];
    state.currentDistance = 0;
    updateInfoPanel();
}

function resetSelection() {
    state.drawnItems.clearLayers();
    state.selectedArea = null;

    resetRouteData();

    if (state.grayBorderLine) {
        state.map.removeLayer(state.grayBorderLine);
        state.grayBorderLine = null;
    }

    if (state.customRouteLayer) {
        state.map.removeLayer(state.customRouteLayer);
        state.customRouteLayer = null;
    }

    document.getElementById('info-panel').style.display = 'none';
    document.getElementById('arrow-select').style.display = 'none';
}

// Initial button state setup
function setupButtonStates() {
    document.getElementById('search-bar').style.display = 'inline';
    document.getElementById('search-btn').style.display = 'inline-block';
    document.getElementById('create-btn').style.display = 'inline-block';
    document.getElementById('undo-btn').style.display = 'none';
    document.getElementById('reset-btn').style.display = 'none';
    document.getElementById('download-btn').style.display = 'none';
}

// Function to switch button layout after route creation
function updateButtonLayoutAfterCreate() {
    document.getElementById('create-btn').style.display = 'none';
    document.getElementById('search-bar').style.display = 'none';
    document.getElementById('search-btn').style.display = 'none';
    document.getElementById('undo-btn').style.display = 'inline-block';
    document.getElementById('reset-btn').style.display = 'inline-block';
    document.getElementById('download-btn').style.display = 'inline-block';
}

function generateGPX() {
    if (state.finalRouteCoordinates.length < 2) {
        showError("Not enough route data to generate GPX file");
        return;
    }

    const currentDate = new Date().toISOString();
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Izskrien Latviju"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns="http://www.topografix.com/GPX/1/1"
xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
<metadata>
<name>Izskrien Latviju Route</name>
<time>${currentDate}</time>
</metadata>
<trk>
<name>Running Route</name>
<trkseg>
${state.finalRouteCoordinates.map(coord => 
`            <trkpt lat="${coord[0]}" lon="${coord[1]}"></trkpt>`
).join('\n')}
</trkseg>
</trk>
</gpx>`;

    try {
        const blob = new Blob([gpx], { type: 'application/gpx+xml' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'izskrienLV.gpx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error("GPX generation failed:", error);
        showError("Failed to generate GPX file");
    }
}


function updateTutorialArrow() {
    const arrow = document.getElementById('arrow-select');
    const drawControl = document.querySelector('.leaflet-draw-draw-rectangle');
    if (drawControl && arrow.style.display !== 'none') {
        const rect = drawControl.getBoundingClientRect();
        arrow.style.top = (rect.top + rect.height/2 - 20) + 'px';
        arrow.style.left = (rect.left + 35) + 'px';
    }
}

// Initialize the application
initializeMap().catch(error => {
    console.error("Application initialization failed:", error);
    showError("Failed to initialize application");
});
setupButtonStates();
