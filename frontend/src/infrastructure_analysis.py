import requests
import geopandas as gpd
from shapely.geometry import Point, LineString
import json

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

def fetch_downstream_infrastructure(bbox):
    """
    Queries Overpass API for hospitals, schools, major highways, and bridges
    within the bounding box: (south, west, north, east).
    """
    south, west, north, east = bbox

    query = f"""
    [out:json][timeout:25];
    (
      node["amenity"="hospital"]({south},{west},{north},{east});
      node["amenity"="clinic"]({south},{west},{north},{east});
      node["amenity"="school"]({south},{west},{north},{east});
      way["highway"~"motorway|trunk|primary|secondary"]({south},{west},{north},{east});
      way["bridge"="yes"]({south},{west},{north},{east});
    );
    out body;
    >;
    out skel qt;
    """

    try:
        response = requests.post(OVERPASS_URL, data={"data": query}, timeout=15)
        if response.status_code != 200:
            return None
        return response.json()
    except Exception as e:
        print(f"Overpass API notice: {e}")
        return None

def analyze_compromised_infrastructure(osm_json, isochrone_geojson_str):
    """
    Intersects downstream assets with the inundation isochrone polygons
    and tags each compromised asset with its arrival window.
    """
    if not osm_json or not isochrone_geojson_str:
        return {"summary": {"hospitals": 0, "schools": 0, "bridges": 0, "highways_km": 0}, "geojson": None}

    try:
        isochrones_gdf = gpd.GeoDataFrame.from_features(
            json.loads(isochrone_geojson_str)["features"], 
            crs="EPSG:4326"
        )
    except Exception:
        return {"summary": {"hospitals": 0, "schools": 0, "bridges": 0, "highways_km": 0}, "geojson": None}

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

        if el["type"] == "node" and el_type in ["hospital", "clinic", "school"]:
            pt = Point(el["lon"], el["lat"])
            infra_features.append({
                "geometry": pt,
                "name": name,
                "category": tags.get("amenity", "facility")
            })

        elif el["type"] == "way":
            coords = [nodes[nid] for nid in el.get("nodes", []) if nid in nodes]
            if len(coords) >= 2:
                line = LineString(coords)
                category = "bridge" if tags.get("bridge") == "yes" else "highway"
                infra_features.append({
                    "geometry": line,
                    "name": name,
                    "category": category
                })

    if not infra_features:
        return {"summary": {"hospitals": 0, "schools": 0, "bridges": 0, "highways_km": 0}, "geojson": None}

    infra_gdf = gpd.GeoDataFrame(infra_features, crs="EPSG:4326")

    compromised_gdf = gpd.sjoin(infra_gdf, isochrones_gdf, how="inner", predicate="intersects")

    if compromised_gdf.empty:
        return {"summary": {"hospitals": 0, "schools": 0, "bridges": 0, "highways_km": 0}, "geojson": None}

    hospitals_cut = int((compromised_gdf["category"].isin(["hospital", "clinic"])).sum())
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