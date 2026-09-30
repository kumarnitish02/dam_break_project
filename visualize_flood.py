import os
import matplotlib
# Enforce non-interactive backend to prevent GUI thread locks on Windows
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

OUTPUT_DIR = "simulation_outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def generate_analytical_preview(dem: np.ndarray, flooded_raster: np.ndarray, dam_name: str) -> str:
    """
    Renders a diagnostic top-down preview of the terrain elevation with the
    inundation extent footprint overlaid, saving directly to disk.
    """
    safe_name = dam_name.replace(" ", "_").lower()
    output_path = os.path.join(OUTPUT_DIR, f"{safe_name}_preview.png")

    try:
        fig, ax = plt.subplots(figsize=(7, 6))

        # 1. Base digital elevation model
        terrain_plot = ax.imshow(dem, cmap='terrain', origin='upper')
        cbar = plt.colorbar(terrain_plot, ax=ax, fraction=0.046, pad=0.04)
        cbar.set_label('Elevation (m ASL)', rotation=270, labelpad=15)

        # 2. Downstream flood extent overlay
        if flooded_raster is not None and np.any(flooded_raster):
            masked_flood = np.ma.masked_where(~flooded_raster, flooded_raster)
            ax.imshow(masked_flood, cmap='Blues', alpha=0.65, origin='upper')

        ax.set_title(f"Diagnostic Flood Extent: {dam_name}", fontsize=12, fontweight='bold')
        ax.set_xlabel("Grid X (Pixels)")
        ax.set_ylabel("Grid Y (Pixels)")

        plt.tight_layout()
        plt.savefig(output_path, dpi=120, bbox_inches='tight')
        plt.close(fig)

        return output_path

    except Exception as e:
        print(f"[visualize_flood] Preview rendering failed non-critically: {e}")
        return ""