import unreal

from .data_assets import create_or_load_data_asset, ensure_directory, split_object_path
from .unreal_props import enum_value, set_first_property, text_value, try_set_first_property


def icon_type_value(icon_type_name):
    icon_enum = getattr(unreal, "IconType", None) or getattr(unreal, "EIconType", None)
    if icon_enum is None:
        raise RuntimeError("FactoryGame icon type enum is not available to Python")

    requested = icon_type_name.split("::")[-1]
    candidates = [
        requested,
        requested.upper(),
        requested.replace("ESIT_", "ESIT").upper(),
        "ESIT_CUSTOM",
        "ESIT_Custom",
        "ESIT_MONOCHROME",
        "ESIT_Monochrome",
    ]
    return enum_value(icon_enum, candidates)


def create_icon_data(entry, icon_object, warn):
    if not hasattr(unreal, "IconData"):
        raise RuntimeError("FactoryGame IconData struct is not available to Python")

    icon_data = unreal.IconData()
    set_first_property(icon_data, ["id", "ID"], int(entry["ID"]))
    set_first_property(icon_data, ["texture", "Texture"], icon_object)
    try_set_first_property(icon_data, ["item_descriptor", "ItemDescriptor"], None, warn)
    set_first_property(icon_data, ["display_name_override", "DisplayNameOverride"], bool(entry["DisplayNameOverride"]))
    set_first_property(icon_data, ["icon_name", "IconName"], text_value(entry["IconName"]))
    set_first_property(icon_data, ["icon_type", "IconType"], icon_type_value(entry["IconType"]))
    set_first_property(icon_data, ["hidden", "Hidden"], bool(entry["Hidden"]))
    set_first_property(icon_data, ["search_only", "SearchOnly"], bool(entry["SearchOnly"]))
    set_first_property(icon_data, ["animated", "Animated"], bool(entry["Animated"]))
    return icon_data


def create_icon_library(manifest, metadata_entries, icon_objects, warn, log):
    package_path, asset_name = split_object_path(manifest["iconLibraryAssetPath"])
    ensure_directory(package_path)

    icon_library = create_or_load_data_asset(
        asset_name,
        package_path,
        "/Script/FactoryGame.FGIconLibrary",
    )
    if icon_library is None:
        raise RuntimeError("Could not create FGIconLibrary asset")

    icon_data_entries = []
    for metadata in metadata_entries:
        entry = metadata["unreal"]["iconLibraryEntry"]
        icon_asset_name = metadata["unreal"].get("iconAssetName", metadata["unreal"]["textureAssetName"])
        icon_data_entries.append(create_icon_data(entry, icon_objects[icon_asset_name], warn))

    set_first_property(icon_library, ["m_icon_data", "mIconData"], icon_data_entries)
    try_set_first_property(icon_library, ["m_custom_icon_data", "mCustomIconData"], [], warn)

    unreal.EditorAssetLibrary.save_loaded_asset(icon_library)
    log(f"Created/updated icon library: {package_path}/{asset_name} with {len(icon_data_entries)} icon(s)")
    return icon_library
