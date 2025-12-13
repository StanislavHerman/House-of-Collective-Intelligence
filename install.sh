#!/bin/bash

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}=================================================${NC}"
echo -e "${CYAN}   🏛  House of Collective Intelligence Setup    ${NC}"
echo -e "${CYAN}=================================================${NC}"
echo ""

# 1. Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed.${NC}"
    echo "Please install Node.js (v18 or higher) from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js found (${NODE_VERSION})${NC}"

# 2. Install Dependencies
echo ""
echo -e "${CYAN}Installing dependencies...${NC}"
npm install

if [ $? -ne 0 ]; then
    echo -e "${RED}Error during installation.${NC}"
    exit 1
fi

# 3. Build Project
echo ""
echo -e "${CYAN}Building project...${NC}"
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}Error during build.${NC}"
    exit 1
fi

# 4. Make executable
chmod +x dist/index.js

echo ""
echo -e "${GREEN}✓ Installation complete!${NC}"
echo ""
echo -e "To start the application, run:"
echo -e "${CYAN}./hause${NC}"
echo ""
echo -e "Or you can add it to your path to run it from anywhere."
