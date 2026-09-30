import os
import math
import rasterio
from rasterio.windows import from_bounds

CACHE_DIR = "dem_cache"
os.makedirs(CACHE_DIR, exist_ok=True)

def fetch_dem_raster(dam_lat: float, dam_lon: float, dam_name: str, buffer_deg: float = 0.20):
    """
    100% REAL TERRAIN: Fetches actual 30-meter elevation data from Copernicus
    GLO-30 AWS public repository. Caches to disk for instant subsequent simulations.
    """
    safe_name = dam_name.replace(" ", "_").lower().replace("(", "").replace(")", "").replace("/", "_")
    local_tif = os.path.join(CACHE_DIR, f"{safe_name}_dem.tif")

    # 1. Agar local disk pe pehle se real DEM cached hai toh direct use karo
    if os.path.exists(local_tif) and os.path.getsize(local_tif) > 1024:
        with rasterio.open(local_tif) as src:
            dem_data = src.read(1)
            print(f"[DEM] Loaded cached real DEM for {dam_name} ({dem_data.shape[0]}x{dem_data.shape[1]} cells)")
            return dem_data, src.transform, src.profile, local_tif

    # 2. Copernicus GLO-30 AWS S3 COG tile coordinate mapping
    tile_lat = int(math.floor(dam_lat))
    tile_lon = int(math.floor(dam_lon))
    lat_prefix = f"N{tile_lat:02d}" if tile_lat >= 0 else f"S{abs(tile_lat):02d}"
    lon_prefix = f"E{tile_lon:03d}" if tile_lon >= 0 else f"W{abs(tile_lon):03d}"

    url = (
        f"/vsicurl/https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/"
        f"Copernicus_DSM_COG_10_{lat_prefix}_00_{lon_prefix}_00_DEM/"
        f"Copernicus_DSM_COG_10_{lat_prefix}_00_{lon_prefix}_00_DEM.tif"
    )

    west, south = dam_lon - buffer_deg, dam_lat - buffer_deg
    east, north = dam_lon + buffer_deg, dam_lat + buffer_deg

    print(f"[DEM] Fetching REAL Copernicus 30m DEM tile: {lat_prefix}_{lon_prefix}...")

    # GDAL vsicurl streaming
    with rasterio.open(url) as src:
        window = from_bounds(west, south, east, north, src.transform)
        dem_data = src.read(1, window=window)
        transform = src.window_transform(window)
        profile = src.profile.copy()
        profile.update({
            "driver": "GTiff",
            "height": dem_data.shape[0],
            "width": dem_data.shape[1],
            "transform": transform
        })

    # Cache actual GeoTIFF to local folder
    with rasterio.open(local_tif, "w", **profile) as dst:
        dst.write(dem_data, 1)

    print(f"[DEM] Real DEM successfully downloaded and cached to {local_tif}")
    return dem_data, transform, profile, local_tif