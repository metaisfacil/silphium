.PHONY: build dev icon

ifeq ($(OS),Windows_NT)
PYTHON_ICON = .venv/Scripts/python.exe
else
PYTHON_ICON = .venv/bin/python
endif
ICON_INSET = 0.85

ifeq ($(OS),Windows_NT)
icon:
	@echo Skipping icon generation on Windows. Using existing build/windows/icon.ico.
else
icon:
	rm -f build/appicon.png build/appicon.source.png
	sips -s format png silphium.svg --out build/appicon.source.png >/dev/null
	$(PYTHON_ICON) -c "from PIL import Image; src = Image.open('build/appicon.source.png').convert('RGBA'); canvas = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0)); fill = float('$(ICON_INSET)'); target_side = max(1, int(1024 * fill)); scale = target_side / max(src.width, src.height); new_width = max(1, int(round(src.width * scale))); new_height = max(1, int(round(src.height * scale))); src = src.resize((new_width, new_height), Image.Resampling.LANCZOS); x = (1024 - src.width) // 2; y = (1024 - src.height) // 2; canvas.paste(src, (x, y), src); canvas.save('build/appicon.png')"
	rm -f build/appicon.source.png
	rm -rf build/icon.iconset
	mkdir -p build/icon.iconset build/darwin
	sips -z 16 16 build/appicon.png --out build/icon.iconset/icon_16x16.png >/dev/null
	sips -z 32 32 build/appicon.png --out build/icon.iconset/icon_16x16@2x.png >/dev/null
	sips -z 32 32 build/appicon.png --out build/icon.iconset/icon_32x32.png >/dev/null
	sips -z 64 64 build/appicon.png --out build/icon.iconset/icon_32x32@2x.png >/dev/null
	sips -z 128 128 build/appicon.png --out build/icon.iconset/icon_128x128.png >/dev/null
	sips -z 256 256 build/appicon.png --out build/icon.iconset/icon_128x128@2x.png >/dev/null
	sips -z 256 256 build/appicon.png --out build/icon.iconset/icon_256x256.png >/dev/null
	sips -z 512 512 build/appicon.png --out build/icon.iconset/icon_256x256@2x.png >/dev/null
	sips -z 512 512 build/appicon.png --out build/icon.iconset/icon_512x512.png >/dev/null
	cp build/appicon.png build/icon.iconset/icon_512x512@2x.png
	iconutil -c icns build/icon.iconset -o build/darwin/iconfile.icns
	$(PYTHON_ICON) -c "from PIL import Image; img = Image.open('build/appicon.png').convert('RGBA'); img.save('build/windows/icon.ico', format='ICO', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
	if [ -f build/bin/Silphium.app/Contents/Resources/iconfile.icns ]; then cp build/darwin/iconfile.icns build/bin/Silphium.app/Contents/Resources/iconfile.icns; fi
	rm -rf build/icon.iconset
endif

build:
	$(MAKE) icon
	wails build

dev:
	$(MAKE) icon
	wails dev
