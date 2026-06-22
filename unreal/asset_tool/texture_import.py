from pathlib import Path

import unreal

from .data_assets import ensure_directory, split_object_path
from .unreal_props import enum_value, try_set_first_property


def import_texture(metadata, source_png_path: Path, warn):
    texture_object_path = metadata["unreal"]["expectedTextureObjectPath"]
    destination_path, texture_name = split_object_path(texture_object_path)

    ensure_directory(destination_path)

    task = unreal.AssetImportTask()
    task.filename = str(source_png_path)
    task.destination_path = destination_path
    task.destination_name = texture_name
    task.automated = True
    task.replace_existing = True
    task.save = True

    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])

    texture = unreal.load_asset(f"{destination_path}/{texture_name}")
    if texture is None:
        raise RuntimeError(f"Texture import failed: {destination_path}/{texture_name}")

    settings = metadata["unreal"].get("textureSettings", {})

    if settings.get("MipGenSettings") == "NoMipmaps":
        try_set_first_property(
            texture,
            ["mip_gen_settings", "MipGenSettings"],
            enum_value(
                unreal.TextureMipGenSettings,
                ["TMGS_NO_MIPMAPS", "TMGS_NoMipmaps", "TMGS_NOMIPMAPS"],
            ),
            warn,
        )

    if settings.get("CompressionSettings", "Default") == "Default":
        try_set_first_property(
            texture,
            ["compression_settings", "CompressionSettings"],
            enum_value(unreal.TextureCompressionSettings, ["TC_DEFAULT", "TC_Default"]),
            warn,
        )

    if "sRGB" in settings:
        try_set_first_property(texture, ["srgb", "SRGB", "sRGB"], bool(settings["sRGB"]), warn)

    if hasattr(unreal, "TextureAddress"):
        address_candidates = {
            "Wrap": ["TA_WRAP", "TA_Wrap"],
            "Clamp": ["TA_CLAMP", "TA_Clamp"],
            "Mirror": ["TA_MIRROR", "TA_Mirror"],
        }
        if "AddressX" in settings:
            try_set_first_property(
                texture,
                ["address_x", "AddressX"],
                enum_value(unreal.TextureAddress, address_candidates.get(settings["AddressX"], [settings["AddressX"]])),
                warn,
            )
        if "AddressY" in settings:
            try_set_first_property(
                texture,
                ["address_y", "AddressY"],
                enum_value(unreal.TextureAddress, address_candidates.get(settings["AddressY"], [settings["AddressY"]])),
                warn,
            )

    if hasattr(unreal, "TextureGroup"):
        group_name = settings.get("TextureGroup")
        group_candidates = {
            "Project01": ["TEXTUREGROUP_PROJECT01", "TEXTUREGROUP_UI_STREAMABLE", "TEXTUREGROUP_UI"],
            "UI Streamable": ["TEXTUREGROUP_UI_STREAMABLE", "TEXTUREGROUP_UI"],
            "UI": ["TEXTUREGROUP_UI", "TEXTUREGROUP_UI_STREAMABLE"],
        }.get(group_name, ["TEXTUREGROUP_PROJECT01", "TEXTUREGROUP_UI_STREAMABLE", "TEXTUREGROUP_UI"])
        try:
            try_set_first_property(texture, ["lod_group", "LODGroup"], enum_value(unreal.TextureGroup, group_candidates), warn)
        except Exception as exc:
            warn(f"Could not set texture group automatically: {exc}")

    unreal.EditorAssetLibrary.save_loaded_asset(texture)
    return texture
