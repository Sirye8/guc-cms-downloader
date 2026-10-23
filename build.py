import os
import json
import zipfile
import shutil

DIST_DIR = "dist"
VERSION = "3.0.0"

def create_packages():
    os.makedirs(DIST_DIR, exist_ok=True)
    
    # Read base manifest
    with open("manifest.json", "r", encoding="utf-8") as f:
        base_manifest = json.load(f)
        
    base_manifest["version"] = VERSION
    
    # Files to include
    static_files = [
        "content_script.js",
        "background_script.js",
        "LICENSE",
        "README.md"
    ]
    
    icons = [
        os.path.join("icons", "icon-48.png"),
        os.path.join("icons", "icon-128.png")
    ]
    
    # 1. Chrome / Brave Package (ZIP)
    chrome_manifest = dict(base_manifest)
    chrome_manifest["background"] = {
        "service_worker": "background_script.js"
    }
    
    chrome_zip_path = os.path.join(DIST_DIR, f"guc-cms-downloader-chrome-brave-v{VERSION}.zip")
    with zipfile.ZipFile(chrome_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(chrome_manifest, indent=2))
        for sf in static_files:
            if os.path.exists(sf):
                zf.write(sf, sf)
        for ic in icons:
            if os.path.exists(ic):
                zf.write(ic, ic)
    print(f"Created: {chrome_zip_path}")
    
    # Also save a generic name for releases: guc-cms-downloader.zip
    generic_zip = os.path.join(DIST_DIR, "guc-cms-downloader.zip")
    shutil.copyfile(chrome_zip_path, generic_zip)
    print(f"Created: {generic_zip}")
    
    # 2. Firefox Package (XPI / ZIP)
    firefox_manifest = dict(base_manifest)
    # Firefox MV3 supports background scripts
    firefox_manifest["background"] = {
        "scripts": ["background_script.js"]
    }
    
    firefox_xpi_path = os.path.join(DIST_DIR, "guc-cms-downloader.xpi")
    with zipfile.ZipFile(firefox_xpi_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(firefox_manifest, indent=2))
        for sf in static_files:
            if os.path.exists(sf):
                zf.write(sf, sf)
        for ic in icons:
            if os.path.exists(ic):
                zf.write(ic, ic)
    print(f"Created: {firefox_xpi_path}")
    
    # 3. Update docs/updates.json
    updates_path = os.path.join("docs", "updates.json")
    if os.path.exists(updates_path):
        with open(updates_path, "r", encoding="utf-8") as f:
            updates_data = json.load(f)
            
        addon_key = "guc-cms-downloader@Sirye8.github.io"
        # Match case-insensitively if needed
        existing_key = None
        for k in updates_data.get("addons", {}):
            if k.lower() == addon_key.lower():
                existing_key = k
                break
                
        key_to_use = existing_key or addon_key
        updates_list = updates_data.get("addons", {}).get(key_to_use, {}).get("updates", [])
        
        # Check if v3.0.0 exists
        has_v3 = any(u.get("version") == VERSION for u in updates_list)
        if not has_v3:
            updates_list.append({
                "version": VERSION,
                "update_link": "https://github.com/Sirye8/guc-cms-downloader/releases/latest/download/guc-cms-downloader.xpi"
            })
            updates_data["addons"][key_to_use]["updates"] = updates_list
            with open(updates_path, "w", encoding="utf-8") as f:
                json.dump(updates_data, f, indent=2)
            print(f"Updated: {updates_path}")
            
    print("Build complete!")

if __name__ == "__main__":
    create_packages()
