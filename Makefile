.PHONY: build dev icon

# ---------------------------------------------------------------------------
# Version string: YYYYMMDD-<6-char hash>. Falls back to "dev".
# ---------------------------------------------------------------------------
ifeq ($(OS),Windows_NT)
_RAW_VER := $(shell git log -1 --format=%cd-%h --date=format:%Y%m%d --abbrev=6 2>NUL)
else
_RAW_VER := $(shell git log -1 --format=%cd-%h --date=format:%Y%m%d --abbrev=6 2>/dev/null)
endif
ifeq ($(strip $(_RAW_VER)),)
VERSION := dev
else
VERSION := $(_RAW_VER)
endif
LDFLAGS := -X main.AppVersion=$(VERSION)

ifeq ($(OS),Windows_NT)
ifneq (,$(wildcard .venv/Scripts/python.exe))
PYTHON_ICON = .venv/Scripts/python.exe
else
PYTHON_ICON = python
endif
else
ifneq (,$(wildcard .venv/bin/python))
PYTHON_ICON = .venv/bin/python
else
PYTHON_ICON = python3
endif
endif
ICON_INSET = 0.85

ifeq ($(OS),Windows_NT)
DEV_CMD = powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run_dev.ps1 -Ldflags "$(LDFLAGS)"
else
DEV_CMD = wails dev -ldflags "$(LDFLAGS)"
endif

icon:
	$(PYTHON_ICON) scripts/generate_windows_icon.py --svg frontend/public/silphium.svg --app-png build/appicon.png --ico build/windows/icon.ico --icns build/darwin/iconfile.icns --bundle-icns build/bin/Silphium.app/Contents/Resources/iconfile.icns --inset $(ICON_INSET)
	@echo "Updated build/windows/icon.ico and build/darwin/iconfile.icns"

build:
	$(MAKE) icon
	wails build -ldflags "$(LDFLAGS)"

dev:
	$(MAKE) icon
	$(DEV_CMD)
