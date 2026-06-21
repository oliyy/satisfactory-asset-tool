import json
import os
import re
import sys
import time
from pathlib import Path

import unreal


LOG_PREFIX = "SatAssetTool"
DEFAULT_PACKAGE_PATHS = ["/Game/FactoryGame"]
DEFAULT_KEYWORDS = ["icon", "ui", "desc"]
TEXTURE_CLASS_PATH = "/Script/Engine.Texture2D"
MATERIAL_TEXTURE_WORDS = {
    "albedo",
    "ao",
    "bc",
    "emissive",
    "mask",
    "metallic",
    "mreo",
    "n",
    "normal",
    "nrm",
    "opacity",
    "orm",
    "reflection",
    "rma",
    "roughness",
}


def log(message):
    unreal.log(f"[{LOG_PREFIX}] {message}")


def parse_bool(value):
    return str(value).lower() in {"1", "true", "yes", "on"}


def parse_optional_int(value, label):
    if value in (None, ""):
        return None
    parsed = int(value)
    if parsed <= 0:
        raise RuntimeError(f"{label} must be a positive integer")
    return parsed


def split_csv(value):
    return [part.strip() for part in str(value).split(",") if part.strip()]


def dedupe(values):
    return list(dict.fromkeys(values))


def option_values(name):
    prefix = f"--{name}="
    values = []
    for arg in sys.argv[1:]:
        if arg.startswith(prefix):
            values.extend(split_csv(arg[len(prefix) :]))
    return values


def option_value(name, default=None):
    prefix = f"--{name}="
    for arg in sys.argv[1:]:
        if arg.startswith(prefix):
            return arg[len(prefix) :]
    return default


def has_flag(name):
    return f"--{name}" in sys.argv[1:]


def parse_options():
    package_paths = dedupe(
        option_values("package-path")
        or split_csv(os.environ.get("SAT_ASSET_TEXTURE_SCAN_PACKAGE_PATHS", ""))
        or DEFAULT_PACKAGE_PATHS
    )
    keywords = dedupe(
        [keyword.lower() for keyword in option_values("keyword")]
        or [keyword.lower() for keyword in split_csv(os.environ.get("SAT_ASSET_TEXTURE_SCAN_KEYWORDS", ""))]
        or DEFAULT_KEYWORDS
    )
    output = option_value(
        "output",
        os.environ.get("SAT_ASSET_TEXTURE_SCAN_OUTPUT", ""),
    )
    limit = parse_optional_int(
        option_value("limit", os.environ.get("SAT_ASSET_TEXTURE_SCAN_LIMIT")),
        "limit",
    )
    preview_limit = parse_optional_int(
        option_value("preview-limit", os.environ.get("SAT_ASSET_TEXTURE_SCAN_PREVIEW_LIMIT")),
        "preview-limit",
    )
    dimensions_limit = parse_optional_int(
        option_value("dimensions-limit", os.environ.get("SAT_ASSET_TEXTURE_SCAN_DIMENSIONS_LIMIT")),
        "dimensions-limit",
    )
    include_dimensions = has_flag("include-dimensions") or parse_bool(
        os.environ.get("SAT_ASSET_TEXTURE_SCAN_INCLUDE_DIMENSIONS", "")
    )

    if not output:
        raise RuntimeError("Missing SAT_ASSET_TEXTURE_SCAN_OUTPUT or --output")

    return {
        "package_paths": package_paths,
        "keywords": keywords,
        "output": output,
        "limit": limit,
        "preview_limit": preview_limit if preview_limit is not None else 25,
        "include_dimensions": include_dimensions,
        "dimensions_limit": dimensions_limit,
    }


def words_for(value):
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(value))
    return [part.lower() for part in re.split(r"[^A-Za-z0-9]+", spaced) if part]


def path_segments(value):
    return [part.lower() for part in str(value).split("/") if part]


def suggested_slug(asset_name):
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", str(asset_name))
    slug = re.sub(r"[^A-Za-z0-9]+", "-", spaced).strip("-").lower()
    return slug or str(asset_name).lower()


def suggested_display_name(asset_name):
    return " ".join(part[:1].upper() + part[1:] for part in words_for(asset_name))


def class_path_string(class_path):
    return f"{class_path.package_name}.{class_path.asset_name}"


def object_path_for(asset_data):
    return f"{asset_data.package_name}.{asset_data.asset_name}"


def has_icon_signal(asset_name, package_path):
    name_lower = str(asset_name).lower()
    words = words_for(asset_name)
    segments = path_segments(package_path)
    return (
        "icon" in words
        or name_lower.startswith("icondesc")
        or any("icon" in word for word in words)
        or any("icon" in segment for segment in segments)
    )


def has_desc_signal(asset_name, package_path):
    name_lower = str(asset_name).lower()
    words = words_for(asset_name)
    segments = path_segments(package_path)
    return (
        "desc" in words
        or name_lower.startswith("icondesc")
        or any(segment in {"descriptor", "descriptors"} or "descriptor" in segment for segment in segments)
    )


def has_ui_signal(asset_name, package_path):
    name_lower = str(asset_name).lower()
    words = words_for(asset_name)
    segments = path_segments(package_path)
    return "ui" in segments or "ui" in words or "txui" in words or name_lower.startswith("txui")


