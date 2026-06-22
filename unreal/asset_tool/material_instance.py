import unreal

from .data_assets import ensure_directory, split_object_path


def create_or_update_material_instance(metadata, texture, warn):
    material_data = metadata["unreal"].get("materialInstance")
    if not material_data:
        raise RuntimeError(f"Missing materialInstance metadata for {metadata['unreal']['textureAssetName']}")

    material_object_path = material_data["materialObjectPath"]
    package_path, material_name = split_object_path(material_object_path)
    ensure_directory(package_path)

    parent = unreal.load_asset(material_data["parentMaterialObjectPath"])
    if parent is None:
        raise RuntimeError(f"Could not load parent material: {material_data['parentMaterialObjectPath']}")

    material_instance = unreal.load_asset(material_object_path)
    if material_instance is None:
        factory = unreal.MaterialInstanceConstantFactoryNew()
        material_instance = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            material_name,
            package_path,
            unreal.MaterialInstanceConstant,
            factory,
        )

    if material_instance is None:
        raise RuntimeError(f"Could not create material instance: {material_object_path}")

    class_name = material_instance.get_class().get_name()
    if class_name != "MaterialInstanceConstant":
        raise RuntimeError(f"Expected MaterialInstanceConstant at {material_object_path}, got {class_name}")

    editing = unreal.MaterialEditingLibrary
    editing.set_material_instance_parent(material_instance, parent)
    editing.set_material_instance_texture_parameter_value(material_instance, material_data.get("textureParameter", "Texture"), texture)

    for name, value in material_data.get("scalarParameters", {}).items():
        editing.set_material_instance_scalar_parameter_value(material_instance, str(name), float(value))

    try:
        editing.update_material_instance(material_instance)
    except Exception as exc:
        warn(f"Could not update material instance {material_object_path}: {exc}")

    unreal.EditorAssetLibrary.save_loaded_asset(material_instance)
    return material_instance
