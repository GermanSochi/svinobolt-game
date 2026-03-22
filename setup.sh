#!/bin/bash
set -e

echo "=== Свино-болт: Setup ==="

# Ensure /tmp exists (Termux fix)
mkdir -p $PREFIX/tmp 2>/dev/null || true
export TMPDIR=$PREFIX/tmp

# Copy assets from sibling directory
echo "Copying assets..."
mkdir -p assets/images/nuts
cp ../svinobolt/assets/nuts/99_fruits_and_nuts/nuts_png/hazelnut.png assets/images/nuts/
cp ../svinobolt/assets/nuts/99_fruits_and_nuts/nuts_png/chestnut.png assets/images/nuts/
cp ../svinobolt/assets/nuts/99_fruits_and_nuts/nuts_png/walnut.png assets/images/nuts/
cp "../svinobolt/assets/autumn/Pixel Asset Pack Jam _Autumn/sprites/tilemap_16x16.png" assets/images/
echo "Assets copied."

# Install dependencies
echo "Installing dependencies..."
npm install

# Build
echo "Building..."
npm run build

echo ""
echo "=== Done! ==="
echo "Run: npm start"
echo "Open: http://localhost:8080"
