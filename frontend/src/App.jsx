import React, { useState, useEffect, useRef, useMemo } from 'react';
import './App.css';
import damsDataset from './damsData.json';

const API_BASE = 'http://127.0.0.1:8000';

const DEPTH_CLASSES = [
  { label: '0.05-0.5 m', color: '#bfdbfe' },
  { label: '0.5-2 m', color: '#60a5fa' },
  { label: '2-5 m', color: '#2563eb' },
  { label: '> 5 m', color: '#1e3a8a' }
];

// ---- small style helpers (same look as before) ----
const card = { background: '#101726', border: '1px solid #1E293B', borderRadius: '4px', padding: '8px' };
const cap = { fontSize: '9px', fontWeight: 700, color: '#64748B', marginBottom: '4px' };
const miniInput = { padding: '3px 5px', background: '#131B2E', border: '1px solid #2A364F', borderRadius: '3px', color: '#FFF', fontSize: '9px' };
const exportBtn = (color = '#38BDF8', disabled = false) => ({
  padding: '4px', background: '#131B2E', border: '1px solid #2A364F', color: disabled ? '#475569' : color,
  borderRadius: '3px', fontSize: '9px', cursor: disabled ? 'not-allowed' : 'pointer'
});
const sliderRow = { display: 'flex', justifyContent: 'space-between', color: '#94A3B8' };
const sliderVal = { color: '#38BDF8', fontWeight: 700 };
const legendRow = { display: 'flex', alignItems: 'center', gap: '6px' };
const dot = (c) => ({ width: '6px', height: '6px', background: c, borderRadius: '50%' });

const fmtNum = (v) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v).toLocaleString() : '—');
const fmtVal = (v) => (v != null && v !== '' ? v : '—');

