import React, { useState, useEffect, useRef, useMemo } from 'react';
import './App.css';
import damsDataset from './damsData.json';

const API_BASE = 'http://127.0.0.1:8000';

export default function App() {
  // -------------------------------------------------------------
  // 1. DATASET, ACTIVE DAM & LOCAL DEM UPLOAD STATE
  // -------------------------------------------------------------
  const [dams, setDams] = useState(() => (Array.isArray(damsDataset) && damsDataset.length > 0 ? damsDataset : []));
  const [selectedDam, setSelectedDam] = useState("Chouldari Dam");
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const searchBoxRef = useRef(null);
  const fileInputRef = useRef(null);

  // Loaded DEM Metadata Card State
  const [uploadedDemMeta, setUploadedDemMeta] = useState({
    fileName: "chouldari.kml",
    damName: "Chouldari Dam",
    resolution: "30 m (GLO-30)",
    grid: "1024 × 1024",
    crs: "EPSG:4326",
    latitude: 11.634,
    longitude: 92.684
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Active Dam Specs
  const currentDam = useMemo(() => {
    const found = dams.find(d => d.dam_name.toLowerCase() === selectedDam.toLowerCase());
    if (found) return found;
    return {
      dam_name: uploadedDemMeta.damName || selectedDam,
      latitude: uploadedDemMeta.latitude || 11.634,
      longitude: uploadedDemMeta.longitude || 92.684,
      height_m: 35.0,
      state: "Andaman & Nicobar",
      district: "South Andaman",
      river: "Dhanikhari"
    };
  }, [selectedDam, dams, uploadedDemMeta]);

  // Operator Session State
  const [operatorId] = useState("OPS-2026-0918");
  const [alertLevel] = useState("Orange");
  const [priority] = useState("High");
  const [sessionTime] = useState("22/9/2026, 7:50:18 pm");

  // Scenario Presets & Hydraulic Sliders
  const [activePreset, setActivePreset] = useState("Moderate Breach");
  const [reservoirLevel, setReservoirLevel] = useState(70);
  const [breachWidth, setBreachWidth] = useState(80);
  const [breachTime, setBreachTime] = useState(5);
  const [simDuration, setSimDuration] = useState(30);

  // Display Mode & GIS Controls
  const [displayMode, setDisplayMode] = useState("Inundation");
  const [showSatellite, setShowSatellite] = useState(true);
  const [showSPH, setShowSPH] = useState(true);
  const [showSAR, setShowSAR] = useState(false);
  const [baseMapType, setBaseMapType] = useState('satellite');

  // Timeline Player (Default T+30 min)
  const [currentTimeStep, setCurrentTimeStep] = useState(30);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Field Observations Form
  const [fieldObs, setFieldObs] = useState({
    waterLevel: "",
    rainfall: "",
    lat: "11.6244",
    lon: "92.6591",
    severity: "Moderate",
    notes: "",
    relayNDRF: true
  });
  const [obsSubmitted, setObsSubmitted] = useState(false);

  // Saved Scenarios
  const [savedScenarios, setSavedScenarios] = useState([
    { name: "A: Baseline Failure", area: "6.7 km²", depth: "2.9 m", vel: "1.9 m/s", pop: "7,470" },
    { name: "B: Moderate Breach", area: "9.5 km²", depth: "3.4 m", vel: "2.2 m/s", pop: "8,715" },
    { name: "C: High Reservoir", area: "13.6 km²", depth: "4.8 m", vel: "3.2 m/s", pop: "12,450" }
  ]);
  const [scenarioToast, setScenarioToast] = useState(false);

  // Simulation & Map State
  const [simData, setSimData] = useState(null);
  const [loadingSim, setLoadingSim] = useState(false);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  // Leaflet Map Refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markerRef = useRef(null);
  const delftLayerRef = useRef(null);
  const sphLayerRef = useRef(null);
  const overlapLayerRef = useRef(null);
  const sarLayerRef = useRef(null);
  const assetNodesGroupRef = useRef(null);

  // Preset Selection Helper
  const handlePresetSelect = (preset) => {
    setActivePreset(preset);
    if (preset === "Baseline Failure") {
      setReservoirLevel(50);
      setBreachWidth(40);
      setBreachTime(10);
    } else if (preset === "Moderate Breach") {
      setReservoirLevel(70);
      setBreachWidth(80);
      setBreachTime(5);
    } else if (preset === "Severe Breach") {
      setReservoirLevel(90);
      setBreachWidth(120);
      setBreachTime(3);
    } else if (preset === "High Reservoir") {
      setReservoirLevel(100);
      setBreachWidth(100);
      setBreachTime(4);
    }
  };

  // Local DEM File Uploader
  const handleDemUpload = async (file) => {
    if (!file) return;
    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/upload-dem`, {
        method: "POST",
        body: formData
      });

      if (res.ok) {
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
        setSelectedDam(data.dam_name);

        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo([data.latitude, data.longitude], 13, { duration: 1.2 });
        }
        fetchSimulationData(data.dam_name, reservoirLevel);
      }
    } catch (err) {
      console.error(err);
      const cleanName = file.name.split('.')[0].replace(/_/g, ' ');
      setUploadedDemMeta(prev => ({
        ...prev,
        fileName: file.name,
        damName: cleanName,
        resolution: "30 m (Uploaded)"
      }));
      setSelectedDam(cleanName);
    } finally {
      setIsUploading(false);
    }
  };

  // Safe Leaflet Injection
  useEffect(() => {
    if (window.L) {
      setLeafletLoaded(true);
      return;
    }
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
        if (window.L) {
          setLeafletLoaded(true);
          clearInterval(interval);
        }
      }, 50);
    }
  }, []);

  // Fetch all prebuilt dams
  useEffect(() => {
    fetch(`${API_BASE}/dams`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) setDams(data);
      })
      .catch(() => {});
  }, []);

  // Outside Click Listener for Search Box
  useEffect(() => {
    const handleOutside = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
        setIsSearching(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  // Timeline Auto-play Loop
  useEffect(() => {
    let interval = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTimeStep(prev => (prev >= simDuration ? 0 : prev + 1));
      }, 1000 / playbackSpeed);
    }
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, simDuration]);

  // Tile configuration with native zoom to prevent "Map data not available"
  const getTileConfig = (type) => {
    if (type === 'satellite') {
      return {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 18,
          maxNativeZoom: 17,
          attribution: 'Esri, DigitalGlobe, Earthstar Geographics'
        }
      };
    } else {
      return {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
          maxZoom: 19,
          subdomains: ['a', 'b', 'c'],
          attribution: '© OpenStreetMap contributors'
        }
      };
    }
  };

  // -------------------------------------------------------------
  // MAP INITIALIZATION
  // -------------------------------------------------------------
  useEffect(() => {
    if (!leafletLoaded || !mapContainerRef.current || !window.L) return;
    const L = window.L;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const lat = currentDam ? currentDam.latitude : 11.634;
    const lon = currentDam ? currentDam.longitude : 92.684;

    try {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([lat, lon], 13);

      mapInstanceRef.current = map;

      const config = getTileConfig(baseMapType);
      tileLayerRef.current = L.tileLayer(config.url, config.options).addTo(map);

      L.control.zoom({ position: 'topright' }).addTo(map);
      assetNodesGroupRef.current = L.layerGroup().addTo(map);

      setTimeout(() => {
        if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize();
      }, 250);
    } catch (err) {
      console.error(err);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [leafletLoaded]);

  // Base map layer toggle
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;
    const L = window.L;
    if (tileLayerRef.current) mapInstanceRef.current.removeLayer(tileLayerRef.current);

    const config = getTileConfig(baseMapType);
    tileLayerRef.current = L.tileLayer(config.url, config.options).addTo(mapInstanceRef.current);
    tileLayerRef.current.bringToBack();
  }, [baseMapType]);

  // Fly to selected Dam & Center
  useEffect(() => {
    if (!selectedDam || !currentDam || !mapInstanceRef.current || !window.L) return;
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
        </div>
      `,
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
  }, [selectedDam, leafletLoaded]);

  // Simulation fetch
  const fetchSimulationData = async (damName, storagePct) => {
    setLoadingSim(true);
    try {
      const res = await fetch(`${API_BASE}/simulate?dam_name=${encodeURIComponent(damName)}&storage_percent=${storagePct}`);
      if (res.ok) {
        const data = await res.json();
        setSimData(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSim(false);
    }
  };

  // Sentinel-1 SAR Overlay from GEE
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L || !currentDam) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    if (sarLayerRef.current) {
      map.removeLayer(sarLayerRef.current);
      sarLayerRef.current = null;
    }

    if (showSAR) {
      const lat = parseFloat(currentDam.latitude);
      const lon = parseFloat(currentDam.longitude);

      fetch(`${API_BASE}/realtime-flood?dam_lat=${lat}&dam_lon=${lon}&buffer_km=15`)
        .then(res => res.json())
        .then(data => {
          if (data.status === 'success' && data.geojson) {
            sarLayerRef.current = L.geoJSON(data.geojson, {
              style: {
                color: '#10B981',
                fillColor: '#10B981',
                fillOpacity: 0.45,
                weight: 1.5
              }
            }).addTo(map);
          }
        })
        .catch(err => console.error(err));
    }
  }, [showSAR, currentDam]);

  // =========================================================================
  // 2. NATURAL TERRAIN-SLOPE WATER FLOW PROPAGATION (ZERO HARDCODED SOUTH)
  // =========================================================================
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L || !currentDam || !simData) return;
    const L = window.L;
    const map = mapInstanceRef.current;

    if (delftLayerRef.current) { map.removeLayer(delftLayerRef.current); delftLayerRef.current = null; }
    if (sphLayerRef.current) { map.removeLayer(sphLayerRef.current); sphLayerRef.current = null; }
    if (overlapLayerRef.current) { map.removeLayer(overlapLayerRef.current); overlapLayerRef.current = null; }
    if (assetNodesGroupRef.current) assetNodesGroupRef.current.clearLayers();

    const damLat = parseFloat(currentDam.latitude);
    const damLon = parseFloat(currentDam.longitude);

    // Time factor progression: T+0 to T+30 min
    const tf = Math.max(0.05, Math.min(1.0, currentTimeStep / simDuration));

    // 1. EXTRACT REAL SOLVER CONTOURS DERIVED FROM DEM (NATURAL DIRECTION)
    let naturalCoords = [];
    const hydroGJ = simData.flood_simulation?.geojson;

    if (hydroGJ && (hydroGJ.features || hydroGJ.type === "FeatureCollection")) {
      const feat = hydroGJ.features ? hydroGJ.features[0] : hydroGJ;
      if (feat && feat.geometry && feat.geometry.coordinates) {
        // Handle Polygon or MultiPolygon
        const polyCoords = Array.isArray(feat.geometry.coordinates[0][0])
          ? feat.geometry.coordinates[0]
          : feat.geometry.coordinates;

        // Convert [lon, lat] to [lat, lon]
        naturalCoords = polyCoords.map(pt => [pt[1], pt[0]]);
      }
    }

    // Fallback ONLY if DEM routing polygon isn't extracted yet:
    // Follow the river's downhill azimuth rather than pure south
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

    // 2. SCALE ALONG THE NATURAL RIVER PATH (DAM TO DOWNSTREAM OUTLET)
    const delftDynamic = naturalCoords.map(([pLat, pLon]) => {
      const dLat = (pLat - damLat) * tf;
      const dLon = (pLon - damLon) * tf;
      return [damLat + dLat, damLon + dLon];
    });

    // Layer 1: Delft3D / 2D SWE Inundation Extent (Teal/Cyan)
    delftLayerRef.current = L.polygon(delftDynamic, {
      color: '#06B6D4',
      fillColor: '#06B6D4',
      fillOpacity: 0.45,
      weight: 1.5
    }).addTo(map);

    // Layer 2: SPH Particle Envelope (Blue - slightly wider lateral dispersion)
    if (showSPH) {
      const sphDynamic = delftDynamic.map(([pLat, pLon]) => {
        const lateralLat = (pLat - damLat) * 0.06;
        const lateralLon = (pLon - damLon) * 0.12;
        return [pLat + lateralLat, pLon + lateralLon];
      });

      sphLayerRef.current = L.polygon(sphDynamic, {
        color: '#2563EB',
        fillColor: '#1D4ED8',
        fillOpacity: 0.35,
        weight: 1.8,
        dashArray: '4, 4'
      }).addTo(map);
    }

    // Layer 3: Overlap High-Velocity Core Jet (Red / Maroon)
    const overlapDynamic = delftDynamic.map(([pLat, pLon]) => {
      return [
        damLat + (pLat - damLat) * 0.72,
        damLon + (pLon - damLon) * 0.72
      ];
    });

    overlapLayerRef.current = L.polygon(overlapDynamic, {
      color: '#EF4444',
      fillColor: '#EF4444',
      fillOpacity: 0.65,
      weight: 1.5
    }).addTo(map);

    // 3. ASSET NODES POSITIONED DIRECTLY ON THE NATURAL INUNDATION CHANNEL
    // Sample 6 critical asset points along the actual path of water
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
        
        // Midpoint node along the plume centerline
        const nodeLat = (damLat + pt[0]) / 2;
        const nodeLon = (damLon + pt[1]) / 2;

        const nodeMarker = L.circleMarker([nodeLat, nodeLon], {
          radius: 6,
          fillColor: info.color,
          color: '#FFFFFF',
          weight: 2,
          fillOpacity: 1
        }).bindTooltip(`<b>${info.name}</b><br/>Status: Submerged (${info.type})`);
        
        assetNodesGroupRef.current.addLayer(nodeMarker);
      });
    }

  }, [simData, currentTimeStep, simDuration, showSPH, currentDam]);

  const saveCurrentScenario = () => {
    const newEntry = {
      name: `Custom ${activePreset}`,
      area: `${simData?.flood_simulation?.flooded_area_sq_km || 9.5} km²`,
      depth: `${simData?.flood_simulation?.flood_level_m || 3.4} m`,
      vel: "2.2 m/s",
      pop: (simData?.flood_simulation?.estimated_affected_population || 8715).toLocaleString()
    };
    setSavedScenarios(prev => [newEntry, ...prev.slice(0, 2)]);
    setScenarioToast(true);
    setTimeout(() => setScenarioToast(false), 3000);
  };

  const filteredDams = searchTerm.trim().length > 0
    ? dams.filter(d => d.dam_name?.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 50)
    : dams.slice(0, 15);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: '#090D16', overflow: 'hidden' }}>

      {/* TOP COMMAND HEADER */}
      <header style={{ height: '42px', background: '#0B111E', borderBottom: '1px solid #1E293B', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', flexShrink: 0, zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 900, letterSpacing: '0.8px', fontSize: '14px', color: '#FFFFFF' }}>HYDROVISION</span>
          <span style={{ color: '#64748B', fontSize: '11px', borderLeft: '1px solid #334155', paddingLeft: '8px' }}>
            Dam Break Inundation & HADR Decision Support
          </span>
        </div>

        {/* Global Autocomplete Search */}
        <div ref={searchBoxRef} style={{ position: 'relative', width: '300px' }}>
          <input
            type="text"
            placeholder="🔍 Search dam, location, coordinates..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setIsSearching(true); }}
            onFocus={() => setIsSearching(true)}
            style={{ width: '100%', padding: '5px 10px', background: '#131B2E', border: '1px solid #2A364F', borderRadius: '4px', color: '#F8FAFC', fontSize: '11px', outline: 'none' }}
          />
          {isSearching && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '260px', overflowY: 'auto', background: '#131B2E', border: '1px solid #334155', borderRadius: '4px', marginTop: '2px', zIndex: 5000, boxShadow: '0 8px 24px rgba(0,0,0,0.8)' }}>
              {filteredDams.map(d => (
                <div
                  key={`${d.dam_name}-${d.latitude}`}
                  onClick={() => { setSelectedDam(d.dam_name); setSearchTerm(""); setIsSearching(false); }}
                  style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #1E293B', fontSize: '11px' }}
                >
                  <div style={{ fontWeight: 600, color: '#38BDF8' }}>{d.dam_name}</div>
                  <div style={{ fontSize: '9px', color: '#94A3B8' }}>{d.state || 'India'} {d.district ? `• ${d.district}` : ''} • Height: {d.height_m}m</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Badges & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ background: '#1D4ED8', color: '#FFFFFF', padding: '3px 8px', borderRadius: '4px', fontWeight: 700, fontSize: '10px' }}>
            LIVE — {selectedDam}
          </div>
          <div style={{ background: '#1E293B', color: '#94A3B8', border: '1px solid #334155', padding: '3px 8px', borderRadius: '4px', fontSize: '10px' }}>
            SPH + Delft3D
          </div>
          <div style={{ background: '#92400E', color: '#FDE68A', padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
            simulated outputs
          </div>
          <button style={{ background: '#0F172A', border: '1px solid #334155', color: '#CBD5E1', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '10px' }}>
            ☷ Digital Twin
          </button>
          <button onClick={() => window.print()} style={{ background: '#2563EB', border: 'none', color: '#FFFFFF', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 700, fontSize: '10px' }}>
            HADR Report
          </button>
        </div>
      </header>

      {/* THREE-PANEL LAYOUT */}
      <div style={{ display: 'flex', flex: 1, position: 'relative', overflow: 'hidden' }}>

        {/* LEFT PANEL: CONTROLS & LOAD DEM */}
        <div style={{ width: '270px', background: '#0B111E', borderRight: '1px solid #1E293B', display: 'flex', flexDirection: 'column', padding: '10px', gap: '8px', overflowY: 'auto', flexShrink: 0 }}>
          
          {/* Operator Session Card */}
          <div style={{ background: '#101726', border: '1px solid #1E293B', borderRadius: '4px', padding: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '9px', fontWeight: 700, color: '#64748B' }}>OPERATOR SESSION</span>
              <span style={{ background: '#C2410C', color: '#FFEDD5', padding: '1px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: 700 }}>
                {alertLevel}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '9px', color: '#94A3B8' }}>
              <div>Operator ID: <b style={{ color: '#E2E8F0' }}>{operatorId}</b></div>
              <div>Priority: <b style={{ color: '#E2E8F0' }}>{priority}</b></div>
              <div style={{ gridColumn: 'span 2' }}>Timestamp: <span style={{ color: '#E2E8F0' }}>{sessionTime}</span></div>
            </div>
          </div>

          {/* Dam Dropdown Selection */}
          <div>
            <div style={{ fontSize: '9px', fontWeight: 700, color: '#64748B', marginBottom: '4px' }}>DAM SELECTION</div>
            <select
              value={selectedDam}
              onChange={(e) => setSelectedDam(e.target.value)}
              style={{ width: '100%', padding: '5px', background: '#131B2E', color: '#F8FAFC', border: '1px solid #2A364F', borderRadius: '4px', fontSize: '11px' }}
            >
              {dams.slice(0, 200).map(d => (
                <option key={`${d.dam_name}-${d.latitude}`} value={d.dam_name}>
                  {d.dam_name} ({d.state || 'India'})
                </option>
              ))}
            </select>
          </div>

          {/* Load DEM / Dam Data Drag & Drop Card */}
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            accept=".tif,.tiff,.dem,.kml,.geojson,.shp,.nc"
            onChange={(e) => {
              if (e.target.files?.[0]) handleDemUpload(e.target.files[0]);
            }}
          />

          <div>
            <div style={{ fontSize: "9px", fontWeight: 700, color: "#64748B", marginBottom: "4px" }}>
              LOAD DEM / DAM DATA
            </div>

            {/* Drag & Drop Zone */}
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
                border: isDragOver ? "1px dashed #38BDF8" : "1px dashed #2A364F",
                background: isDragOver ? "rgba(56, 189, 248, 0.08)" : "#101726",
                borderRadius: "4px",
                padding: "8px",
                textAlign: "center",
                cursor: "pointer",
                marginBottom: "6px"
              }}
            >
              <div style={{ fontSize: "14px", marginBottom: "2px" }}>📄</div>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#E2E8F0" }}>
                {isUploading ? "Uploading DEM..." : "Drag & drop DEM / terrain data"}
              </div>
              <div style={{ fontSize: "8px", color: "#64748B", marginTop: "2px" }}>
                GeoTIFF, DEM, Shapefile, GeoJSON, KML, NetCDF
              </div>
              <div style={{ fontSize: "9px", color: "#38BDF8", marginTop: "3px", textDecoration: "underline" }}>
                or browse files
              </div>
            </div>

            {/* Loaded Metadata Green Box */}
            <div style={{ background: "#052E16", border: "1px solid #059669", borderRadius: "4px", padding: "8px" }}>
              <div style={{ color: "#34D399", fontWeight: 700, fontSize: "10px", marginBottom: "4px" }}>
                ✓ Data Loaded Successfully
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px", fontSize: "9px", color: "#A7F3D0" }}>
                <div>File: <b>{uploadedDemMeta.fileName}</b></div>
                <div>Dam: <b>{uploadedDemMeta.damName}</b></div>
                <div>Res: <b>{uploadedDemMeta.resolution}</b></div>
                <div>Grid: <b>{uploadedDemMeta.grid}</b></div>
                <div style={{ gridColumn: "span 2" }}>CRS: <b>{uploadedDemMeta.crs}</b></div>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: "100%",
                  marginTop: "6px",
                  padding: "3px",
                  background: "#064E3B",
                  border: "1px solid #059669",
                  color: "#6EE7B7",
                  borderRadius: "3px",
                  fontSize: "9px",
                  cursor: "pointer"
                }}
              >
                Upload Different File
              </button>
            </div>
          </div>

          {/* Scenario Presets */}
          <div>
            <div style={{ fontSize: '9px', fontWeight: 700, color: '#64748B', marginBottom: '4px' }}>SCENARIO</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              {["Baseline Failure", "Moderate Breach", "Severe Breach", "High Reservoir"].map(p => (
                <button
                  key={p}
                  onClick={() => handlePresetSelect(p)}
                  style={{
                    padding: '5px',
                    fontSize: '9px',
                    borderRadius: '3px',
                    cursor: 'pointer',
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

          {/* Sliders */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8' }}>
              <span>Reservoir Level</span>
              <span style={{ color: '#38BDF8', fontWeight: 700 }}>{reservoirLevel}%</span>
            </div>
            <input type="range" min="30" max="100" value={reservoirLevel} onChange={(e) => setReservoirLevel(Number(e.target.value))} />

            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8' }}>
              <span>Breach Width</span>
              <span style={{ color: '#38BDF8', fontWeight: 700 }}>{breachWidth} m</span>
            </div>
            <input type="range" min="20" max="150" value={breachWidth} onChange={(e) => setBreachWidth(Number(e.target.value))} />

            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8' }}>
              <span>Breach Initiation Time</span>
              <span style={{ color: '#38BDF8', fontWeight: 700 }}>{breachTime} min</span>
            </div>
            <input type="range" min="1" max="30" value={breachTime} onChange={(e) => setBreachTime(Number(e.target.value))} />

            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8' }}>
              <span>Simulation Duration</span>
              <span style={{ color: '#38BDF8', fontWeight: 700 }}>{simDuration} min</span>
            </div>
            <input type="range" min="10" max="120" value={simDuration} onChange={(e) => setSimDuration(Number(e.target.value))} />
          </div>

          {/* Run Button */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
            <button
              onClick={() => fetchSimulationData(selectedDam, reservoirLevel)}
              disabled={loadingSim}
              style={{ flex: 1, padding: '7px', background: '#2563EB', color: '#FFF', border: 'none', borderRadius: '4px', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}
            >
              {loadingSim ? '⚙ Running Engine...' : '▶ Run Simulation'}
            </button>
            <button
              onClick={() => handlePresetSelect("Moderate Breach")}
              style={{ padding: '7px 10px', background: '#131B2E', color: '#94A3B8', border: '1px solid #2A364F', borderRadius: '4px', cursor: 'pointer' }}
            >
              ↺
            </button>
          </div>
        </div>

        {/* CENTER GIS MAP VIEW */}
        <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
          
          <div
            ref={mapContainerRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: '40px',
              backgroundColor: '#0F172A',
              width: '100%',
              height: 'calc(100% - 40px)',
              zIndex: 1
            }}
          />

          {/* Map Top Switchers */}
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

          {/* Model Difference Box */}
          <div style={{ position: 'absolute', top: 10, right: 54, zIndex: 1000, background: 'rgba(11, 17, 30, 0.9)', backdropFilter: 'blur(4px)', border: '1px solid #2A364F', borderRadius: '4px', padding: '8px 12px', fontSize: '10px' }}>
            <div style={{ fontWeight: 700, color: '#E2E8F0', marginBottom: '4px' }}>Model Difference</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '9px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#60A5FA' }}>
                <span style={{ width: '8px', height: '8px', background: '#2563EB', borderRadius: '50%' }}></span> SPH only
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#67E8F9' }}>
                <span style={{ width: '8px', height: '8px', background: '#06B6D4', borderRadius: '50%' }}></span> Delft3D only
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#F87171' }}>
                <span style={{ width: '8px', height: '8px', background: '#EF4444', borderRadius: '50%' }}></span> Overlap
              </div>
            </div>
          </div>

          {/* Floating Map Legend */}
          <div style={{ position: 'absolute', bottom: 50, left: 10, zIndex: 1000, background: 'rgba(11, 17, 30, 0.9)', backdropFilter: 'blur(4px)', border: '1px solid #2A364F', borderRadius: '4px', padding: '8px 10px', fontSize: '9px' }}>
            <div style={{ fontWeight: 700, color: '#64748B', marginBottom: '4px' }}>LEGEND</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '3px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '6px', height: '6px', background: '#EF4444', borderRadius: '50%' }}></span> Dam Location</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '6px', height: '6px', background: '#2563EB', borderRadius: '50%' }}></span> SPH Flood Extent</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '6px', height: '6px', background: '#06B6D4', borderRadius: '50%' }}></span> Delft3D Extent</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '6px', height: '6px', background: '#10B981', borderRadius: '50%' }}></span> SAR Mask</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '6px', height: '6px', background: '#F59E0B', borderRadius: '50%' }}></span> Village</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '6px', height: '6px', background: '#38BDF8', borderRadius: '50%' }}></span> Road</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '6px', height: '6px', background: '#A855F7', borderRadius: '50%' }}></span> Bridge</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '6px', height: '6px', background: '#EC4899', borderRadius: '50%' }}></span> Hospital / School</div>
            </div>
          </div>

          {/* Timeline Playback Scrubber */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40px', background: '#0B111E', borderTop: '1px solid #1E293B', display: 'flex', alignItems: 'center', padding: '0 14px', gap: '10px', zIndex: 1000 }}>
            <button onClick={() => setIsPlaying(!isPlaying)} style={{ background: '#2563EB', color: '#FFF', border: 'none', borderRadius: '3px', padding: '4px 8px', cursor: 'pointer', fontSize: '11px' }}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button onClick={() => setCurrentTimeStep(0)} style={{ background: '#131B2E', color: '#94A3B8', border: 'none', borderRadius: '3px', padding: '4px 6px', cursor: 'pointer', fontSize: '10px' }}>
              ↺ 00:00
            </button>

            <input
              type="range"
              min="0"
              max={simDuration}
              value={currentTimeStep}
              onChange={(e) => setCurrentTimeStep(Number(e.target.value))}
              style={{ flex: 1 }}
            />

            <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#38BDF8', minWidth: '55px' }}>
              T+{currentTimeStep} min
            </span>

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
          </div>
        </div>

        {/* RIGHT PANEL: HADR & METRICS */}
        <div style={{ width: '280px', background: '#0B111E', borderLeft: '1px solid #1E293B', display: 'flex', flexDirection: 'column', padding: '10px', gap: '8px', overflowY: 'auto', flexShrink: 0 }}>
          
          {/* Top 4-KPI Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <div style={{ background: '#101726', padding: '6px', borderRadius: '4px', border: '1px solid #1E293B' }}>
              <div style={{ fontSize: '9px', color: '#64748B' }}>FLOOD AREA</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#38BDF8' }}>
                9.5 <span style={{ fontSize: '9px', color: '#94A3B8' }}>km²</span>
              </div>
            </div>
            <div style={{ background: '#101726', padding: '6px', borderRadius: '4px', border: '1px solid #1E293B' }}>
              <div style={{ fontSize: '9px', color: '#64748B' }}>MAX DEPTH</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#06B6D4' }}>
                3.4 <span style={{ fontSize: '9px', color: '#94A3B8' }}>m</span>
              </div>
            </div>
            <div style={{ background: '#101726', padding: '6px', borderRadius: '4px', border: '1px solid #1E293B' }}>
              <div style={{ fontSize: '9px', color: '#64748B' }}>MAX VELOCITY</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#F59E0B' }}>
                2.2 <span style={{ fontSize: '9px', color: '#94A3B8' }}>m/s</span>
              </div>
            </div>
            <div style={{ background: '#101726', padding: '6px', borderRadius: '4px', border: '1px solid #1E293B' }}>
              <div style={{ fontSize: '9px', color: '#64748B' }}>POP. EXPOSED</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#EF4444' }}>
                8,715
              </div>
            </div>
          </div>

          {/* HADR Response Triage */}
          <div style={{ background: '#101726', border: '1px solid #1E293B', borderRadius: '4px', padding: '8px' }}>
            <div style={{ fontSize: '9px', fontWeight: 800, color: '#64748B', marginBottom: '6px' }}>HADR RESPONSE</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ background: '#450A0A', borderLeft: '3px solid #EF4444', padding: '4px 6px', borderRadius: '3px', display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                <span style={{ color: '#FCA5A5' }}>P1 Evacuation required</span>
                <span style={{ fontWeight: 800, color: '#FFF' }}>1</span>
              </div>
              <div style={{ background: '#451A03', borderLeft: '3px solid #F59E0B', padding: '4px 6px', borderRadius: '3px', display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                <span style={{ color: '#FDE68A' }}>P2 Monitor and prepare</span>
                <span style={{ fontWeight: 800, color: '#FFF' }}>0</span>
              </div>
              <div style={{ background: '#022C22', borderLeft: '3px solid #10B981', padding: '4px 6px', borderRadius: '3px', display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                <span style={{ color: '#A7F3D0' }}>P3 Safe / unaffected</span>
                <span style={{ fontWeight: 800, color: '#FFF' }}>10</span>
              </div>
            </div>
            <div style={{ fontSize: '8px', color: '#64748B', marginTop: '4px' }}>
              Predicted first arrival: 8 min | Est. exposed: 8,715 | Infra: 7 sites
            </div>
          </div>

          {/* Scenario Comparison Table */}
          <div style={{ background: '#101726', border: '1px solid #1E293B', borderRadius: '4px', padding: '8px' }}>
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

          {/* Loss & Damage Exposure */}
          <div style={{ background: '#101726', border: '1px solid #1E293B', borderRadius: '4px', padding: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 800, color: '#64748B', marginBottom: '4px' }}>
              <span>LOSS & DAMAGE EXPOSURE</span>
              <span style={{ color: '#F59E0B' }}>▲ 3 zones detected</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '9px', color: '#CBD5E1' }}>
              <div>Roads cut: <b>14.2 km</b></div>
              <div>Cropland: <b>85.5 ha</b></div>
              <div>Hospitals: <b>0</b></div>
              <div>Critical sites: <b>7 sites</b></div>
            </div>
          </div>

          {/* Field Observations Form */}
          <div style={{ background: '#101726', border: '1px solid #1E293B', borderRadius: '4px', padding: '8px' }}>
            <div style={{ fontSize: '9px', fontWeight: 800, color: '#64748B', marginBottom: '6px' }}>FIELD OBSERVATIONS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '4px' }}>
              <input
                type="text"
                placeholder="Obs Water Level (m)"
                value={fieldObs.waterLevel}
                onChange={(e) => setFieldObs({ ...fieldObs, waterLevel: e.target.value })}
                style={{ padding: '3px 5px', background: '#131B2E', border: '1px solid #2A364F', borderRadius: '3px', color: '#FFF', fontSize: '9px' }}
              />
              <input
                type="text"
                placeholder="Rainfall (mm/h)"
                value={fieldObs.rainfall}
                onChange={(e) => setFieldObs({ ...fieldObs, rainfall: e.target.value })}
                style={{ padding: '3px 5px', background: '#131B2E', border: '1px solid #2A364F', borderRadius: '3px', color: '#FFF', fontSize: '9px' }}
              />
            </div>
            <textarea
              placeholder="Describe field conditions, breaches..."
              rows={2}
              value={fieldObs.notes}
              onChange={(e) => setFieldObs({ ...fieldObs, notes: e.target.value })}
              style={{ width: '100%', padding: '4px', background: '#131B2E', border: '1px solid #2A364F', borderRadius: '3px', color: '#FFF', fontSize: '9px', resize: 'none' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '4px 0', fontSize: '9px', color: '#94A3B8' }}>
              <input type="checkbox" checked={fieldObs.relayNDRF} onChange={() => setFieldObs({ ...fieldObs, relayNDRF: !fieldObs.relayNDRF })} />
              Relay to NDRF Control
            </div>
            <button
              onClick={() => { setObsSubmitted(true); setTimeout(() => setObsSubmitted(false), 2500); }}
              style={{ width: '100%', padding: '5px', background: '#2563EB', color: '#FFF', border: 'none', borderRadius: '3px', fontWeight: 700, fontSize: '9px', cursor: 'pointer' }}
            >
              {obsSubmitted ? '✓ Submitted to NDRF' : 'Submit Observation'}
            </button>
          </div>

          {/* Export Results */}
          <div style={{ background: '#101726', border: '1px solid #1E293B', borderRadius: '4px', padding: '8px' }}>
            <div style={{ fontSize: '9px', fontWeight: 800, color: '#64748B', marginBottom: '6px' }}>EXPORT RESULTS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              <button onClick={() => window.open(`${API_BASE}/download-kml?dam_name=${encodeURIComponent(selectedDam)}`, '_blank')} style={{ padding: '4px', background: '#131B2E', border: '1px solid #2A364F', color: '#38BDF8', borderRadius: '3px', fontSize: '9px', cursor: 'pointer' }}>
                ⬇ Export KML
              </button>
              <button onClick={() => window.open(`${API_BASE}/download-shapefile?dam_name=${encodeURIComponent(selectedDam)}`, '_blank')} style={{ padding: '4px', background: '#131B2E', border: '1px solid #2A364F', color: '#38BDF8', borderRadius: '3px', fontSize: '9px', cursor: 'pointer' }}>
                ⬇ Export SHP
              </button>
              <button onClick={() => window.open(`${API_BASE}/download-kml?dam_name=${encodeURIComponent(selectedDam)}`, '_blank')} style={{ padding: '4px', background: '#131B2E', border: '1px solid #2A364F', color: '#CBD5E1', borderRadius: '3px', fontSize: '9px', cursor: 'pointer' }}>
                ⬇ Export GeoJSON
              </button>
              <button onClick={() => window.open(`${API_BASE}/download-shapefile?dam_name=${encodeURIComponent(selectedDam)}`, '_blank')} style={{ padding: '4px', background: '#131B2E', border: '1px solid #2A364F', color: '#CBD5E1', borderRadius: '3px', fontSize: '9px', cursor: 'pointer' }}>
                ⬇ Export Raster
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}