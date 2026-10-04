
import math
import os
import sys
 
import numpy as np
import pandas as pd
 
G = 9.81
 
 
def froehlich_breach(dam_height, storage_volume, mode="overtopping"):
    """
    Froehlich (2008) breach width + formation time, Froehlich (1995) peak outflow.
    dam_height: m, storage_volume: m3, mode: 'overtopping' ya 'piping'
    """
    k0 = 1.3 if mode == "overtopping" else 1.0
    side_slope = 1.0 if mode == "overtopping" else 0.7  # z (H:V)
 
    breach_width = 0.27 * k0 * (storage_volume ** 0.32) * (dam_height ** 0.04)  # average width
    formation_time = 63.2 * math.sqrt(storage_volume / (G * dam_height ** 2))     # seconds
    peak_outflow = 0.607 * (storage_volume ** 0.295) * (dam_height ** 1.24)       # empirical Qp
 
    return {
        "breach_width_m": breach_width,
        "side_slope_z": side_slope,
        "formation_time_s": formation_time,
        "peak_outflow_cumecs": peak_outflow,
    }
 
 
def _route(dam_height, storage_volume, p, cw_scale):
    """Weir-equation routing; cw_scale weir coefficients ko scale karta hai."""
    H = dam_height
    tf = p["formation_time_s"]
    z = p["side_slope_z"]
 
    # average width = bottom width + z * depth  ->  final bottom width
    bb_final = max(p["breach_width_m"] - z * H, 0.1 * p["breach_width_m"])
 
    area = storage_volume / H            # prismatic reservoir surface area (m2)
    volume = storage_volume
    dt = max(1.0, min(60.0, tf / 100.0))
    t_max = max(20.0 * tf, 6 * 3600.0)
 
    t = 0.0
    times, flows = [0.0], [0.0]
    while volume > 0.02 * storage_volume and t < t_max:
        t += dt
        frac = min(t / tf, 1.0)
        breach_invert = H * (1.0 - frac)          # breach bottom elevation above dam base
        head = volume / area - breach_invert      # water level - breach invert
 
        if head <= 0:
            q = 0.0
        else:
            bb = bb_final * frac
            q = cw_scale * (1.7 * bb * head ** 1.5 + 1.35 * z * head ** 2.5)
            q = min(q, volume / dt)              # volume se zyada paani nahi nikal sakta
 
        volume -= q * dt
        times.append(t)
        flows.append(q)
 
    return np.array(times), np.array(flows)
 
 
def breach_hydrograph(dam_height, storage_volume, mode="overtopping", calibrate=True):
    """
    Time-varying outflow hydrograph.
    Breach crest se base tak linearly formation_time mein grow karta hai,
    flow broad-crested weir equation se, reservoir volume har step pe kam hota hai.
    calibrate=True: weir coefficient ko bisection se adjust karte hain taaki routed peak
    empirical Froehlich peak se match kare (volume conserve rehta hai, hydrograph ka shape routing se aata hai).
    Assumptions: reservoir full at crest level, prismatic reservoir, breach invert dam base tak jaata hai.
    """
    p = froehlich_breach(dam_height, storage_volume, mode)
    target = p["peak_outflow_cumecs"]
 
    scale = 1.0
    if calibrate:
        lo, hi = 0.05, 1.0
        if _route(dam_height, storage_volume, p, hi)[1].max() > target:
            if _route(dam_height, storage_volume, p, lo)[1].max() > target:
                scale = lo
            else:
                for _ in range(30):
                    mid = 0.5 * (lo + hi)
                    if _route(dam_height, storage_volume, p, mid)[1].max() > target:
                        hi = mid
                    else:
                        lo = mid
                scale = 0.5 * (lo + hi)
 
    times, flows = _route(dam_height, storage_volume, p, scale)
    p["weir_calibration_factor"] = scale
    return pd.DataFrame({"time_s": times, "discharge_cumecs": flows}), p
 
 
def process_dataset(csv_path, mode="overtopping", out_dir="hydrographs"):
    """
    CSV columns: dam_name, height_m, storage_m3
    Har dam ke liye breach parameters + routed hydrograph calculate karta hai.
    """
    df = pd.read_csv(csv_path)
    os.makedirs(out_dir, exist_ok=True)
    results = []
 
    for _, row in df.iterrows():
        hydro, p = breach_hydrograph(row["height_m"], row["storage_m3"], mode)
        peak_routed = float(hydro["discharge_cumecs"].max())
 
        results.append({
            "dam_name": row["dam_name"],
            "failure_mode": mode,
            "breach_width_m": round(p["breach_width_m"], 2),
            "formation_time_hr": round(p["formation_time_s"] / 3600, 2),
            "peak_outflow_empirical_cumecs": round(p["peak_outflow_cumecs"], 2),
            "peak_outflow_routed_cumecs": round(peak_routed, 2),
            "weir_calibration_factor": round(p["weir_calibration_factor"], 3),
        })
 
        safe_name = str(row["dam_name"]).replace(" ", "_").replace("/", "_")
        hydro.to_csv(os.path.join(out_dir, f"{safe_name}_hydrograph.csv"), index=False)
 
    return pd.DataFrame(results)
 
 
if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "dams_data.csv"
    output = process_dataset(path)
    print(output.to_string(index=False))
    output.to_csv("breach_results.csv", index=False)
    print("\nResults 'breach_results.csv' mein save ho gaye, hydrographs 'hydrographs/' folder mein.")
 
