import unreal


def enum_value(enum_type, candidates):
    for candidate in candidates:
        if hasattr(enum_type, candidate):
            return getattr(enum_type, candidate)
    available = ", ".join(name for name in dir(enum_type) if name.isupper() or name.startswith("ESIT"))
    raise RuntimeError(f"None of {candidates} found on {enum_type}; available: {available}")


def set_first_property(obj, names, value):
    last_error = None
    for name in names:
        try:
            obj.set_editor_property(name, value)
            return name
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Could not set any of {names} on {obj}: {last_error}")


def try_set_first_property(obj, names, value, warn):
    try:
        return set_first_property(obj, names, value)
    except Exception as exc:
        warn(str(exc))
        return None


def text_value(value):
    if hasattr(unreal, "Text"):
        try:
            return unreal.Text(value)
        except Exception:
            try:
                return unreal.Text.cast(value)
            except Exception:
                pass
    return value


def make_directory_path(path):
    directory_path = unreal.DirectoryPath()
    set_first_property(directory_path, ["path", "Path"], path)
    return directory_path


def make_soft_class_path(class_path):
    asset_class = unreal.load_class(None, class_path)
    if asset_class is not None:
        return asset_class

    for type_name in ["TopLevelAssetPath", "SoftClassPath", "SoftObjectPath"]:
        if hasattr(unreal, type_name):
            type_obj = getattr(unreal, type_name)
            try:
                return type_obj(class_path)
            except Exception:
                pass
    return class_path