export default function App() {
  // 1. DATASET, ACTIVE DAM & DEM UPLOAD
  const [dams, setDams] = useState(() => (Array.isArray(damsDataset) && damsDataset.length > 0 ? damsDataset : []));
  const [selectedDam, setSelectedDam] = useState('Bhakra Dam');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const searchBoxRef = useRef(null);
  const fileInputRef = useRef(null);

 const [uploadedDemMeta, setUploadedDemMeta] = useState({
  fileName: 'Dams.csv',
  damName: 'Bhakra Dam',
  resolution: '30 m (GLO-30)',
  grid: '1024 × 1024',
  crs: 'EPSG:4326',
  latitude: 31.4113,
  longitude: 76.4335
});
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const currentDam = useMemo(() => {
    const found = dams.find(d => d.dam_name.toLowerCase() === selectedDam.toLowerCase());
    if (found) return found;
    return {
      dam_name: uploadedDemMeta.damName || selectedDam,
      latitude: uploadedDemMeta.latitude || 31.4113,
      longitude: uploadedDemMeta.longitude || 76.4335,
      height_m: 35.0,
      state: 'Andaman & Nicobar',
      district: 'South Andaman',
      river: 'Dhanikhari'
    };
  }, [selectedDam, dams, uploadedDemMeta]);

  // Operator session
  const [operatorId] = useState('OPS-2026-0918');
  const [alertLevel] = useState('Orange');
  const [priority] = useState('High');
  const [sessionTime, setSessionTime] = useState(() => new Date().toLocaleString('en-IN'));
  useEffect(() => {
    const t = setInterval(() => setSessionTime(new Date().toLocaleString('en-IN')), 1000);
    return () => clearInterval(t);
  }, []);

  // Scenario presets & sliders
  const [activePreset, setActivePreset] = useState('Moderate Breach');
  const [reservoirLevel, setReservoirLevel] = useState(70);
  const [breachWidth, setBreachWidth] = useState(80);
  const [breachTime, setBreachTime] = useState(5);
  const [simDuration, setSimDuration] = useState(30);

  // Display / GIS
  const [showSPH] = useState(true);
  const [showSAR, setShowSAR] = useState(false);
  const [baseMapType, setBaseMapType] = useState('satellite');

  // Timeline
  const [currentTimeStep, setCurrentTimeStep] = useState(30);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Field observations
  const [fieldObs, setFieldObs] = useState({
    waterLevel: '', rainfall: '', lat: '11.6244', lon: '92.6591',
    severity: 'Moderate', notes: '', relayNDRF: true
  });
  const [obsSubmitted, setObsSubmitted] = useState(false);
  const [obsSubmitting, setObsSubmitting] = useState(false);

  // Saved scenarios
  const [savedScenarios, setSavedScenarios] = useState([
    { name: 'A: Baseline Failure', area: '6.7 km²', depth: '2.9 m', vel: '1.9 m/s', pop: '7,470' },
    { name: 'B: Moderate Breach', area: '9.5 km²', depth: '3.4 m', vel: '2.2 m/s', pop: '8,715' },
    { name: 'C: High Reservoir', area: '13.6 km²', depth: '4.8 m', vel: '3.2 m/s', pop: '12,450' }
  ]);
  const [scenarioToast, setScenarioToast] = useState(false);
  const [notice, setNotice] = useState(null);
  const showNotice = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 3000); };

  // Simulation & map state
  const [simData, setSimData] = useState(null);
  const [loadingSim, setLoadingSim] = useState(false);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const reqId = useRef(0);
  const [simError, setSimError] = useState(null);

  // Validated ANUGA
  const [validatedMode, setValidatedMode] = useState(false);
  const [hidkalSummary, setHidkalSummary] = useState(null);
  const [hidkalScenario, setHidkalScenario] = useState('paper_peak');
  const [validatedGeo, setValidatedGeo] = useState(null);

  // Leaflet refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markerRef = useRef(null);
  const delftLayerRef = useRef(null);
  const sphLayerRef = useRef(null);
  const overlapLayerRef = useRef(null);
  const sarLayerRef = useRef(null);
  const assetNodesGroupRef = useRef(null);
  const validatedLayerRef = useRef(null);

  const handlePresetSelect = (preset) => {
    setActivePreset(preset);
    const P = {
      'Baseline Failure': [50, 40, 10],
      'Moderate Breach': [70, 80, 5],
      'Severe Breach': [90, 120, 3],
      'High Reservoir': [100, 100, 4]
    }[preset];
    if (P) { setReservoirLevel(P[0]); setBreachWidth(P[1]); setBreachTime(P[2]); }
  };

  // Simulation fetch (all sliders sent, stale responses ignored)
  const fetchSimulationData = async (damName, storagePct) => {
    const id = ++reqId.current;
    setLoadingSim(true);
    setSimError(null);
    try {
      const q = new URLSearchParams({
        dam_name: damName,
        storage_percent: storagePct,
        breach_width: breachWidth,
        breach_time: breachTime,
        duration: simDuration
      });
      const res = await fetch(`${API_BASE}/simulate?${q.toString()}`);
      if (id !== reqId.current) return;
      if (res.ok) {
        setSimData(await res.json());
      } else {
        let body = {};
        try { body = await res.json(); } catch (_) {}
        setSimData(null);
        setSimError(`Simulation failed (${res.status}): ${body.error || 'server error'}${body.detail ? ' — ' + body.detail : ''}`);
      }
    } catch (e) {
      console.error(e);
      if (id === reqId.current) { setSimData(null); setSimError('Backend not reachable. Is uvicorn running on port 8000?'); }
    } finally {
      if (id === reqId.current) setLoadingSim(false);
    }
  };

  // DEM upload
  const handleDemUpload = async (file) => {
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);
    setValidatedMode(false);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}/upload-dem`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const data = await res.json();
      setUploadedDemMeta({
        fileName: data.file_name,
        damName: data.dam_name,
        resolution: data.resolution,
        grid: data.grid,
        crs: data.crs,
        latitude: data.latitude,
        longitude: data.longitude
      });
      if (data.dam_name === selectedDam) {
        fetchSimulationData(data.dam_name, reservoirLevel); // selectedDam unchanged -> effect won't refire
      } else {
        setSelectedDam(data.dam_name); // fly-to effect fetches the simulation
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.flyTo([data.latitude, data.longitude], 13, { duration: 1.2 });
      }
    } catch (err) {
      console.error(err);
      setUploadError(`Could not upload "${file.name}". Check that the backend is running and the file type is supported.`);
    } finally {
      setIsUploading(false);
    }
  };

  // Leaflet injection
  useEffect(() => {
    if (window.L) { setLeafletLoaded(true); return; }
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.onload = () => setLeafletLoaded(true);
      document.body.appendChild(script);
    } else {
      const interval = setInterval(() => {
        if (window.L) { setLeafletLoaded(true); clearInterval(interval); }
      }, 50);
      return () => clearInterval(interval);
    }
  }, []);

  // Dams list
  useEffect(() => {
    fetch(`${API_BASE}/dams`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setDams(data); })
      .catch(() => {});
  }, []);

  // Validated Hidkal summary
  useEffect(() => {
    fetch(`${API_BASE}/validated/hidkal`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data && data.scenarios) setHidkalSummary(data); })
      .catch(() => {});
  }, []);

  // Outside click for search
  useEffect(() => {
    const handleOutside = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) setIsSearching(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Timeline auto-play
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentTimeStep(prev => (prev >= simDuration ? 0 : prev + 1));
    }, 1000 / playbackSpeed);
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, simDuration]);

  // Keep time step within duration
  useEffect(() => {
    setCurrentTimeStep(t => Math.min(t, simDuration));
  }, [simDuration]);

  const getTileConfig = (type) => {
    if (type === 'satellite') {
      return {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: { maxZoom: 18, maxNativeZoom: 17, attribution: 'Esri, DigitalGlobe, Earthstar Geographics' }
      };
    }
    return {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: { maxZoom: 19, subdomains: ['a', 'b', 'c'], attribution: '© OpenStreetMap contributors' }
    };
  };

  // MAP INIT
  useEffect(() => {
    if (!leafletLoaded || !mapContainerRef.current || !window.L) return;
    const L = window.L;

    if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }

    const lat = currentDam ? currentDam.latitude : 11.634;
    const lon = currentDam ? currentDam.longitude : 92.684;

    try {
      const map = L.map(mapContainerRef.current, { zoomControl: false, attributionControl: false }).setView([lat, lon], 13);
      mapInstanceRef.current = map;
      const config = getTileConfig(baseMapType);
      tileLayerRef.current = L.tileLayer(config.url, config.options).addTo(map);
      L.control.zoom({ position: 'topright' }).addTo(map);
      assetNodesGroupRef.current = L.layerGroup().addTo(map);
      setTimeout(() => { if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize(); }, 250);
    } catch (err) {
      console.error(err);
    }

    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    };
    // eslint-disable-next-line
  }, [leafletLoaded]);

  // Base map toggle
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    const L = window.L;
    if (tileLayerRef.current) mapInstanceRef.current.removeLayer(tileLayerRef.current);
    const config = getTileConfig(baseMapType);
    tileLayerRef.current = L.tileLayer(config.url, config.options).addTo(mapInstanceRef.current);
    tileLayerRef.current.bringToBack();
  }, [baseMapType]);

  // Fly to dam + marker + fetch simulation
  useEffect(() => {
    if (!selectedDam || !currentDam || !mapInstanceRef.current || !window.L) return;
    if (validatedMode) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    const lat = parseFloat(currentDam.latitude);
    const lon = parseFloat(currentDam.longitude);

    if (delftLayerRef.current) { map.removeLayer(delftLayerRef.current); delftLayerRef.current = null; }
    if (sphLayerRef.current) { map.removeLayer(sphLayerRef.current); sphLayerRef.current = null; }
    if (overlapLayerRef.current) { map.removeLayer(overlapLayerRef.current); overlapLayerRef.current = null; }
    if (assetNodesGroupRef.current) assetNodesGroupRef.current.clearLayers();

    map.flyTo([lat, lon], 13, { duration: 1.0 });

    if (markerRef.current) map.removeLayer(markerRef.current);

    const pin = L.divIcon({
      className: 'dam-custom-pin',
      html: `
        <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
          <div class="dam-pulse-ring"></div>
          <div class="dam-center-core"></div>
        </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    markerRef.current = L.marker([lat, lon], { icon: pin }).addTo(map);
    markerRef.current.bindTooltip(
      `<div style="text-align:center; font-family:sans-serif; padding:2px 4px;">
         <b style="color:#0F172A; font-size:11px;">${currentDam.dam_name}</b><br/>
         <span style="color:#64748B; font-size:9px;">${currentDam.state || 'India'}</span>
       </div>`,
      { permanent: true, direction: 'bottom', offset: [0, 10], className: 'custom-leaflet-tooltip' }
    ).openTooltip();

    fetchSimulationData(currentDam.dam_name, reservoirLevel);
    // eslint-disable-next-line
  }, [selectedDam, leafletLoaded, validatedMode]);

  // Sentinel-1 SAR overlay
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L || !currentDam) return;
    const L = window.L;
    const map = mapInstanceRef.current;
    let cancelled = false;

    if (sarLayerRef.current) { map.removeLayer(sarLayerRef.current); sarLayerRef.current = null; }

    if (showSAR) {
      const lat = parseFloat(currentDam.latitude);
      const lon = parseFloat(currentDam.longitude);
      fetch(`${API_BASE}/realtime-flood?dam_lat=${lat}&dam_lon=${lon}&buffer_km=15`)
        .then(res => res.json())
        .then(data => {
          if (cancelled || !mapInstanceRef.current) return;
          if (data.status === 'success' && data.geojson) {
            if (sarLayerRef.current) map.removeLayer(sarLayerRef.current);
            sarLayerRef.current = L.geoJSON(data.geojson, {
              style: { color: '#10B981', fillColor: '#10B981', fillOpacity: 0.45, weight: 1.5 }
            }).addTo(map);
          } else {
            showNotice('SAR data not available for this location');
          }
        })
        .catch(err => { console.error(err); if (!cancelled) showNotice('SAR request failed'); });
    }
    return () => { cancelled = true; };
  }, [showSAR, currentDam, leafletLoaded]);

  // Terrain-following propagation layers
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L || !currentDam || !simData) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    if (delftLayerRef.current) { map.removeLayer(delftLayerRef.current); delftLayerRef.current = null; }
    if (sphLayerRef.current) { map.removeLayer(sphLayerRef.current); sphLayerRef.current = null; }
    if (overlapLayerRef.current) { map.removeLayer(overlapLayerRef.current); overlapLayerRef.current = null; }
    if (assetNodesGroupRef.current) assetNodesGroupRef.current.clearLayers();

    if (validatedMode) return;

    const damLat = parseFloat(currentDam.latitude);
    const damLon = parseFloat(currentDam.longitude);
    const tf = Math.max(0.05, Math.min(1.0, currentTimeStep / simDuration));

    let naturalCoords = [];
    const hydroGJ = simData.flood_simulation?.geojson;

    if (hydroGJ && (hydroGJ.features || hydroGJ.type === 'FeatureCollection')) {
      const feat = hydroGJ.features ? hydroGJ.features[0] : hydroGJ;
      if (feat && feat.geometry && feat.geometry.coordinates) {
        const polyCoords = Array.isArray(feat.geometry.coordinates[0][0])
          ? feat.geometry.coordinates[0]
          : feat.geometry.coordinates;
        naturalCoords = polyCoords.map(pt => [pt[1], pt[0]]);
      }
    }

    if (naturalCoords.length < 3) {
      const reach = 0.055;
      const spread = 0.016;
      naturalCoords = [
        [damLat, damLon],
        [damLat - reach * 0.25, damLon - spread * 0.40],
        [damLat - reach * 0.60, damLon - spread * 0.65],
        [damLat - reach * 0.95, damLon - spread * 0.45],
        [damLat - reach * 1.00, damLon + spread * 0.05],
        [damLat - reach * 0.65, damLon + spread * 0.35],
        [damLat - reach * 0.25, damLon + spread * 0.20],
        [damLat, damLon]
      ];
    }

    const delftDynamic = naturalCoords.map(([pLat, pLon]) => [
      damLat + (pLat - damLat) * tf,
      damLon + (pLon - damLon) * tf
    ]);

    delftLayerRef.current = L.polygon(delftDynamic, {
      color: '#06B6D4', fillColor: '#06B6D4', fillOpacity: 0.45, weight: 1.5
    }).addTo(map);

    if (showSPH) {
      const sphDynamic = delftDynamic.map(([pLat, pLon]) => [
        pLat + (pLat - damLat) * 0.06,
        pLon + (pLon - damLon) * 0.12
      ]);
      sphLayerRef.current = L.polygon(sphDynamic, {
        color: '#2563EB', fillColor: '#1D4ED8', fillOpacity: 0.35, weight: 1.8, dashArray: '4, 4'
      }).addTo(map);
    }

    const overlapDynamic = delftDynamic.map(([pLat, pLon]) => [
      damLat + (pLat - damLat) * 0.72,
      damLon + (pLon - damLon) * 0.72
    ]);
    overlapLayerRef.current = L.polygon(overlapDynamic, {
      color: '#EF4444', fillColor: '#EF4444', fillOpacity: 0.65, weight: 1.5
    }).addTo(map);

    // Illustrative asset markers; status depends on how far the front has travelled
    if (delftDynamic.length > 5) {
      const sampleIndices = [1, 2, 3, 4, 5];
      const assetTypes = [
        { type: 'hospital', color: '#EC4899', name: 'District Health Center' },
        { type: 'bridge', color: '#A855F7', name: 'River Basin Bridge' },
        { type: 'village', color: '#F59E0B', name: 'Downstream Settlement' },
        { type: 'road', color: '#38BDF8', name: 'Valley Access Road' },
        { type: 'school', color: '#EC4899', name: 'Govt. Primary School' }
      ];
      sampleIndices.forEach((idx, i) => {
        const pt = delftDynamic[Math.min(idx, delftDynamic.length - 1)];
        const info = assetTypes[i % assetTypes.length];
        const nodeLat = (damLat + pt[0]) / 2;
        const nodeLon = (damLon + pt[1]) / 2;
        const reached = tf >= (i + 1) / (sampleIndices.length + 1);
        L.circleMarker([nodeLat, nodeLon], {
          radius: 6,
          fillColor: info.color,
          color: '#FFFFFF',
          weight: 2,
          fillOpacity: reached ? 1 : 0.35
        })
          .bindTooltip(`<b>${info.name}</b><br/>Status: ${reached ? 'Reached by flood' : 'Not yet reached'} (${info.type})<br/><i>Illustrative marker</i>`)
          .addTo(assetNodesGroupRef.current);
      });
    }
  }, [simData, currentTimeStep, simDuration, showSPH, currentDam, validatedMode]);

  // Validated ANUGA layer
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    if (validatedLayerRef.current) { map.removeLayer(validatedLayerRef.current); validatedLayerRef.current = null; }
    if (!validatedMode || !hidkalSummary) return;

    if (markerRef.current) { map.removeLayer(markerRef.current); markerRef.current = null; }

    let cancelled = false;
    fetch(`${API_BASE}/validated/hidkal/${hidkalScenario}`)
      .then(res => res.json())
      .then(gj => {
        if (cancelled || !mapInstanceRef.current) return;
        const group = L.layerGroup();
        const flood = L.geoJSON(gj, {
          style: (f) => ({ color: f.properties.color, fillColor: f.properties.color, fillOpacity: 0.55, weight: 0.8 }),
          onEachFeature: (f, layer) => {
            layer.bindTooltip(`Max depth ${f.properties.depth_range}<br/>Area ${f.properties.area_km2} km²`);
          }
        });
        flood.addTo(group);

        const d = hidkalSummary.dam;
        L.circleMarker([d.latitude, d.longitude], {
          radius: 7, color: '#FFFFFF', weight: 2, fillColor: '#EF4444', fillOpacity: 1
        }).bindTooltip(d.name, { permanent: true, direction: 'bottom' }).addTo(group);

        group.addTo(map);
        validatedLayerRef.current = group;
        setValidatedGeo(gj);
        try { map.fitBounds(flood.getBounds(), { padding: [30, 30] }); } catch (e) { console.error(e); }
      })
      .catch(err => console.error(err));

    return () => { cancelled = true; };
  }, [validatedMode, hidkalScenario, hidkalSummary, leafletLoaded]);

  // ---------- actions ----------
  const fs = simData?.flood_simulation;
  const kpi = {
    area: fmtVal(fs?.flooded_area_sq_km),
    depth: fmtVal(fs?.flood_level_m),
    vel: fs ? (fs.max_velocity_ms ?? 'n/a') : '—',
    pop: fmtNum(fs?.estimated_affected_population)
  };
  // Optional fields: backend should send these inside flood_simulation (shown as "—" until it does)
  const hadr = fs?.hadr || {};
  const loss = fs?.loss_damage || {};

  const saveCurrentScenario = () => {
    if (!fs) { showNotice('Run a simulation first'); return; }
    const newEntry = {
      name: `Custom ${activePreset}`,
      area: `${kpi.area} km²`,
      depth: `${kpi.depth} m`,
      vel: typeof kpi.vel === 'number' ? `${kpi.vel} m/s` : 'n/a',
      pop: kpi.pop
    };
    setSavedScenarios(prev => [newEntry, ...prev.slice(0, 2)]);
    setScenarioToast(true);
    setTimeout(() => setScenarioToast(false), 3000);
  };

  const exportGeoJSON = () => {
    const gj = fs?.geojson;
    if (!gj) { showNotice('Run a simulation first'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(gj)], { type: 'application/geo+json' }));
    a.download = `${selectedDam.replace(/\s+/g, '_')}_flood.geojson`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const submitObservation = async () => {
    setObsSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/field-observation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fieldObs, dam: selectedDam, operatorId, timestamp: new Date().toISOString() })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setObsSubmitted(true);
      setFieldObs(o => ({ ...o, waterLevel: '', rainfall: '', notes: '' }));
      setTimeout(() => setObsSubmitted(false), 2500);
    } catch (e) {
      console.error(e);
      showNotice('Observation submit failed. Please try again.');
    } finally {
      setObsSubmitting(false);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    const m = searchTerm.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m && mapInstanceRef.current) {
      const la = +m[1], lo = +m[2];
      if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
        mapInstanceRef.current.flyTo([la, lo], 13);
        setIsSearching(false);
        return;
      }
      showNotice('Invalid coordinates');
    } else if (filteredDams.length > 0) {
      setValidatedMode(false);
      setSelectedDam(filteredDams[0].dam_name);
      setSearchTerm('');
      setIsSearching(false);
    }
  };

  const q = searchTerm.trim().toLowerCase();
  const filteredDams = q.length > 0
    ? dams.filter(d =>
        d.dam_name?.toLowerCase().includes(q) ||
        d.state?.toLowerCase().includes(q) ||
        d.district?.toLowerCase().includes(q)
      ).slice(0, 50)
    : dams.slice(0, 15);

  const damOptions = dams.slice(0, 200);
  if (!damOptions.some(d => d.dam_name === currentDam.dam_name)) damOptions.unshift(currentDam);

  // Validated view values
  const vScenario = hidkalSummary?.scenarios?.[hidkalScenario];
  const vTotal = vScenario?.exposure_by_depth?.find(r => r.depth_class === 'TOTAL');
  const vDeepArea = validatedGeo?.features?.find(f => f.properties.cls === 4)?.properties?.area_km2;
  const isValidated = validatedMode && !!vScenario;

  const kpiBox = { background: '#101726', padding: '6px', borderRadius: '4px', border: '1px solid #1E293B' };
  const kpiNum = (color) => ({ fontSize: '14px', fontWeight: 800, color });
  const unitStyle = { fontSize: '9px', color: '#94A3B8' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: '#090D16', overflow: 'hidden' }}>

      {notice && (
        <div style={{ position: 'fixed', top: 50, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: '#7C2D12', color: '#FFEDD5', padding: '6px 12px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
          {notice}
        </div>
      )}

      {/* HEADER */}
      <header style={{ height: '42px', background: '#0B111E', borderBottom: '1px solid #1E293B', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', flexShrink: 0, zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 900, letterSpacing: '0.8px', fontSize: '14px', color: '#FFFFFF' }}>HYDROVISION</span>
          <span style={{ color: '#64748B', fontSize: '11px', borderLeft: '1px solid #334155', paddingLeft: '8px' }}>
            Dam Break Inundation & HADR Decision Support
          </span>
        </div>

        <div ref={searchBoxRef} style={{ position: 'relative', width: '300px' }}>
          <input
            type="text"
            placeholder="🔍 Search dam, state, or lat,lon + Enter"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setIsSearching(true); }}
            onFocus={() => setIsSearching(true)}
            onKeyDown={handleSearchKeyDown}
            style={{ width: '100%', padding: '5px 10px', background: '#131B2E', border: '1px solid #2A364F', borderRadius: '4px', color: '#F8FAFC', fontSize: '11px', outline: 'none' }}
          />
          {isSearching && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '260px', overflowY: 'auto', background: '#131B2E', border: '1px solid #334155', borderRadius: '4px', marginTop: '2px', zIndex: 5000, boxShadow: '0 8px 24px rgba(0,0,0,0.8)' }}>
              {filteredDams.map(d => (
                <div
                  key={`${d.dam_name}-${d.latitude}`}
                  onClick={() => { setValidatedMode(false); setSelectedDam(d.dam_name); setSearchTerm(''); setIsSearching(false); }}
                  style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #1E293B', fontSize: '11px' }}
                >
                  <div style={{ fontWeight: 600, color: '#38BDF8' }}>{d.dam_name}</div>
                  <div style={{ fontSize: '9px', color: '#94A3B8' }}>{d.state || 'India'} {d.district ? `• ${d.district}` : ''} • Height: {d.height_m}m</div>
                </div>
              ))}
              {filteredDams.length === 0 && (
                <div style={{ padding: '8px 10px', fontSize: '10px', color: '#64748B' }}>No dam found</div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ background: isValidated ? '#047857' : '#1D4ED8', color: '#FFFFFF', padding: '3px 8px', borderRadius: '4px', fontWeight: 700, fontSize: '10px' }}>
            {isValidated ? 'VALIDATED RUN — Hidkal' : `LIVE — ${selectedDam}`}
          </div>
          <div style={{ background: '#1E293B', color: '#94A3B8', border: '1px solid #334155', padding: '3px 8px', borderRadius: '4px', fontSize: '10px' }}>
            {isValidated ? 'ANUGA 2D shallow-water' : 'SPH + Delft3D'}
          </div>
          <div style={{ background: '#92400E', color: '#FDE68A', padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
            {isValidated ? 'precomputed, approximate' : 'simulated outputs'}
          </div>
          <button
            disabled
            title="Digital Twin view is not implemented yet"
            style={{ background: '#0F172A', border: '1px solid #334155', color: '#475569', padding: '4px 10px', borderRadius: '4px', cursor: 'not-allowed', fontSize: '10px' }}
          >
            ☷ Digital Twin
          </button>
          <button onClick={() => window.print()} style={{ background: '#2563EB', border: 'none', color: '#FFFFFF', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 700, fontSize: '10px' }}>
            HADR Report
          </button>
        </div>
      </header>

      {/* THREE PANELS */}
      <div style={{ display: 'flex', flex: 1, position: 'relative', overflow: 'hidden' }}>

        {/* LEFT */}
        <div style={{ width: '270px', background: '#0B111E', borderRight: '1px solid #1E293B', display: 'flex', flexDirection: 'column', padding: '10px', gap: '8px', overflowY: 'auto', flexShrink: 0 }}>

          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '9px', fontWeight: 700, color: '#64748B' }}>OPERATOR SESSION</span>
              <span style={{ background: '#C2410C', color: '#FFEDD5', padding: '1px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: 700 }}>{alertLevel}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '9px', color: '#94A3B8' }}>
              <div>Operator ID: <b style={{ color: '#E2E8F0' }}>{operatorId}</b></div>
              <div>Priority: <b style={{ color: '#E2E8F0' }}>{priority}</b></div>
              <div style={{ gridColumn: 'span 2' }}>Timestamp: <span style={{ color: '#E2E8F0' }}>{sessionTime}</span></div>
            </div>
          </div>

          <div>
            <div style={cap}>DAM SELECTION</div>
            <select
              value={currentDam.dam_name}
              onChange={(e) => { setValidatedMode(false); setSelectedDam(e.target.value); }}
              style={{ width: '100%', padding: '5px', background: '#131B2E', color: '#F8FAFC', border: '1px solid #2A364F', borderRadius: '4px', fontSize: '11px' }}
            >
              {damOptions.map(d => (
                <option key={`${d.dam_name}-${d.latitude}`} value={d.dam_name}>
                  {d.dam_name} ({d.state || 'India'})
                </option>
              ))}
            </select>
          </div>

          {hidkalSummary && (
            <div style={{ background: '#052E16', border: '1px solid #059669', borderRadius: '4px', padding: '8px' }}>
              <div style={{ fontSize: '9px', fontWeight: 800, color: '#34D399', marginBottom: '4px' }}>VALIDATED RUN — HIDKAL (ANUGA)</div>
              <select
                value={hidkalScenario}
                onChange={(e) => setHidkalScenario(e.target.value)}
                style={{ width: '100%', padding: '4px', background: '#064E3B', color: '#ECFDF5', border: '1px solid #059669', borderRadius: '3px', fontSize: '10px', marginBottom: '5px' }}
              >
                {Object.entries(hidkalSummary.scenarios).map(([key, s]) => (
                  <option key={key} value={key}>{s.label}</option>
                ))}
              </select>
              <button
                onClick={() => setValidatedMode(v => !v)}
                style={{ width: '100%', padding: '5px', background: validatedMode ? '#7F1D1D' : '#059669', color: '#FFF', border: 'none', borderRadius: '3px', fontWeight: 700, fontSize: '10px', cursor: 'pointer' }}
              >
                {validatedMode ? 'Back to screening model' : 'Show validated Hidkal results'}
              </button>
              <div style={{ fontSize: '8px', color: '#A7F3D0', marginTop: '4px', lineHeight: 1.35 }}>
                Precomputed 2D shallow-water run on a 30 m DEM. It is not live, and the sliders below do not change it.
              </div>
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".tif,.tiff,.dem,.kml,.geojson,.shp,.nc"
            onChange={(e) => {
              if (e.target.files?.[0]) handleDemUpload(e.target.files[0]);
              e.target.value = '';
            }}
          />

          <div>
            <div style={cap}>LOAD DEM / DAM DATA</div>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files?.[0]) handleDemUpload(e.dataTransfer.files[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: isDragOver ? '1px dashed #38BDF8' : '1px dashed #2A364F',
                background: isDragOver ? 'rgba(56, 189, 248, 0.08)' : '#101726',
                borderRadius: '4px', padding: '8px', textAlign: 'center', cursor: 'pointer', marginBottom: '6px'
              }}
            >
              <div style={{ fontSize: '14px', marginBottom: '2px' }}>📄</div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#E2E8F0' }}>
                {isUploading ? 'Uploading DEM...' : 'Drag & drop DEM / terrain data'}
              </div>
              <div style={{ fontSize: '8px', color: '#64748B', marginTop: '2px' }}>GeoTIFF, DEM, Shapefile, GeoJSON, KML, NetCDF</div>
              <div style={{ fontSize: '9px', color: '#38BDF8', marginTop: '3px', textDecoration: 'underline' }}>or browse files</div>
            </div>

            {uploadError && (
              <div style={{ background: '#450A0A', border: '1px solid #B91C1C', borderRadius: '4px', padding: '6px 8px', color: '#FCA5A5', fontSize: '9px', marginBottom: '6px' }}>
                ✕ {uploadError}
              </div>
            )}

            <div style={{ background: '#052E16', border: '1px solid #059669', borderRadius: '4px', padding: '8px' }}>
              <div style={{ color: '#34D399', fontWeight: 700, fontSize: '10px', marginBottom: '4px' }}>
                {uploadError ? 'Previously loaded data' : '✓ Data Loaded Successfully'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px', fontSize: '9px', color: '#A7F3D0' }}>
                <div>File: <b>{uploadedDemMeta.fileName}</b></div>
                <div>Dam: <b>{uploadedDemMeta.damName}</b></div>
                <div>Res: <b>{uploadedDemMeta.resolution}</b></div>
                <div>Grid: <b>{uploadedDemMeta.grid}</b></div>
                <div style={{ gridColumn: 'span 2' }}>CRS: <b>{uploadedDemMeta.crs}</b></div>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ width: '100%', marginTop: '6px', padding: '3px', background: '#064E3B', border: '1px solid #059669', color: '#6EE7B7', borderRadius: '3px', fontSize: '9px', cursor: 'pointer' }}
              >
                Upload Different File
              </button>
            </div>
          </div>

          <div>
            <div style={cap}>SCENARIO</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              {['Baseline Failure', 'Moderate Breach', 'Severe Breach', 'High Reservoir'].map(p => (
                <button
                  key={p}
                  onClick={() => handlePresetSelect(p)}
                  style={{
                    padding: '5px', fontSize: '9px', borderRadius: '3px', cursor: 'pointer',
                    background: activePreset === p ? '#2563EB' : '#131B2E',
                    color: activePreset === p ? '#FFF' : '#94A3B8',
                    border: activePreset === p ? '1px solid #3B82F6' : '1px solid #1E293B',
                    fontWeight: activePreset === p ? 700 : 500
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '10px' }}>
            {isValidated && (
              <div style={{ fontSize: '8px', color: '#FCD34D' }}>
                Sliders and presets apply to the screening model only, not to the validated run.
              </div>
            )}
            <div style={sliderRow}><span>Reservoir Level</span><span style={sliderVal}>{reservoirLevel}%</span></div>
            <input type="range" min="30" max="100" value={reservoirLevel} onChange={(e) => setReservoirLevel(Number(e.target.value))} />

            <div style={sliderRow}><span>Breach Width</span><span style={sliderVal}>{breachWidth} m</span></div>
            <input type="range" min="20" max="150" value={breachWidth} onChange={(e) => setBreachWidth(Number(e.target.value))} />

            <div style={sliderRow}><span>Breach Initiation Time</span><span style={sliderVal}>{breachTime} min</span></div>
            <input type="range" min="1" max="30" value={breachTime} onChange={(e) => setBreachTime(Number(e.target.value))} />

            <div style={sliderRow}><span>Simulation Duration</span><span style={sliderVal}>{simDuration} min</span></div>
            <input type="range" min="10" max="120" value={simDuration} onChange={(e) => setSimDuration(Number(e.target.value))} />
          </div>

          <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
            <button
              onClick={() => fetchSimulationData(currentDam.dam_name, reservoirLevel)}
              disabled={loadingSim || isValidated}
              style={{ flex: 1, padding: '7px', background: isValidated ? '#1E293B' : '#2563EB', color: '#FFF', border: 'none', borderRadius: '4px', fontWeight: 700, fontSize: '11px', cursor: isValidated ? 'not-allowed' : 'pointer' }}
            >
              {loadingSim ? '⚙ Running Engine...' : '▶ Run Simulation'}
            </button>
            <button
              onClick={() => handlePresetSelect('Moderate Breach')}
              style={{ padding: '7px 10px', background: '#131B2E', color: '#94A3B8', border: '1px solid #2A364F', borderRadius: '4px', cursor: 'pointer' }}
            >
              ↺
            </button>
          </div>
        </div>

        {/* CENTER */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>

          <div
            ref={mapContainerRef}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: '40px', backgroundColor: '#0F172A', width: '100%', height: 'calc(100% - 40px)', zIndex: 1 }}
          />

          <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000, display: 'flex', gap: '6px' }}>
            <button
              onClick={() => setBaseMapType(baseMapType === 'satellite' ? 'streets' : 'satellite')}
              style={{ background: 'rgba(11, 17, 30, 0.85)', backdropFilter: 'blur(4px)', color: '#FFFFFF', border: '1px solid #2A364F', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer' }}
            >
              ☀ Switch to {baseMapType === 'satellite' ? 'Streets' : 'Satellite'}
            </button>
            <button
              onClick={() => setShowSAR(!showSAR)}
              style={{ background: showSAR ? '#059669' : 'rgba(11, 17, 30, 0.85)', backdropFilter: 'blur(4px)', color: '#FFFFFF', border: '1px solid #2A364F', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer' }}
            >
              🛰 Sentinel-1 SAR overlay
            </button>
          </div>

          {!isValidated && (
            <div style={{ position: 'absolute', top: 10, right: 54, zIndex: 1000, background: 'rgba(11, 17, 30, 0.9)', backdropFilter: 'blur(4px)', border: '1px solid #2A364F', borderRadius: '4px', padding: '8px 12px', fontSize: '10px' }}>
              <div style={{ fontWeight: 700, color: '#E2E8F0', marginBottom: '4px' }}>Model Difference</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '9px' }}>
                <div style={{ ...legendRow, color: '#60A5FA' }}><span style={{ width: '8px', height: '8px', background: '#2563EB', borderRadius: '50%' }}></span> SPH only</div>
                <div style={{ ...legendRow, color: '#67E8F9' }}><span style={{ width: '8px', height: '8px', background: '#06B6D4', borderRadius: '50%' }}></span> Delft3D only</div>
                <div style={{ ...legendRow, color: '#F87171' }}><span style={{ width: '8px', height: '8px', background: '#EF4444', borderRadius: '50%' }}></span> Overlap</div>
              </div>
            </div>
          )}

          <div style={{ position: 'absolute', bottom: 50, left: 10, zIndex: 1000, background: 'rgba(11, 17, 30, 0.9)', backdropFilter: 'blur(4px)', border: '1px solid #2A364F', borderRadius: '4px', padding: '8px 10px', fontSize: '9px' }}>
            {isValidated ? (
              <>
                <div style={{ fontWeight: 700, color: '#64748B', marginBottom: '4px' }}>MAX FLOOD DEPTH (ANUGA)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '3px' }}>
                  {DEPTH_CLASSES.map(c => (
                    <div key={c.label} style={legendRow}>
                      <span style={{ width: '10px', height: '10px', background: c.color, border: '1px solid #475569' }}></span> {c.label}
                    </div>
                  ))}
                  <div style={legendRow}><span style={dot('#EF4444')}></span> Dam Location</div>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, color: '#64748B', marginBottom: '4px' }}>LEGEND</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '3px' }}>
                  <div style={legendRow}><span style={dot('#EF4444')}></span> Dam Location</div>
                  <div style={legendRow}><span style={dot('#2563EB')}></span> SPH Flood Extent</div>
                  <div style={legendRow}><span style={dot('#06B6D4')}></span> Delft3D Extent</div>
                  <div style={legendRow}><span style={dot('#10B981')}></span> SAR Mask</div>
                  <div style={legendRow}><span style={dot('#F59E0B')}></span> Village (illustrative)</div>
                  <div style={legendRow}><span style={dot('#38BDF8')}></span> Road (illustrative)</div>
                  <div style={legendRow}><span style={dot('#A855F7')}></span> Bridge (illustrative)</div>
                  <div style={legendRow}><span style={dot('#EC4899')}></span> Hospital / School (illustrative)</div>
                </div>
              </>
            )}
          </div>

          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40px', background: '#0B111E', borderTop: '1px solid #1E293B', display: 'flex', alignItems: 'center', padding: '0 14px', gap: '10px', zIndex: 1000 }}>
            {isValidated ? (
              <span style={{ fontSize: '10px', color: '#94A3B8' }}>
                Showing the maximum depth reached over the whole simulated period (15 h). There is no time animation for this view.
              </span>
            ) : (
              <>
                <button onClick={() => setIsPlaying(!isPlaying)} style={{ background: '#2563EB', color: '#FFF', border: 'none', borderRadius: '3px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px' }}>
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <button onClick={() => setCurrentTimeStep(0)} style={{ background: '#131B2E', color: '#94A3B8', border: 'none', borderRadius: '3px', padding: '4px 6px', cursor: 'pointer', fontSize: '10px' }}>
                  ↺ 00:00
                </button>
                <input
                  type="range" min="0" max={simDuration} value={currentTimeStep}
                  onChange={(e) => setCurrentTimeStep(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#38BDF8', minWidth: '55px' }}>T+{currentTimeStep} min</span>
                <div style={{ display: 'flex', gap: '3px' }}>
                  {[1, 2, 4].map(s => (
                    <button
                      key={s}
                      onClick={() => setPlaybackSpeed(s)}
                      style={{
                        background: playbackSpeed === s ? '#2563EB' : '#131B2E',
                        color: playbackSpeed === s ? '#FFF' : '#94A3B8',
                        border: 'none', borderRadius: '2px', padding: '2px 5px', fontSize: '9px', cursor: 'pointer'
                      }}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ width: '280px', background: '#0B111E', borderLeft: '1px solid #1E293B', display: 'flex', flexDirection: 'column', padding: '10px', gap: '8px', overflowY: 'auto', flexShrink: 0 }}>

          {isValidated && (
            <div style={{ background: '#2A1A05', border: '1px solid #92400E', borderRadius: '4px', padding: '8px' }}>
              <div style={{ fontSize: '9px', fontWeight: 800, color: '#FDE68A', marginBottom: '4px' }}>READ BEFORE USING THESE RESULTS</div>
              <div style={{ fontSize: '9px', color: '#FDE68A', marginBottom: '4px' }}>
                Peak {Number(vScenario.peak_flow_m3s).toLocaleString()} m³/s at {vScenario.time_to_peak_h} h • {vScenario.volume_released_km3} km³ released
              </div>
              <ul style={{ margin: 0, paddingLeft: '14px', fontSize: '9px', color: '#FCD34D', lineHeight: 1.4 }}>
                {(hidkalSummary.notes || []).map((n, i) => <li key={i}>{n}</li>)}
              </ul>
              {hidkalSummary.validation?.note && (
                <div style={{ fontSize: '9px', color: '#FDE68A', marginTop: '4px' }}>{hidkalSummary.validation.note}</div>
              )}
            </div>
          )}

          {!isValidated && !simData && !loadingSim && (
            <div style={{ fontSize: '9px', color: '#94A3B8', ...card }}>
              {simError || 'No simulation results yet. Press “Run Simulation”.'}
            </div>
          )}

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <div style={kpiBox}>
              <div style={{ fontSize: '9px', color: '#64748B' }}>{isValidated ? 'FLOOD AREA (MIN.)' : 'FLOOD AREA'}</div>
              <div style={kpiNum('#38BDF8')}>{isValidated ? vScenario.flood_area_km2 : kpi.area} <span style={unitStyle}>km²</span></div>
            </div>
            <div style={kpiBox}>
              <div style={{ fontSize: '9px', color: '#64748B' }}>{isValidated ? 'AREA DEEPER THAN 5 m' : 'MAX DEPTH'}</div>
              <div style={kpiNum('#06B6D4')}>{isValidated ? (vDeepArea ?? '—') : kpi.depth} <span style={unitStyle}>{isValidated ? 'km²' : 'm'}</span></div>
            </div>
            <div style={kpiBox}>
              <div style={{ fontSize: '9px', color: '#64748B' }}>MAX VELOCITY</div>
              <div style={kpiNum('#F59E0B')}>{isValidated ? 'n/a' : kpi.vel} <span style={unitStyle}>{isValidated || typeof kpi.vel !== 'number' ? '' : 'm/s'}</span></div>
            </div>
            <div style={kpiBox}>
              <div style={{ fontSize: '9px', color: '#64748B' }}>{isValidated ? 'PEOPLE IN FLOOD AREA' : 'POP. EXPOSED'}</div>
              <div style={kpiNum('#EF4444')}>{isValidated ? (vTotal ? Number(vTotal.people).toLocaleString() : '—') : kpi.pop}</div>
            </div>
          </div>

          {isValidated ? (
            <>
              <div style={card}>
                <div style={{ fontSize: '9px', fontWeight: 800, color: '#64748B', marginBottom: '6px' }}>PEOPLE EXPOSED BY MAX FLOOD DEPTH</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {vScenario.exposure_by_depth.filter(r => r.depth_class !== 'TOTAL').map((r, i) => (
                    <div key={r.depth_class} style={{ borderLeft: `3px solid ${DEPTH_CLASSES[i]?.color || '#64748B'}`, background: '#0B111E', padding: '4px 6px', borderRadius: '3px', display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                      <span style={{ color: '#CBD5E1' }}>{r.depth_class}</span>
                      <span style={{ fontWeight: 800, color: '#FFF' }}>{Number(r.people).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '8px', color: '#64748B', marginTop: '4px' }}>
                  People from WorldPop 2020 (modelled estimate). Counts are people inside the flood footprint, not casualties.
                </div>
              </div>

              <div style={card}>
                <div style={{ fontSize: '9px', fontWeight: 800, color: '#64748B', marginBottom: '4px' }}>LOSS & DAMAGE EXPOSURE</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '9px', color: '#CBD5E1' }}>
                  <div>Cropland: <b>{vTotal ? vTotal.cropland_km2 : '—'} km²</b></div>
                  <div>Built-up: <b>{vTotal ? vTotal.builtup_km2 : '—'} km²</b></div>
                  <div style={{ gridColumn: 'span 2', color: '#64748B' }}>
                    Roads, bridges, hospitals and schools are not analysed in the validated run. Land cover is ESA WorldCover 2021.
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={card}>
                <div style={{ fontSize: '9px', fontWeight: 800, color: '#64748B', marginBottom: '6px' }}>HADR RESPONSE</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ background: '#450A0A', borderLeft: '3px solid #EF4444', padding: '4px 6px', borderRadius: '3px', display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                    <span style={{ color: '#FCA5A5' }}>P1 Evacuation required</span>
                    <span style={{ fontWeight: 800, color: '#FFF' }}>{fmtVal(hadr.p1)}</span>
                  </div>
                  <div style={{ background: '#451A03', borderLeft: '3px solid #F59E0B', padding: '4px 6px', borderRadius: '3px', display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                    <span style={{ color: '#FDE68A' }}>P2 Monitor and prepare</span>
                    <span style={{ fontWeight: 800, color: '#FFF' }}>{fmtVal(hadr.p2)}</span>
                  </div>
                  <div style={{ background: '#022C22', borderLeft: '3px solid #10B981', padding: '4px 6px', borderRadius: '3px', display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                    <span style={{ color: '#A7F3D0' }}>P3 Safe / unaffected</span>
                    <span style={{ fontWeight: 800, color: '#FFF' }}>{fmtVal(hadr.p3)}</span>
                  </div>
                </div>
                <div style={{ fontSize: '8px', color: '#64748B', marginTop: '4px' }}>
                  Predicted first arrival: {hadr.first_arrival_min != null ? `${hadr.first_arrival_min} min` : '—'} | Est. exposed: {kpi.pop} | Infra: {hadr.infra_sites != null ? `${hadr.infra_sites} sites` : '—'}
                </div>
              </div>

              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#64748B' }}>SCENARIO COMPARISON</span>
                  <button onClick={saveCurrentScenario} style={{ background: '#1E293B', border: '1px solid #334155', color: '#38BDF8', padding: '2px 5px', borderRadius: '3px', fontSize: '8px', cursor: 'pointer' }}>
                    💾 Save Scenario
                  </button>
                </div>
                {scenarioToast && <div style={{ color: '#34D399', fontSize: '8px', marginBottom: '4px' }}>✓ Scenario saved</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '9px' }}>
                  {savedScenarios.map((sc, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8' }}>
                      <span style={{ color: '#E2E8F0' }}>{sc.name}</span>
                      <span>{sc.area} • {sc.depth} • {sc.pop}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 800, color: '#64748B', marginBottom: '4px' }}>
                  <span>LOSS & DAMAGE EXPOSURE</span>
                  {loss.zones != null && <span style={{ color: '#F59E0B' }}>▲ {loss.zones} zones detected</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '9px', color: '#CBD5E1' }}>
                  <div>Roads cut: <b>{loss.roads_km != null ? `${loss.roads_km} km` : '—'}</b></div>
                  <div>Cropland: <b>{loss.cropland_ha != null ? `${loss.cropland_ha} ha` : '—'}</b></div>
                  <div>Hospitals: <b>{fmtVal(loss.hospitals)}</b></div>
                  <div>Critical sites: <b>{loss.critical_sites != null ? `${loss.critical_sites} sites` : '—'}</b></div>
                </div>
              </div>
            </>
          )}

          {/* Field observations */}
          <div style={card}>
            <div style={{ fontSize: '9px', fontWeight: 800, color: '#64748B', marginBottom: '6px' }}>FIELD OBSERVATIONS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '4px' }}>
              <input type="text" placeholder="Obs Water Level (m)" value={fieldObs.waterLevel} onChange={(e) => setFieldObs({ ...fieldObs, waterLevel: e.target.value })} style={miniInput} />
              <input type="text" placeholder="Rainfall (mm/h)" value={fieldObs.rainfall} onChange={(e) => setFieldObs({ ...fieldObs, rainfall: e.target.value })} style={miniInput} />
              <input type="text" placeholder="Lat" value={fieldObs.lat} onChange={(e) => setFieldObs({ ...fieldObs, lat: e.target.value })} style={miniInput} />
              <input type="text" placeholder="Lon" value={fieldObs.lon} onChange={(e) => setFieldObs({ ...fieldObs, lon: e.target.value })} style={miniInput} />
            </div>
            <select
              value={fieldObs.severity}
              onChange={(e) => setFieldObs({ ...fieldObs, severity: e.target.value })}
              style={{ ...miniInput, width: '100%', marginBottom: '4px' }}
            >
              {['Minor', 'Moderate', 'Severe', 'Critical'].map(s => <option key={s} value={s}>Severity: {s}</option>)}
            </select>
            <textarea
              placeholder="Describe field conditions, breaches..."
              rows={2}
              value={fieldObs.notes}
              onChange={(e) => setFieldObs({ ...fieldObs, notes: e.target.value })}
              style={{ ...miniInput, width: '100%', padding: '4px', resize: 'none' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '4px 0', fontSize: '9px', color: '#94A3B8' }}>
              <input type="checkbox" checked={fieldObs.relayNDRF} onChange={() => setFieldObs({ ...fieldObs, relayNDRF: !fieldObs.relayNDRF })} />
              Relay to NDRF Control
            </div>
            <button
              onClick={submitObservation}
              disabled={obsSubmitting}
              style={{ width: '100%', padding: '5px', background: '#2563EB', color: '#FFF', border: 'none', borderRadius: '3px', fontWeight: 700, fontSize: '9px', cursor: obsSubmitting ? 'wait' : 'pointer' }}
            >
              {obsSubmitting ? 'Submitting...' : obsSubmitted ? '✓ Submitted' : 'Submit Observation'}
            </button>
          </div>

          {/* Export */}
          <div style={card}>
            <div style={{ fontSize: '9px', fontWeight: 800, color: '#64748B', marginBottom: '6px' }}>EXPORT RESULTS</div>
            {isValidated ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '4px' }}>
                <button onClick={() => window.open(`${API_BASE}/validated/hidkal/${hidkalScenario}`, '_blank')} style={exportBtn()}>
                  ⬇ Export GeoJSON (validated run)
                </button>
                <div style={{ fontSize: '8px', color: '#64748B' }}>
                  KML and SHP of the validated run are in the project files (hidkal_flood_extent). They are not served by the API yet.
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                <button onClick={() => window.open(`${API_BASE}/download-kml?dam_name=${encodeURIComponent(selectedDam)}`, '_blank')} style={exportBtn()}>
                  ⬇ Export KML
                </button>
                <button onClick={() => window.open(`${API_BASE}/download-shapefile?dam_name=${encodeURIComponent(selectedDam)}`, '_blank')} style={exportBtn()}>
                  ⬇ Export SHP
                </button>
                <button onClick={exportGeoJSON} disabled={!fs?.geojson} style={exportBtn('#CBD5E1', !fs?.geojson)}>
                  ⬇ Export GeoJSON
                </button>
                <button onClick={() => window.open(`${API_BASE}/download-raster?dam_name=${encodeURIComponent(selectedDam)}`, '_blank')} style={exportBtn('#CBD5E1')}>
                  ⬇ Export Raster
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}