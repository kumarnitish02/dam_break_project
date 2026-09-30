import math
import heapq
from collections import deque
import numpy as np
import rasterio
from rasterio.features import shapes
import geopandas as gpd

def compute_downstream_vector(dem: np.ndarray, row: int, col: int, search_radius: int = 10):
    rows, cols = dem.shape
    min_elev = float(dem[row, col])
    seed_r, seed_c = row, col

    for dr in range(-search_radius, search_radius + 1):
        for dc in range(-search_radius, search_radius + 1):
            nr, nc = row + dr, col + dc
            if 0 <= nr < rows and 0 <= nc < cols:
                if dem[nr, nc] < min_elev:
                    min_elev = dem[nr, nc]
                    seed_r, seed_c = nr, nc

    v_r = seed_r - row
    v_c = seed_c - col
    mag = math.sqrt(v_r**2 + v_c**2)
    dir_r, dir_c = (v_r / mag, v_c / mag) if mag > 0 else (0.0, 0.0)

    return seed_r, seed_c, float(min_elev), dir_r, dir_c

def simulate_hydrodynamic_routing(dam_lat: float, dam_lon: float, dem: np.ndarray,
                                  transform, flood_rise_m: float = 12.0, max_distance_km: float = 30.0):
    rows, cols = dem.shape
    row0, col0 = rasterio.transform.rowcol(transform, dam_lon, dam_lat)
    seed_r, seed_c, base_elev, dir_r, dir_c = compute_downstream_vector(dem, row0, col0)

    pixel_deg = abs(transform[0])
    meters_per_pixel = pixel_deg * 111320.0
    max_pixels = int((max_distance_km * 1000.0) / meters_per_pixel)
    flood_level = base_elev + flood_rise_m

    # Arrival time grid in seconds (-1.0 = not inundated)
    arrival_time_sec = np.full(dem.shape, -1.0, dtype=np.float32)
    flooded = np.zeros_like(dem, dtype=bool)
    visited_final = np.zeros_like(dem, dtype=bool)

    # Priority queue (min-heap): (cumulative_time, row, col, distance_steps)
    pq = [(0.0, seed_r, seed_c, 0)]
    arrival_time_sec[seed_r, seed_c] = 0.0
    flooded[seed_r, seed_c] = True

    g = 9.81  # gravity m/s^2

    while pq:
        curr_time, r, c, dist = heapq.heappop(pq)

        if visited_final[r, c]:
            continue
        visited_final[r, c] = True

        if dist > max_pixels:
            continue

        # Reject backward propagation across dam crest
        if dir_r != 0.0 or dir_c != 0.0:
            projection = (r - row0) * dir_r + (c - col0) * dir_c
            if projection < -1.5:
                continue

        current_depth = max(0.5, flood_level - dem[r, c])

        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and dem[nr, nc] <= flood_level and not visited_final[nr, nc]:
                # Local shallow water wave celerity: c = sqrt(g * h)
                target_depth = max(0.2, flood_level - dem[nr, nc])
                avg_depth = (current_depth + target_depth) / 2.0

                # Gravity wave velocity + slope adjustment
                elev_drop = max(0.0, dem[r, c] - dem[nr, nc])
                slope = elev_drop / meters_per_pixel
                wave_speed = math.sqrt(g * avg_depth) + (slope * 5.0)  # m/s
                wave_speed = max(1.5, min(wave_speed, 25.0))  # physical speed clamping

                step_time = meters_per_pixel / wave_speed
                new_time = curr_time + step_time

                if arrival_time_sec[nr, nc] < 0 or new_time < arrival_time_sec[nr, nc]:
                    arrival_time_sec[nr, nc] = new_time
                    flooded[nr, nc] = True
                    heapq.heappush(pq, (new_time, nr, nc, dist + 1))

    # Convert arrival seconds into categorical Isochrone Bands:
    # 1: < 30 mins, 2: 30 - 60 mins, 3: 1 - 2 hours, 4: > 2 hours
    isochrone_grid = np.zeros_like(dem, dtype=np.uint8)
    isochrone_grid[(arrival_time_sec >= 0) & (arrival_time_sec < 1800)] = 1
    isochrone_grid[(arrival_time_sec >= 1800) & (arrival_time_sec < 3600)] = 2
    isochrone_grid[(arrival_time_sec >= 3600) & (arrival_time_sec < 7200)] = 3
    isochrone_grid[arrival_time_sec >= 7200] = 4

    # Extract polygonized isochrone contours with attributes
    features = []
    zone_labels = {
        1: "< 30 mins (Flash Critical)",
        2: "30 - 60 mins (High Hazard)",
        3: "1 - 2 hrs (Moderate)",
        4: "> 2 hrs (Advisory Zone)"
    }
    zone_colors = {
        1: "#ef4444",  # Red
        2: "#f97316",  # Orange
        3: "#eab308",  # Yellow
        4: "#06b6d4"   # Cyan/Blue
    }

    for geom, val in shapes(isochrone_grid, transform=transform):
        v = int(val)
        if v in zone_labels:
            features.append({
                "type": "Feature",
                "properties": {
                    "zone_id": v,
                    "lead_time": zone_labels[v],
                    "color": zone_colors[v]
                },
                "geometry": geom
            })

    area_sq_km = flooded.sum() * (meters_per_pixel ** 2) / 1e6

    if not features:
        return {
            "flooded_area_sq_km": 0.0,
            "flood_level_m": round(flood_level, 2),
            "estimated_affected_population": 0,
            "geojson": None,
            "flooded_raster": flooded
        }

    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    # Dissolve by zone_id so Leaflet only gets clean merged boundary contours
    dissolved_gdf = gdf.dissolve(by="zone_id", as_index=False)

    return {
        "flooded_area_sq_km": round(area_sq_km, 2),
        "flood_level_m": round(float(flood_level), 2),
        "estimated_affected_population": int(area_sq_km * 350),
        "geojson": dissolved_gdf.to_json(),
        "flooded_raster": flooded
    }