def has_generic_keyword_signal(keyword, asset_name, package_path):
    keyword_lower = keyword.lower()
    words = words_for(asset_name)
    segments = path_segments(package_path)
    return keyword_lower in words or keyword_lower in segments


def matched_keywords(asset_name, package_path, keywords):
    matches = []
    for keyword in keywords:
        if keyword == "icon" and has_icon_signal(asset_name, package_path):
            matches.append(keyword)
        elif keyword == "desc" and has_desc_signal(asset_name, package_path):
            matches.append(keyword)
        elif keyword == "ui" and has_ui_signal(asset_name, package_path):
            matches.append(keyword)
        elif keyword not in {"icon", "desc", "ui"} and has_generic_keyword_signal(keyword, asset_name, package_path):
            matches.append(keyword)
    return matches


def is_likely_material_texture(asset_name):
    words = set(words_for(asset_name))
    return bool(words.intersection(MATERIAL_TEXTURE_WORDS))


def texture_dimensions(texture):
    return {
        "width": int(texture.blueprint_get_size_x()),
        "height": int(texture.blueprint_get_size_y()),
    }


def maybe_add_dimensions(record, include_dimensions, dimensions_budget):
    if not include_dimensions or dimensions_budget["remaining"] == 0:
        return record

    texture = unreal.load_asset(record["textureObjectPath"])
    if texture is None:
        record["loadError"] = "unreal.load_asset returned None"
        dimensions_budget["remaining"] -= 1
        return record

    record["dimensions"] = texture_dimensions(texture)
    dimensions_budget["remaining"] -= 1
    return record


def asset_record(asset_data, keywords, include_dimensions, dimensions_budget):
    asset_name = str(asset_data.asset_name)
    package_name = str(asset_data.package_name)
    package_path = str(asset_data.package_path)
    class_path = asset_data.asset_class_path
    matches = matched_keywords(asset_name, package_path, keywords)

    if keywords and not matches:
        return None

    if is_likely_material_texture(asset_name) and not any(keyword in matches for keyword in ["icon", "desc"]):
        return None

    record = {
        "slug": suggested_slug(asset_name),
        "displayName": suggested_display_name(asset_name),
        "textureObjectPath": f"{package_name}.{asset_name}",
        "packageName": package_name,
        "packagePath": package_path,
        "assetName": asset_name,
        "className": str(class_path.asset_name),
        "classPath": class_path_string(class_path),
        "matchedKeywords": matches,
    }
    return maybe_add_dimensions(record, include_dimensions, dimensions_budget)


def texture_assets_for_package_paths(package_paths):
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.search_all_assets(True)
    registry.wait_for_completion()

    texture_class_path = unreal.TopLevelAssetPath("/Script/Engine", "Texture2D")
    assets = []
    for package_path in package_paths:
        assets.extend(
            list(
                registry.get_assets(
                    unreal.ARFilter(
                        class_paths=[texture_class_path],
                        package_paths=[package_path],
                        recursive_paths=True,
                        recursive_classes=True,
                        include_only_on_disk_assets=False,
                    )
                )
            )
        )

    by_object_path = {}
    for asset_data in assets:
        by_object_path[object_path_for(asset_data)] = asset_data
    return list(by_object_path.values())


def build_output(options, assets, candidates, elapsed_seconds):
    preview_assets = [
        {
            "slug": record["slug"],
            "displayName": record["displayName"],
            "textureObjectPath": record["textureObjectPath"],
        }
        for record in candidates[: options["preview_limit"]]
    ]

    return {
        "schema": "satisfactory-asset-tool-unreal-texture-scan",
        "schemaVersion": 1,
        "scan": {
            "packagePaths": options["package_paths"],
            "classPath": TEXTURE_CLASS_PATH,
            "keywords": options["keywords"],
            "totalTextureCount": len(assets),
            "candidateCount": len(candidates),
            "limit": options["limit"],
            "previewLimit": options["preview_limit"],
            "includeDimensions": options["include_dimensions"],
            "dimensionsLimit": options["dimensions_limit"],
            "elapsedSeconds": round(elapsed_seconds, 3),
        },
        "candidates": candidates,
        "assetPackConfigSnippet": {
            "source": {
                "type": "unreal-texture-list",
                "assets": preview_assets,
            }
        },
    }


def main():
    started = time.perf_counter()
    options = parse_options()
    assets = texture_assets_for_package_paths(options["package_paths"])
    dimensions_budget = {
        "remaining": options["dimensions_limit"]
        if options["dimensions_limit"] is not None
        else len(assets)
    }

    candidates = []
    for asset_data in sorted(assets, key=lambda asset: (str(asset.package_path).lower(), str(asset.asset_name).lower())):
        record = asset_record(asset_data, options["keywords"], options["include_dimensions"], dimensions_budget)
        if record is None:
            continue
        candidates.append(record)
        if options["limit"] is not None and len(candidates) >= options["limit"]:
            break

    elapsed_seconds = time.perf_counter() - started
    output = build_output(options, assets, candidates, elapsed_seconds)
    output_path = Path(options["output"]).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    log(
        "TEXTURE_SCAN_SUMMARY "
        + json.dumps(
            {
                "candidateCount": len(candidates),
                "elapsedSeconds": round(elapsed_seconds, 3),
                "includeDimensions": options["include_dimensions"],
                "output": str(output_path),
                "totalTextureCount": len(assets),
            },
            sort_keys=True,
        )
    )


main()
