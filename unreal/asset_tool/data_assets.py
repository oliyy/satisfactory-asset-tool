import unreal


def ensure_directory(asset_path):
    if not unreal.EditorAssetLibrary.does_directory_exist(asset_path):
        unreal.EditorAssetLibrary.make_directory(asset_path)


def create_or_load_data_asset(asset_name, package_path, class_path):
    asset_path = f"{package_path}/{asset_name}"
    existing = unreal.load_asset(asset_path)
    if existing is not None:
        return existing

    asset_class = unreal.load_class(None, class_path)
    if asset_class is None:
        raise RuntimeError(f"Could not load class: {class_path}")

    factory = unreal.DataAssetFactory()
    factory.set_editor_property("data_asset_class", asset_class)

    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        asset_name,
        package_path,
        asset_class,
        factory,
    )


def split_object_path(object_path):
    asset_path = object_path.split(".", 1)[0]
    package_path, asset_name = asset_path.rsplit("/", 1)
    return package_path, asset_name