def simulate_sph_particles(dam_lat: float, dam_lon: float, dem: np.ndarray,
                           transform, n_particles: int = 2000, n_steps: int = 150):
    rows, cols = dem.shape
    row0, col0 = rasterio.transform.rowcol(transform, dam_lon, dam_lat)
    seed_r, seed_c, _, _, _ = compute_downstream_vector(dem, row0, col0)

    visit_count = np.zeros_like(dem, dtype=np.int32)
    rng = np.random.default_rng(42)

    for _ in range(n_particles):
        r, c = seed_r, seed_c
        for _ in range(n_steps):
            if not (0 <= r < rows and 0 <= c < cols):
                break
            visit_count[r, c] += 1

            best_r, best_c = r, c
            best_elev = dem[r, c]
            neighbors = [(-1, -1), (-1, 0), (-1, 1), (0, -1),
                         (0, 1), (1, -1), (1, 0), (1, 1)]
            rng.shuffle(neighbors)

            for dr, dc in neighbors:
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols:
                    noise = rng.normal(0, 0.4)
                    if dem[nr, nc] + noise < best_elev:
                        best_elev = dem[nr, nc] + noise
                        best_r, best_c = nr, nc

            if (best_r, best_c) == (r, c):
                break
            r, c = best_r, best_c

    threshold = max(2, int(n_particles * 0.015))
    flooded = visit_count >= threshold

    pixel_deg = abs(transform[0])
    meters_per_pixel = pixel_deg * 111320.0
    area_sq_km = flooded.sum() * (meters_per_pixel ** 2) / 1e6

    results = (
        {"properties": {"flooded": int(v)}, "geometry": s}
        for s, v in shapes(flooded.astype(np.uint8), transform=transform)
        if v == 1
    )
    geoms = list(results)
    if not geoms:
        return {"area_sq_km": 0.0, "geojson": None}

    gdf = gpd.GeoDataFrame.from_features(geoms, crs="EPSG:4326")
    merged = gdf.dissolve()

    return {
        "area_sq_km": round(area_sq_km, 2),
        "geojson": merged.to_json()
    }