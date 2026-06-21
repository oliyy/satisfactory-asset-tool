import unreal

from .data_assets import create_or_load_data_asset
from .unreal_props import make_directory_path, make_soft_class_path, set_first_property, try_set_first_property


def create_game_feature_data(manifest, warn, log):
    mod_ref = manifest["modRef"]
    package_path = f"/{mod_ref}"
    asset_name = mod_ref
    icon_library_asset_path = manifest["iconLibraryAssetPath"].split(".", 1)[0]
    icon_library_dir = icon_library_asset_path.rsplit("/", 1)[0]

    game_feature = create_or_load_data_asset(
        asset_name,
        package_path,
        "/Script/FactoryGame.FGGameFeatureData",
    )
    if game_feature is None:
        raise RuntimeError("Could not create FGGameFeatureData asset")

    if not hasattr(unreal, "PrimaryAssetTypeInfo"):
        warn("PrimaryAssetTypeInfo is not available to Python; create the scan rule manually.")
        unreal.EditorAssetLibrary.save_loaded_asset(game_feature)
        return game_feature

    info = unreal.PrimaryAssetTypeInfo()
    set_first_property(info, ["primary_asset_type", "PrimaryAssetType"], "FGIconLibrary")
    set_first_property(info, ["asset_base_class", "AssetBaseClass"], make_soft_class_path("/Script/FactoryGame.FGIconLibrary"))
    set_first_property(info, ["directories", "Directories"], [make_directory_path(icon_library_dir)])
    set_first_property(info, ["specific_assets", "SpecificAssets"], [])
    try_set_first_property(info, ["has_blueprint_classes", "bHasBlueprintClasses"], False, warn)
    try_set_first_property(info, ["is_editor_only", "bIsEditorOnly"], False, warn)

    set_first_property(game_feature, ["primary_asset_types_to_scan", "PrimaryAssetTypesToScan"], [info])
    unreal.EditorAssetLibrary.save_loaded_asset(game_feature)
    log(f"Created/updated game feature data: {package_path}/{asset_name}")
    return game_feature

