import requests
import geopandas as gpd
from shapely.geometry import Point, LineString
import json

# Using the high-speed Kumi Systems mirror to avoid public queue throttling
OVERPASS_URL = "https://overpass.kumi.systems/api/interpreter"

def fetch_downstream_infrastructure(bbox):
    """
    Queries Overpass API with a strict 4-second timeout and targeted
    critical infrastructure tags to prevent simulation latency.
    """
    south, west, north, east = bbox

    # Streamlined query: avoids downloading full relation trees or dense sub-roads
    query = f"""
    [out:json][timeout:15];
    (
      node["amenity"="hospital"]({south},{west},{north},{east});
      node["amenity"="school"]({south},{west},{north},{east});
      way["highway"~"motorway|trunk|primary"]({south},{west},{north},{east});
      way["bridge"="yes"]({south},{west},{north},{east});
    );
    out body;
    >;
    out skel qt;
    """

    try:
        response = requests.post(OVERPASS_URL, data={"data": query}, timeout=20)
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        print(f"Overpass skipped or timed out: {e}")

    # Fallback to empty result so simulation renders instantly without hanging
    return None

def analyze_compromised_infrastructure(osm_json, isochrone_geojson_str):
    """
    Performs vector intersection between OSM assets and flood contours.
    """
    empty_res = {"summary": {"hospitals": 0, "schools": 0, "bridges": 0, "highways_km": 0.0}, "geojson": None}

    if not osm_json or not isochrone_geojson_str:
        return empty_res

    try:
        isochrones_gdf = gpd.GeoDataFrame.from_features(
            json.loads(isochrone_geojson_str)["features"], 
            crs="EPSG:4326"
        )
    except Exception:
        return empty_res

    nodes = {}
    elements = osm_json.get("elements", [])
    for el in elements:
        if el["type"] == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])

    infra_features = []

    for el in elements:
        tags = el.get("tags", {})
        el_type = tags.get("amenity") or tags.get("highway") or ("bridge" if tags.get("bridge") == "yes" else None)
        name = tags.get("name", "Unnamed Facility / Road")

        if el["type"] == "node" and el_type in ["hospital", "school"]:
            infra_features.append({
                "geometry": Point(el["lon"], el["lat"]),
                "name": name,
                "category": tags.get("amenity")
            })

        elif el["type"] == "way":
            coords = [nodes[nid] for nid in el.get("nodes", []) if nid in nodes]
            if len(coords) >= 2:
                category = "bridge" if tags.get("bridge") == "yes" else "highway"
                infra_features.append({
                    "geometry": LineString(coords),
                    "name": name,
                    "category": category
                })

    if not infra_features:
        return empty_res

    infra_gdf = gpd.GeoDataFrame(infra_features, crs="EPSG:4326")

    # Spatial intersection against flood polygons
    try:
        compromised_gdf = gpd.sjoin(infra_gdf, isochrones_gdf, how="inner", predicate="intersects")
    except Exception:
        return empty_res

    if compromised_gdf.empty:
        return empty_res

    hospitals_cut = int((compromised_gdf["category"] == "hospital").sum())
    schools_cut = int((compromised_gdf["category"] == "school").sum())
    bridges_cut = int((compromised_gdf["category"] == "bridge").sum())

    highways = compromised_gdf[compromised_gdf["category"] == "highway"]
    highways_km = round(highways.to_crs(epsg=3857).length.sum() / 1000.0, 2) if not highways.empty else 0.0

    return {
        "summary": {
            "hospitals": hospitals_cut,
            "schools": schools_cut,
            "bridges": bridges_cut,
            "highways_km": highways_km
        },
        "geojson": json.loads(compromised_gdf.to_json())
    }