import os
import sys
import math
import json
import shutil
import zipfile
from datetime import datetime, timedelta

from fastapi import FastAPI, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import pandas as pd
import numpy as np

# Folder path ensure karein
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# -------------------------------------------------------------------------
# Simulation modules (need rasterio / geopandas). If they fail to import
# (for example blocked on a machine), the server still starts and the
# /validated/hidkal endpoints keep working.
# -------------------------------------------------------------------------
SIM_IMPORT_ERROR = None
try:
    from get_dem import fetch_dem_raster
    from flood_simulation import simulate_hydrodynamic_routing, simulate_sph_particles
    from visualize_flood import generate_analytical_preview
    from infrastructure_analysis import fetch_downstream_infrastructure, analyze_compromised_infrastructure
except Exception as e:
    SIM_IMPORT_ERROR = str(e)
    print(f"[SIM Notice] Simulation modules could not be imported: {e}")
    print("[SIM Notice] /simulate and the download endpoints are disabled. /validated/hidkal still works.")

SIM_UNAVAILABLE_RESPONSE = {
    "error": "Simulation modules are not available on this machine.",
    "detail": SIM_IMPORT_ERROR,
}

# -------------------------------------------------------------------------
# Earth Engine Initialization (Safe Fallback)
# -------------------------------------------------------------------------
ee_available = False
try:
    import ee
    try:
        ee.Initialize(project='hydrovision-510421')
        ee_available = True
        print("[GEE] Earth Engine initialized successfully.")
    except Exception as e:
        print(f"[GEE Notice] Authentication skipped or deferred: {e}")
except ImportError:
    print("[GEE Notice] earthengine-api not installed.")

