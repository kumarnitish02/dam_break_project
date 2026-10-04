"""
2D shallow-water flood solver (local inertial / de Almeida & Bates 2012, LISFLOOD-FP style).

Purana flood_simulation.py fixed "flood level" lagata tha (bathtub). Yahan paani ka volume
breach hydrograph se aata hai, mass conserve hota hai, aur har cell ke liye depth, velocity
aur arrival time time-stepping se nikalte hain.

Note: convective acceleration neglect hoti hai, isliye bahut steep/supercritical reaches mein
thoda conservative-ya-smooth result aa sakta hai. Validation ke liye known flood event se compare karna.
"""
import math
import time

import numpy as np

G = 9.81


def run_swe(z, dx, dy, t_q, q_in, src_r, src_c, sim_seconds,
            manning_n=0.05, alpha=0.7, theta=0.9, h_min=1e-3, wet_thresh=0.1, dt_max=10.0):
    """
    z: bed elevation (rows, cols) in m
    dx, dy: cell size in m (x = columns, y = rows)
    t_q, q_in: inflow hydrograph (seconds, m3/s)
    src_r, src_c: source cells (arrays) jahan breach ka paani dala jata hai
    Edge cells open boundary hain (paani bahar nikal jaata hai).
    """
    z = np.asarray(z, dtype=np.float64)
    rows, cols = z.shape
    h = np.zeros_like(z)
    qx = np.zeros((rows, cols - 1))
    qy = np.zeros((rows - 1, cols))

    max_depth = np.zeros_like(z)
    max_vel = np.zeros_like(z)
    arrival = np.full(z.shape, -1.0, dtype=np.float32)

    edge = np.zeros(z.shape, dtype=bool)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True

    n2 = manning_n ** 2
    cell_area = dx * dy
    n_src = len(src_r)
    t, step = 0.0, 0
    injected = drained = 0.0

    while t < sim_seconds:
        hmax = max(float(h.max()), 0.1)
        dt = min(alpha * min(dx, dy) / math.sqrt(G * hmax), dt_max, sim_seconds - t)

        # --- inflow (breach hydrograph) ---
        q_now = float(np.interp(t + 0.5 * dt, t_q, q_in, right=0.0))
        if q_now > 0:
            h[src_r, src_c] += q_now * dt / (cell_area * n_src)
            injected += q_now * dt

        eta = z + h

        # --- x-direction flux (faces between column j and j+1) ---
        hf = np.maximum(eta[:, :-1], eta[:, 1:]) - np.maximum(z[:, :-1], z[:, 1:])
        wet = hf > h_min
        hfs = np.where(wet, hf, 1.0)
        qm = np.zeros_like(qx); qm[:, 1:] = qx[:, :-1]
        qp = np.zeros_like(qx); qp[:, :-1] = qx[:, 1:]
        qavg = theta * qx + 0.5 * (1 - theta) * (qm + qp)
        slope = (eta[:, 1:] - eta[:, :-1]) / dx
        qn = (qavg - G * hfs * dt * slope) / (1 + G * dt * n2 * np.abs(qx) / hfs ** (7.0 / 3.0))
        qn = np.where(wet, qn, 0.0)
        lim = np.where(qn > 0, h[:, :-1], h[:, 1:]) * dx / (4.0 * dt)
        qx = np.clip(qn, -lim, lim)
        vx = np.where(wet, np.abs(qx) / hfs, 0.0)

        # --- y-direction flux (faces between row i and i+1) ---
        hf = np.maximum(eta[:-1, :], eta[1:, :]) - np.maximum(z[:-1, :], z[1:, :])
        wet = hf > h_min
        hfs = np.where(wet, hf, 1.0)
        qm = np.zeros_like(qy); qm[1:, :] = qy[:-1, :]
        qp = np.zeros_like(qy); qp[:-1, :] = qy[1:, :]
        qavg = theta * qy + 0.5 * (1 - theta) * (qm + qp)
        slope = (eta[1:, :] - eta[:-1, :]) / dy
        qn = (qavg - G * hfs * dt * slope) / (1 + G * dt * n2 * np.abs(qy) / hfs ** (7.0 / 3.0))
        qn = np.where(wet, qn, 0.0)
        lim = np.where(qn > 0, h[:-1, :], h[1:, :]) * dy / (4.0 * dt)
        qy = np.clip(qn, -lim, lim)
        vy = np.where(wet, np.abs(qy) / hfs, 0.0)

        # --- continuity ---
        h[:, 1:] += dt / dx * qx
        h[:, :-1] -= dt / dx * qx
        h[1:, :] += dt / dy * qy
        h[:-1, :] -= dt / dy * qy
        np.maximum(h, 0.0, out=h)

        # open boundary: edge cells ka paani nikal do
        drained += float(h[edge].sum()) * cell_area
        h[edge] = 0.0

        t += dt
        step += 1

        # --- statistics ---
        np.maximum(max_depth, h, out=max_depth)
        newly_wet = (h > wet_thresh) & (arrival < 0)
        arrival[newly_wet] = t

        if step % 5 == 0:
            v = np.zeros_like(z)
            v[:, :-1] = np.maximum(v[:, :-1], vx)
            v[:, 1:] = np.maximum(v[:, 1:], vx)
            v[:-1, :] = np.maximum(v[:-1, :], vy)
            v[1:, :] = np.maximum(v[1:, :], vy)
            v[h < wet_thresh] = 0.0
            np.maximum(max_vel, v, out=max_vel)

    stored = float(h.sum()) * cell_area
    mass_err_pct = 100.0 * (injected - stored - drained) / max(injected, 1.0)

    return {
        "max_depth": max_depth,
        "max_velocity": max_vel,
        "arrival_time_s": arrival,
        "steps": step,
        "injected_m3": injected,
        "stored_m3": stored,
        "drained_m3": drained,
        "mass_balance_error_pct": mass_err_pct,
    }


