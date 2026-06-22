import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import unreal

from asset_tool.game_feature import create_game_feature_data
from asset_tool.icon_library import create_icon_library
from asset_tool.material_instance import create_or_update_material_instance
from asset_tool.texture_import import import_texture


LOG_PREFIX = "SatAssetTool"


def log(message):
    unreal.log(f"[{LOG_PREFIX}] {message}")


def warn(message):
    unreal.log_warning(f"[{LOG_PREFIX}] {message}")


def parse_bool(value):
    return str(value).lower() in {"1", "true", "yes", "on"}


def parse_optional_int(value):
    if value in (None, ""):
        return None
    parsed = int(value)
    if parsed <= 0:
        raise RuntimeError("Limit must be a positive integer")
    return parsed


def normalize_asset_slug(value):
    name = str(value).strip().replace("\\", "/").split("/")[-1]
    for suffix in [".json", ".png", ".svg"]:
        if name.lower().endswith(suffix):
            name = name[: -len(suffix)]
    return name.lower()


def parse_asset_list(value):
    return [
        normalize_asset_slug(part)
        for part in str(value).split(",")
        if normalize_asset_slug(part)
    ]


def parse_options():
    options = {
        "manifest": os.environ.get("SAT_ASSET_PACK_MANIFEST", ""),
        "assets": parse_asset_list(os.environ.get("SAT_ASSET_IMPORT_ASSET", "")),
        "limit": parse_optional_int(os.environ.get("SAT_ASSET_IMPORT_LIMIT")),
        "dry_run": parse_bool(os.environ.get("SAT_ASSET_DRY_RUN", "")),
    }

    for arg in sys.argv[1:]:
        if arg.startswith("--manifest="):
            options["manifest"] = arg.split("=", 1)[1]
        elif arg.startswith("--asset="):
            options["assets"].extend(parse_asset_list(arg.split("=", 1)[1]))
        elif arg.startswith("--limit="):
            options["limit"] = parse_optional_int(arg.split("=", 1)[1])
        elif arg == "--dry-run":
            options["dry_run"] = True

    if not options["manifest"]:
        raise RuntimeError("Missing SAT_ASSET_PACK_MANIFEST or --manifest")

    options["assets"] = list(dict.fromkeys(options["assets"]))
    return options


def load_entries(options):
    manifest_path = Path(options["manifest"]).expanduser().resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    metadata_dir = manifest_path.parent

    entries = []
    for asset in manifest["assets"]:
        metadata_path = metadata_dir / asset["metadataPath"]
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        texture_source = metadata["unreal"].get("textureSource", asset.get("textureSource", "generated"))
        source_png_path = (metadata_dir / asset["texturePath"]).resolve() if texture_source == "generated" else None
        entries.append(
            {
                "manifestAsset": asset,
                "metadata": metadata,
                "sourcePngPath": source_png_path,
                "textureSource": texture_source,
            }
        )

    if options["assets"]:
        wanted = set(options["assets"])
        entries = [
            entry
            for entry in entries
            if normalize_asset_slug(entry["manifestAsset"]["slug"]) in wanted
            or normalize_asset_slug(entry["metadata"]["unreal"]["textureAssetName"]) in wanted
        ]

    entries.sort(key=lambda entry: int(entry["metadata"]["unreal"]["iconLibraryEntry"]["ID"]))

    if options["limit"] is not None:
        entries = entries[: options["limit"]]

    validate_entries(entries)
    log(f"Loaded manifest with {len(entries)} selected asset(s): {manifest_path}")
    return manifest, entries


