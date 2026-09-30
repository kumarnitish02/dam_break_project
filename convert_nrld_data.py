import pandas as pd
import numpy as np

# Raw NRLD dataset load karo (jo tumने upload kiya)
df = pd.read_csv("Dams.csv", low_memory=False)

# Sirf zaroori columns nikalo, aur missing lat/lon/height wale rows hatao
clean = df[["dm_name", "dm_lat", "dm_long", "dm_height", "dm_status", "stcode"]].copy()
clean.columns = ["dam_name", "latitude", "longitude", "height_m", "status", "state_code"]

clean["latitude"] = pd.to_numeric(clean["latitude"], errors="coerce")
clean["longitude"] = pd.to_numeric(clean["longitude"], errors="coerce")
clean["height_m"] = pd.to_numeric(clean["height_m"], errors="coerce")

# Sirf completed dams rakho, jinka lat/lon/height sahi hai
clean = clean.dropna(subset=["latitude", "longitude", "height_m"])
clean = clean[clean["status"] == "Completed"]
clean = clean[clean["height_m"] > 10]  # bahut chhote structures hatao

# Duplicate dam names hatao
clean = clean.drop_duplicates(subset=["dam_name"])

# Storage estimate karo (rough empirical relation: bade dams ke liye height^2.5 se scale hota hai)
# Ye ek APPROXIMATION hai jab tak asli storage data na mile
clean["capacity_m3"] = (clean["height_m"] ** 2.5) * 1500
clean["current_storage_m3"] = clean["capacity_m3"] * 0.75

# Final columns jo app expect karta hai
final = clean[["dam_name", "height_m", "capacity_m3", "current_storage_m3", "latitude", "longitude"]].copy()
final["river"] = ""
final["state"] = clean["state_code"]

final.to_csv("dams_data_full.csv", index=False)
print(f"Total dams converted: {len(final)}")
print(final.head(10))