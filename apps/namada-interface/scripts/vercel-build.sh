#!/bin/bash

sudo su
# Install Rust
echo "Installing Rustup..."
# Install Rustup (compiler)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
# Adding binaries to path
source "$HOME/.cargo/env"

# Install wasm-pack
echo "Installing wasm-pack..."
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh -s -- -y

# Build the WASM package
# echo "Building wasm-parser..."
# Build wasm-parser 
# yarn run build:wasm

# Complete the production build
# echo "Build static frontend client..."
# Build static html for the react client
# yarn run build