def validate_entries(entries):
    if not entries:
        raise RuntimeError("No asset metadata entries selected")

    seen_ids = {}
    seen_assets = {}
    seen_icon_objects = {}
    seen_names = {}

    for entry in entries:
        metadata = entry["metadata"]
        unreal_data = metadata["unreal"]
        icon_entry = unreal_data["iconLibraryEntry"]
        icon_id = int(icon_entry["ID"])
        asset_name = unreal_data["textureAssetName"]
        icon_asset_name = unreal_data.get("iconAssetName", asset_name)
        icon_name = str(icon_entry["IconName"])
        source_png_path = entry["sourcePngPath"]
        texture_source = entry["textureSource"]

        if icon_id in seen_ids:
            raise RuntimeError(f"Duplicate asset ID {icon_id}: {seen_ids[icon_id]} and {asset_name}")
        if asset_name.lower() in seen_assets:
            raise RuntimeError(f"Duplicate texture asset name {asset_name}: {seen_assets[asset_name.lower()]}")
        if icon_asset_name.lower() in seen_icon_objects:
            raise RuntimeError(f"Duplicate icon asset name {icon_asset_name}: {seen_icon_objects[icon_asset_name.lower()]}")
        if icon_name.lower() in seen_names:
            raise RuntimeError(f"Duplicate icon display name {icon_name}: {seen_names[icon_name.lower()]}")
        if texture_source not in {"generated", "unreal-existing"}:
            raise RuntimeError(f"Unsupported textureSource for {asset_name}: {texture_source}")
        if texture_source == "generated" and not source_png_path.is_file():
            raise RuntimeError(f"Missing source texture: {source_png_path}")
        if texture_source == "unreal-existing" and not unreal_data.get("expectedTextureObjectPath"):
            raise RuntimeError(f"Missing expectedTextureObjectPath for existing texture: {asset_name}")

        seen_ids[icon_id] = asset_name
        seen_assets[asset_name.lower()] = asset_name
        seen_icon_objects[icon_asset_name.lower()] = asset_name
        seen_names[icon_name.lower()] = asset_name


def load_existing_texture(metadata):
    texture_object_path = metadata["unreal"]["expectedTextureObjectPath"]
    texture = unreal.load_asset(texture_object_path)
    if texture is None:
        raise RuntimeError(f"Could not load existing Unreal texture: {texture_object_path}")

    class_name = texture.get_class().get_name()
    if class_name != "Texture2D":
        raise RuntimeError(f"Expected Texture2D at {texture_object_path}, got {class_name}")

    return texture


def resolve_icon_object(metadata, texture, warn):
    icon_object_type = metadata["unreal"].get("iconObjectType", "texture")
    if icon_object_type == "texture":
        return texture
    if icon_object_type == "sign-background-material-instance":
        return create_or_update_material_instance(metadata, texture, warn)
    raise RuntimeError(f"Unsupported iconObjectType for {metadata['unreal']['textureAssetName']}: {icon_object_type}")


def main():
    options = parse_options()
    manifest, entries = load_entries(options)

    if options["dry_run"]:
        for entry in entries[:20]:
            icon_entry = entry["metadata"]["unreal"]["iconLibraryEntry"]
            log(
                f"DRY_RUN asset id={icon_entry['ID']} name={icon_entry['IconName']} source={entry['textureSource']} texture={entry['metadata']['unreal']['textureAssetName']}"
            )
        if len(entries) > 20:
            log(f"DRY_RUN omitted {len(entries) - 20} additional asset(s)")
        return

    icon_objects = {}
    for index, entry in enumerate(entries, start=1):
        if entry["textureSource"] == "unreal-existing":
            texture = load_existing_texture(entry["metadata"])
        else:
            texture = import_texture(entry["metadata"], entry["sourcePngPath"], warn)

        icon_object = resolve_icon_object(entry["metadata"], texture, warn)
        icon_asset_name = entry["metadata"]["unreal"].get("iconAssetName", entry["metadata"]["unreal"]["textureAssetName"])
        icon_objects[icon_asset_name] = icon_object

        if index % 100 == 0 or index == len(entries):
            verb = "Loaded" if entry["textureSource"] == "unreal-existing" else "Imported"
            log(f"{verb} {index}/{len(entries)} asset(s); latest={icon_asset_name}")

    create_icon_library(manifest, [entry["metadata"] for entry in entries], icon_objects, warn, log)
    create_game_feature_data(manifest, warn, log)
    log("Done. Save all assets, then package with Alpakit when no other build is running.")


main()
