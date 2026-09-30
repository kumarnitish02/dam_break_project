import rasterio
from rasterio.features import shapes
import geopandas as gpd
from shapely.geometry import shape

# Flood extent raster kholo
with rasterio.open("flood_extent.tif") as src:
    flood_data = src.read(1)
    transform = src.transform
    crs = src.crs

# Raster ko polygon shapes mein convert karo (sirf flooded areas, value=1)
results = (
    {"properties": {"flooded": v}, "geometry": s}
    for s, v in shapes(flood_data, transform=transform)
    if v == 1
)

geoms = list(results)
print(f"Total flood polygons found: {len(geoms)}")

# GeoDataFrame banao
gdf = gpd.GeoDataFrame.from_features(geoms, crs=crs)

# Chhote/noise polygons hata do (bahut chhote fragments)
gdf["area"] = gdf.geometry.area
gdf = gdf[gdf["area"] > 1000]  # sirf 1000 sq meters se bade polygons rakho

# Sab polygons ko ek single polygon mein merge karo (cleaner output)
merged = gdf.dissolve()

# Save karo .shp aur .kml dono mein
merged.to_file("bhakra_flood_extent.shp")
print("Shapefile save ho gaya: bhakra_flood_extent.shp")

# KML ke liye alag driver chahiye
merged.to_file("bhakra_flood_extent.kml", driver="KML")
print("KML file save ho gayi: bhakra_flood_extent.kml")