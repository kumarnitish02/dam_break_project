import math
import pandas as pd

def froehlich_breach(dam_height, storage_volume):
    """
    dam_height: dam ki height meters mein
    storage_volume: reservoir ka volume cubic meters mein
    Returns: breach width (m), formation time (hours), peak outflow (cumecs)
    """
    breach_width = 0.27 * (storage_volume ** 0.32) * (dam_height ** 0.04)
    formation_time = 63.2 * math.sqrt(storage_volume / (9.81 * dam_height**2))
    peak_outflow = 0.607 * (storage_volume ** 0.295) * (dam_height ** 1.24)

    return {
        "breach_width_m": round(breach_width, 2),
        "formation_time_hr": round(formation_time / 3600, 2),
        "peak_outflow_cumecs": round(peak_outflow, 2)
    }


def process_dataset(csv_path):
    """
    CSV file padhta hai jisme columns hone chahiye:
    dam_name, height_m, storage_m3
    Har dam ke liye breach analysis calculate karta hai.
    """
    df = pd.read_csv(csv_path)
    results = []

    for _, row in df.iterrows():
        breach_result = froehlich_breach(row["height_m"], row["storage_m3"])
        breach_result["dam_name"] = row["dam_name"]
        results.append(breach_result)

    results_df = pd.DataFrame(results)
    return results_df


if __name__ == "__main__":
    output = process_dataset("dams_data.csv")
    print(output)

    # Result ko naya CSV file mein save bhi kar do
    output.to_csv("breach_results.csv", index=False)
    print("\nResults 'breach_results.csv' mein save ho gaye!")