# ----------------------------------------------------------------------------
# Wrapper: DEM + transform lo, purane flood_simulation.py jaisa result dict wapas do
# ----------------------------------------------------------------------------

ZONE_LABELS = {
    1: "< 30 mins (Flash Critical)",
    2: "30 - 60 mins (High Hazard)",
    3: "1 - 2 hrs (Moderate)",
    4: "> 2 hrs (Advisory Zone)",
}
ZONE_COLORS = {1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#06b6d4"}
DEPTH_LABELS = {1: "0.1 - 0.5 m", 2: "0.5 - 1.5 m", 3: "1.5 - 3 m", 4: "> 3 m"}


def _to_geojson(grid, transform, props_fn):
    import geopandas as gpd
    from rasterio.features import shapes

    feats = []
    for geom, val in shapes(grid, transform=transform):
        v = int(val)
        if v > 0:
            feats.append({"type": "Feature", "properties": props_fn(v), "geometry": geom})
    if not feats:
        return None
    gdf = gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326")
    return gdf.dissolve(by="zone_id", as_index=False).to_json()


def simulate_dam_break(dam_lat, dam_lon, dem, transform, hydrograph,
                       sim_hours=6.0, manning_n=0.05, coarsen=3, max_distance_km=30.0):
    """
    hydrograph: DataFrame with columns time_s, discharge_cumecs (breach_formula.breach_hydrograph se)
    coarsen: DEM ko k x k blocks mein average karta hai (3 => 30 m se 90 m) taaki run time kam ho
    """
    import rasterio
    from rasterio.transform import Affine
    from flood_simulation import compute_downstream_vector

    t0 = time.time()
    dem = np.asarray(dem, dtype=np.float64)
    row0, col0 = rasterio.transform.rowcol(transform, dam_lon, dam_lat)
    seed_r, seed_c, _, _, _ = compute_downstream_vector(dem, row0, col0)

    # cell size (x direction mein cos(lat) ka correction)
    dy = abs(transform[0]) * 111320.0
    dx = dy * math.cos(math.radians(dam_lat))

    # dam ke aas-paas ki window crop karo
    max_pix = int(max_distance_km * 1000.0 / dy)
    r0, r1 = max(0, seed_r - max_pix), min(dem.shape[0], seed_r + max_pix)
    c0, c1 = max(0, seed_c - max_pix), min(dem.shape[1], seed_c + max_pix)
    sub = dem[r0:r1, c0:c1].copy()
    sub[(sub < -500) | ~np.isfinite(sub)] = np.nan      # nodata
    sub = np.where(np.isnan(sub), np.nanmax(sub), sub)
    sub_tf = transform * Affine.translation(c0, r0)
    sr, sc = seed_r - r0, seed_c - c0

    k = max(1, int(coarsen))
    if k > 1:
        hh, ww = (sub.shape[0] // k) * k, (sub.shape[1] // k) * k
        sub = sub[:hh, :ww].reshape(hh // k, k, ww // k, k).mean(axis=(1, 3))
        sub_tf = sub_tf * Affine.scale(k)
        dx, dy = dx * k, dy * k
        sr, sc = min(sr // k, sub.shape[0] - 1), min(sc // k, sub.shape[1] - 1)

    # source cells: seed ke 2-cell radius mein nichle cells
    zs = sub[sr, sc]
    src = [(i, j) for i in range(max(0, sr - 2), min(sub.shape[0], sr + 3))
           for j in range(max(0, sc - 2), min(sub.shape[1], sc + 3))
           if sub[i, j] <= zs + 5.0]
    src_r = np.array([s[0] for s in src]); src_c = np.array([s[1] for s in src])

    res = run_swe(sub, dx, dy,
                  hydrograph["time_s"].values, hydrograph["discharge_cumecs"].values,
                  src_r, src_c, sim_hours * 3600.0, manning_n=manning_n)

    md, arr = res["max_depth"], res["arrival_time_s"]
    mv = res["max_velocity"].copy()
    mv[max(0, sr - 3):sr + 4, max(0, sc - 3):sc + 4] = 0.0   # source patch ka numerical spike ignore karo
    flooded = md > 0.1
    area_km2 = float(flooded.sum()) * dx * dy / 1e6

    iso = np.zeros(md.shape, dtype=np.uint8)
    iso[(arr >= 0) & (arr < 1800)] = 1
    iso[(arr >= 1800) & (arr < 3600)] = 2
    iso[(arr >= 3600) & (arr < 7200)] = 3
    iso[arr >= 7200] = 4

    dcls = np.zeros(md.shape, dtype=np.uint8)
    dcls[(md > 0.1) & (md <= 0.5)] = 1
    dcls[(md > 0.5) & (md <= 1.5)] = 2
    dcls[(md > 1.5) & (md <= 3.0)] = 3
    dcls[md > 3.0] = 4

    iso_geojson = _to_geojson(
        iso, sub_tf, lambda v: {"zone_id": v, "lead_time": ZONE_LABELS[v], "color": ZONE_COLORS[v]})
    depth_geojson = _to_geojson(
        dcls, sub_tf, lambda v: {"zone_id": v, "depth_class": DEPTH_LABELS[v], "color": ZONE_COLORS[5 - v]})

    # flooded raster ko original DEM size mein wapas daalo (purane code jaisa)
    full = np.zeros(dem.shape, dtype=bool)
    up = np.repeat(np.repeat(flooded, k, axis=0), k, axis=1)
    full[r0:r0 + up.shape[0], c0:c0 + up.shape[1]] = up[:dem.shape[0] - r0, :dem.shape[1] - c0]

    return {
        "flooded_area_sq_km": round(area_km2, 2),
        "flood_level_m": round(float(zs + md[sr, sc]), 2),
        "max_depth_m": round(float(md.max()), 2),
        "max_velocity_ms": round(float(mv.max()), 2),
        "estimated_affected_population": int(area_km2 * 350),   # placeholder: flat density
        "geojson": iso_geojson,            # isochrone bands (frontend jaisa ab tak tha)
        "depth_geojson": depth_geojson,    # naya: depth classes
        "flooded_raster": full,
        "mass_balance_error_pct": round(res["mass_balance_error_pct"], 3),
        "steps": res["steps"],
        "runtime_s": round(time.time() - t0, 1),
    }