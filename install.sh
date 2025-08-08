#!/bin/bash

# Everything I need to run Cachyos 


RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'


print_status()   { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success()  { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning()  { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error()    { echo -e "${RED}[ERROR]${NC} $1"; }

# Prevent running as root
if [[ $EUID -eq 0 ]]; then
    print_error "Run this script as normal user (not root)."
    exit 1
fi

# Exit on any unhandled error
trap 'print_error "Script failed. Please review the log and fix errors."; exit 1' ERR

if ! command -v pacman >/dev/null 2>&1; then
  print_error "\e[31m[$0]: pacman not found, it seems that the system is not ArchLinux or Arch-based distros. Aborting...\e[0m\n"
  exit 1
fi

#update repos
print_status "Updating current repos"
sudo pacman -Syy && sudo pacman -Syu


# Load official packages (minimal, edit as needed)
official_packages=(
    yay ttf-dejavu noto-fonts ttf-font-awesome papirus-icon-theme adwaita-icon-theme
    git base-devel nerd-fonts code mesa steam protonplus  
)

for pkg in "${official_packages[@]}"; do
    sudo pacman -S --needed --noconfirm $pkg
done

# Load AUR packages
aur_packages=(
    arch-gaming-meta
)

for pkg in "${aur_packages[@]}"; do
    yay -S --needed --noconfirm $pkg
done