# Primary FastAPI Application
app = FastAPI(
    title="Universal Dam Break Inundation & HADR DSS",
    description="Dam-break flood screening, validated ANUGA results for Hidkal, and HADR exposure indicators."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CSV_FILE = "Dams.csv"
CACHED_DAMS = []
UPLOAD_DIR = "uploaded_dem"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Registry for uploaded custom DEMs
UPLOADED_REGISTRY = {}

def clean_val(val, default=""):
    if pd.isna(val) or val is None:
        return default
    s = str(val).strip()
    return default if s.lower() == "nan" else s

# -------------------------------------------------------------------------
# 1. 4,661 Indian Dams Registry Loader
# -------------------------------------------------------------------------
def load_and_normalize_dams_dataset():
    global CACHED_DAMS
    if CACHED_DAMS:
        return CACHED_DAMS

    csv_path = CSV_FILE if os.path.exists(CSV_FILE) else os.path.join("..", CSV_FILE)
    if not os.path.exists(csv_path):
        return []

    df = pd.read_csv(csv_path)
    clean_list = []
    for _, r in df.iterrows():
        name = clean_val(r.get("dm_name") or r.get("dam_name") or r.get("name") or r.get("project_name"))
        if not name:
            continue
        try:
            lat = float(r.get("Latitude", r.get("latitude", 0)))
            lon = float(r.get("Longitude", r.get("longitude", 0)))
            if lat == 0 or lon == 0 or np.isnan(lat) or np.isnan(lon):
                continue

            ht = float(r.get("dm_height", r.get("height_m", 40.0)))
            if np.isnan(ht) or ht <= 0:
                ht = 40.0

            cap = float(r.get("dam_vol", r.get("capacity_m3", 0.0)))
            if np.isnan(cap) or cap <= 0:
                cap = (ht ** 2.4) * 45000.0
            elif cap < 1e6:
                cap = cap * 1e6

            st = clean_val(r.get("stcode", r.get("state")), "IN")
            dt = clean_val(r.get("dtcode", r.get("district")), "")
            riv = clean_val(r.get("rivcode", r.get("river")), "River Basin")

            clean_list.append({
                "dam_name": name,
                "latitude": round(lat, 5),
                "longitude": round(lon, 5),
                "height_m": round(ht, 1),
                "capacity_m3": float(cap),
                "current_storage_m3": float(cap) * 0.8,
                "state": st,
                "district": dt,
                "river": riv
            })
        except Exception:
            continue

    CACHED_DAMS = clean_list
    print(f"[REGISTRY SUCCESS] Successfully loaded {len(CACHED_DAMS)} Indian Dams from {csv_path}!")
    return CACHED_DAMS

# -------------------------------------------------------------------------
# 2. Empirical Hydraulics (Froehlich 2008 Formulation)
# -------------------------------------------------------------------------
def froehlich_breach(dam_height: float, storage_volume: float):
    storage_volume = max(float(storage_volume), 1000.0)
    dam_height = max(float(dam_height), 5.0)

    breach_width = 0.27 * (storage_volume ** 0.32) * (dam_height ** 0.04)
    formation_time = 63.2 * math.sqrt(storage_volume / (9.81 * (dam_height ** 2)))
    peak_outflow = 0.607 * (storage_volume ** 0.295) * (dam_height ** 1.24)

    return {
        "breach_width_m": round(float(breach_width), 2),
        "formation_time_hr": round(float(formation_time) / 3600.0, 2),
        "peak_outflow_cumecs": round(float(peak_outflow), 2)
    }

# -------------------------------------------------------------------------
# API Endpoints
# -------------------------------------------------------------------------
@app.get("/")
def root():
    return {
        "message": "Dam Break Flood Screening & Validated Results API Operational",
        "status": "online",
        "simulation_modules": "available" if SIM_IMPORT_ERROR is None else "unavailable",
    }

@app.get("/dams")
def get_dams():
    data = load_and_normalize_dams_dataset()
    return JSONResponse(content=data)

# -------------------------------------------------------------------------
# 3. Local Computer DEM / Terrain File Upload Endpoint
# -------------------------------------------------------------------------
@app.post("/upload-dem")
async def upload_dem(file: UploadFile = File(...)):
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    dam_name = os.path.splitext(file.filename)[0].replace("_", " ").title()
    lat, lon = 11.634, 92.684
    grid_str = "1024 × 1024"
    res_str = "30 m (GLO-30)"
    crs_str = "EPSG:4326"

    # GeoTIFF/DEM metadata extraction
    if file.filename.lower().endswith(('.tif', '.tiff', '.dem')):
        try:
            import rasterio
            with rasterio.open(file_path) as src:
                b = src.bounds
                lon = float((b.left + b.right) / 2.0)
                lat = float((b.bottom + b.top) / 2.0)
                grid_str = f"{src.height} × {src.width}"
                res_str = f"{round(src.res[0] * 111000, 1)} m"
                crs_str = str(src.crs) if src.crs else "EPSG:4326"
        except Exception as e:
            print(f"[DEM Parse Notice] {e}")

    meta = {
        "dam_name": dam_name,
        "file_name": file.filename,
        "latitude": round(lat, 5),
        "longitude": round(lon, 5),
        "height_m": 45.0,
        "capacity_m3": 5.0e7,
        "resolution": res_str,
        "grid": grid_str,
        "crs": crs_str,
        "state": "Local Upload",
        "river": "Downstream Basin"
    }

    UPLOADED_REGISTRY[dam_name] = meta
    return {"status": "success", **meta}

# -------------------------------------------------------------------------
# 4. Fast screening simulation (bathtub + travel-time routing, random-walk proxy)
# -------------------------------------------------------------------------
SCREENING_NOTE = (
    "Fast screening estimate only. The flood extent comes from a fixed water-level rise spread over "
    "connected low ground with travel-time routing, and the 'SPH' result is a particle random-walk "
    "proxy, not a true SPH or shallow-water solver. Population is estimated as area x 350 per km2. "
    "For a dam with a validated 2D shallow-water run, use /validated/hidkal."
)

@app.get("/simulate")
def simulate(
    dam_name: str = Query(..., description="Target dam identifier"),
    storage_percent: float = Query(70.0, description="Simulated capacity % (1-100)")
):
    if SIM_IMPORT_ERROR is not None:
        return JSONResponse(status_code=503, content=SIM_UNAVAILABLE_RESPONSE)

    print(f"\n[*] Processing screening simulation: {dam_name} ({storage_percent}%)")

    # Check uploaded files registry first, then 4,661 prebuilt dams
    dam = UPLOADED_REGISTRY.get(dam_name)
    if not dam:
        dams = load_and_normalize_dams_dataset()
        dam = next((d for d in dams if d["dam_name"].strip().lower() == dam_name.strip().lower()), None)
        if not dam:
            dam = next((d for d in dams if dam_name.strip().lower() in d["dam_name"].strip().lower()), None)

    if not dam:
        return JSONResponse(status_code=404, content={"error": f"Dam '{dam_name}' not found."})

    lat = float(dam["latitude"])
    lon = float(dam["longitude"])
    height = float(dam.get("height_m", 40.0))
    capacity = float(dam.get("capacity_m3", (height ** 2.4) * 45000.0))

    fill_ratio = max(0.1, min(1.0, float(storage_percent) / 100.0))
    current_storage = capacity * fill_ratio
    breach = froehlich_breach(height, current_storage)

    # 1. DEM ingestion
    print(" -> Loading DEM elevation surface...")
    dem, transform, profile, _ = fetch_dem_raster(lat, lon, dam["dam_name"])

    # 2. Screening flood routing (bathtub + travel-time)
    print(" -> Executing screening flood routing (water-level rise + travel time)...")
    flood_rise_depth = max(2.5, math.pow((breach["peak_outflow_cumecs"] * 0.035) / (max(breach["breach_width_m"], 20.0) * math.sqrt(0.002)), 0.6))
    raw_flood = simulate_hydrodynamic_routing(lat, lon, dem, transform, flood_rise_m=flood_rise_depth)

    # 3. Particle random-walk proxy (labelled SPH in the UI for compatibility)
    print(" -> Executing particle random-walk proxy...")
    raw_sph = simulate_sph_particles(lat, lon, dem, transform)

    # Clean GeoJSON dictionaries
    hydro_geojson = json.loads(raw_flood["geojson"]) if isinstance(raw_flood.get("geojson"), str) else raw_flood.get("geojson")
    sph_geojson = json.loads(raw_sph["geojson"]) if isinstance(raw_sph.get("geojson"), str) else raw_sph.get("geojson")

    # 4. OSM Infrastructure Analysis (with Safe Timeout)
    print(" -> Intersecting downstream exposed infrastructure...")
    infra_impact = None
    try:
        buffer_deg = 0.10
        bbox = (lat - buffer_deg, lon - buffer_deg, lat + buffer_deg, lon + buffer_deg)
        osm_raw = fetch_downstream_infrastructure(bbox)
        infra_impact = analyze_compromised_infrastructure(osm_raw, raw_flood.get("geojson"))
    except Exception as e:
        print(f" -> [OSM Notice] Handled with localized stats: {e}")
        flooded_sq_km = float(raw_flood.get("flooded_area_sq_km", 9.5))
        infra_impact = {
            "summary": {
                "hospitals": max(0, int(flooded_sq_km / 18)),
                "schools": max(1, int(flooded_sq_km / 8)),
                "bridges": max(1, int(flooded_sq_km / 10)),
                "highways_km": round(flooded_sq_km * 0.18, 1)
            },
            "geojson": None,
            "note": "Estimated from flooded area because OpenStreetMap data could not be fetched."
        }

    # Generate Diagnostic Preview Image
    try:
        generate_analytical_preview(dem, raw_flood.get("flooded_raster"), dam["dam_name"])
    except Exception:
        pass

    area_hydro = float(raw_flood.get("flooded_area_sq_km", 9.5))
    area_sph = float(raw_sph.get("area_sq_km", 8.4))
    print(" -> Screening simulation completed.")

    return {
        "dam_name": dam["dam_name"],
        "method_note": SCREENING_NOTE,
        "storage_analysis": {
            "total_capacity_bcm": round(capacity / 1e9, 3),
            "current_storage_bcm": round(current_storage / 1e9, 3),
            "fill_percentage": round(fill_ratio * 100.0, 1)
        },
        "breach_analysis": breach,
        "flood_simulation": {
            "flooded_area_sq_km": area_hydro,
            "flood_level_m": round(flood_rise_depth, 2),
            "estimated_affected_population": int(raw_flood.get("estimated_affected_population", 8715)),
            "geojson": hydro_geojson
        },
        "sph_simulation": {
            "area_sq_km": area_sph,
            "geojson": sph_geojson
        },
        "infrastructure_impact": infra_impact,
        "comparison": {
            "hydrodynamic_model_area_sq_km": area_hydro,
            "sph_model_area_sq_km": area_sph,
            "difference_sq_km": round(abs(area_hydro - area_sph), 2)
        }
    }

# -------------------------------------------------------------------------
# 5. Sentinel-1 SAR recent water mask (Earth Engine)
# -------------------------------------------------------------------------
@app.get("/realtime-flood")
def realtime_flood(dam_lat: float = Query(...), dam_lon: float = Query(...), buffer_km: float = 15.0):
    if not ee_available:
        return {"status": "unavailable", "message": "Sentinel-1 SAR extraction requires Earth Engine credentials."}

    try:
        point = ee.Geometry.Point([dam_lon, dam_lat])
        area = point.buffer(buffer_km * 1000)
        today = datetime.utcnow().strftime('%Y-%m-%d')
        thirty_days_ago = (datetime.utcnow() - timedelta(days=30)).strftime('%Y-%m-%d')

        collection = (
            ee.ImageCollection('COPERNICUS/S1_GRD')
            .filterBounds(area)
            .filterDate(thirty_days_ago, today)
            .filter(ee.Filter.eq('instrumentMode', 'IW'))
            .select('VV')
        )
        image = collection.mosaic().clip(area)
        water = image.lt(-15).selfMask().connectedPixelCount(25).gte(25).unmask(0)
        water_vectors = water.selfMask().reduceToVectors(
            geometry=area, scale=100, maxPixels=1e9, geometryType='polygon'
        )
        return {
            "status": "success",
            "images_used": collection.size().getInfo(),
            "note": (
                "Dark-pixel (VV < -15 dB) mask from the last 30 days of Sentinel-1. It includes permanent "
                "water such as reservoirs and rivers, may cover only part of the area, and is not a "
                "confirmed flood map."
            ),
            "geojson": water_vectors.getInfo()
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

# -------------------------------------------------------------------------
# 6. Shapefile (.zip) Export Endpoint (screening result)
# -------------------------------------------------------------------------
@app.get("/download-shapefile")
def download_shapefile(dam_name: str = Query(...)):
    if SIM_IMPORT_ERROR is not None:
        return JSONResponse(status_code=503, content=SIM_UNAVAILABLE_RESPONSE)

    dam = UPLOADED_REGISTRY.get(dam_name)
    if not dam:
        dams = load_and_normalize_dams_dataset()
        dam = next((d for d in dams if d["dam_name"].strip().lower() == dam_name.strip().lower()), None)
    if not dam:
        dam = {"dam_name": dam_name, "latitude": 11.634, "longitude": 92.684, "height_m": 40.0}

    lat, lon = float(dam["latitude"]), float(dam["longitude"])
    safe_name = dam_name.replace(" ", "_").lower().replace("(", "").replace(")", "").replace("/", "_")
    shp_dir = f"output_{safe_name}"
    os.makedirs(shp_dir, exist_ok=True)
    zip_path = f"{safe_name}_flood_extent_shapefile.zip"

    try:
        import geopandas as gpd
        dem, transform, _, _ = fetch_dem_raster(lat, lon, dam_name)
        res = simulate_hydrodynamic_routing(lat, lon, dem, transform)
        gj_str = res["geojson"] if isinstance(res["geojson"], str) else json.dumps(res["geojson"])
        gdf = gpd.GeoDataFrame.from_features(json.loads(gj_str)["features"], crs="EPSG:4326")
        gdf.to_file(os.path.join(shp_dir, f"{safe_name}_flood_extent.shp"))
    except Exception as e:
        print(f"[SHP Export Notice] {e}")

    with zipfile.ZipFile(zip_path, "w") as zf:
        for f in os.listdir(shp_dir):
            zf.write(os.path.join(shp_dir, f), f)

    return FileResponse(zip_path, media_type="application/zip", filename=zip_path)

# -------------------------------------------------------------------------
# 7. Google Earth KML Export Endpoint (screening result)
# -------------------------------------------------------------------------
@app.get("/download-kml")
def download_kml(dam_name: str = Query(...)):
    if SIM_IMPORT_ERROR is not None:
        return JSONResponse(status_code=503, content=SIM_UNAVAILABLE_RESPONSE)

    dam = UPLOADED_REGISTRY.get(dam_name)
    if not dam:
        dams = load_and_normalize_dams_dataset()
        dam = next((d for d in dams if d["dam_name"].strip().lower() == dam_name.strip().lower()), None)
    if not dam:
        dam = {"dam_name": dam_name, "latitude": 11.634, "longitude": 92.684, "height_m": 40.0}

    lat, lon = float(dam["latitude"]), float(dam["longitude"])
    safe_name = dam_name.replace(" ", "_").lower().replace("(", "").replace(")", "").replace("/", "_")
    kml_path = f"{safe_name}_flood_extent.kml"

    try:
        import geopandas as gpd
        dem, transform, _, _ = fetch_dem_raster(lat, lon, dam_name)
        res = simulate_hydrodynamic_routing(lat, lon, dem, transform)
        gj_str = res["geojson"] if isinstance(res["geojson"], str) else json.dumps(res["geojson"])
        gdf = gpd.GeoDataFrame.from_features(json.loads(gj_str)["features"], crs="EPSG:4326")
        gdf.to_file(kml_path, driver="KML")
    except Exception as e:
        print(f"[KML Export Notice] {e}")

    return FileResponse(kml_path, media_type="application/vnd.google-earth.kml+xml", filename=kml_path)

# -------------------------------------------------------------------------
# 8. Validated ANUGA results for Hidkal (precomputed in Google Colab)
# -------------------------------------------------------------------------
HIDKAL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hidkal_anuga")
HIDKAL_SCENARIOS = ("froehlich", "paper_peak")

@app.get("/validated/hidkal")
def validated_hidkal():
    path = os.path.join(HIDKAL_DIR, "hidkal_summary.json")
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": "hidkal_anuga/hidkal_summary.json not found"})
    with open(path, encoding="utf-8") as f:
        return JSONResponse(content=json.load(f))

@app.get("/validated/hidkal/{scenario}")
def validated_hidkal_flood(scenario: str):
    if scenario not in HIDKAL_SCENARIOS:
        return JSONResponse(status_code=404, content={"error": f"unknown scenario, use one of {list(HIDKAL_SCENARIOS)}"})
    path = os.path.join(HIDKAL_DIR, f"hidkal_{scenario}_flood.geojson")
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": f"hidkal_anuga/hidkal_{scenario}_flood.geojson not found"})
    with open(path, encoding="utf-8") as f:
        return JSONResponse(content=json.load(f))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)